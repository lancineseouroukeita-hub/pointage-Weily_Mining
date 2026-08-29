const prisma = require('../config/prisma');

const SETTINGS_ID = 'default';
const DEFAULT_BACKGROUND_COLOR = '#0f1115';

function serializeSettings(settings) {
  return {
    backgroundColor: (settings && settings.backgroundColor) || DEFAULT_BACKGROUND_COLOR,
    backgroundImage: (settings && settings.backgroundImage) || null,
  };
}

// Une seule couleur/image de fond partagée par l'écran de pointage
// (kiosque) ET l'espace admin — demande de Lancine du 29/08/2026 ("changer
// la couleur de fond de l'application" puis "les thèmes aussi avec l'ajout
// des images"). Une seule ligne en base (id fixe "default"), pas une ligne
// par utilisateur : c'est un réglage de l'appli, pas une préférence
// personnelle par admin.
async function getSettings(req, res) {
  const settings = await prisma.appSetting.findUnique({ where: { id: SETTINGS_ID } });
  return res.json(serializeSettings(settings));
}

// Format hexadécimal strict (#rgb ou #rrggbb) : c'est la valeur qu'un
// <input type="color"> renvoie nativement, et ça évite d'accepter n'importe
// quelle chaîne (CSS arbitraire) dans un champ stocké puis réinjecté tel
// quel dans le style de la page.
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

async function updateSettings(req, res) {
  const { backgroundColor } = req.body;
  if (!backgroundColor || !HEX_COLOR_RE.test(backgroundColor)) {
    return res.status(400).json({ error: 'Couleur invalide — utilise le sélecteur de couleur fourni.' });
  }
  const settings = await prisma.appSetting.upsert({
    where: { id: SETTINGS_ID },
    update: { backgroundColor },
    create: { id: SETTINGS_ID, backgroundColor },
  });
  return res.json(serializeSettings(settings));
}

// Formats acceptés pour l'image de fond : les trois formats web standards,
// affichables directement par un navigateur sans conversion.
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// POST /api/settings/background-image (multipart, champ "image") — encode
// l'image en data URL (base64) et la stocke directement en base (voir
// schema.prisma/AppSetting, pas de fichier sur disque — le disque de Render
// est éphémère). La limite de taille (voir settings.routes.js, multer) est
// volontairement modeste : cette image est retéléchargée à CHAQUE ouverture
// de l'écran de pointage, donc une image trop lourde ralentirait le
// kiosque à chaque affichage.
async function uploadBackgroundImage(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucune image reçue.' });
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'Format non supporté — utilise une image PNG, JPEG ou WEBP.' });
  }

  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  const settings = await prisma.appSetting.upsert({
    where: { id: SETTINGS_ID },
    update: { backgroundImage: dataUrl },
    create: { id: SETTINGS_ID, backgroundImage: dataUrl },
  });
  return res.json(serializeSettings(settings));
}

// DELETE /api/settings/background-image — retire l'image, revient à la
// couleur de fond seule (jamais de suppression du réglage de couleur
// lui-même, qui reste indépendant).
async function removeBackgroundImage(req, res) {
  const settings = await prisma.appSetting.upsert({
    where: { id: SETTINGS_ID },
    update: { backgroundImage: null },
    create: { id: SETTINGS_ID },
  });
  return res.json(serializeSettings(settings));
}

module.exports = { getSettings, updateSettings, uploadBackgroundImage, removeBackgroundImage };
