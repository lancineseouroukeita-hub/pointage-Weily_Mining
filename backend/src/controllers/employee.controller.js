const ExcelJS = require('exceljs');
const prisma = require('../config/prisma');

function serializeEmployee(e) {
  return {
    id: e.id,
    matricule: e.matricule,
    firstName: e.firstName,
    lastName: e.lastName,
    department: e.department,
    section: e.section,
    active: e.active,
    createdAt: e.createdAt,
  };
}

// Liste tous les employés (actifs ET désactivés — voir schema.prisma,
// Employee.active) : l'espace admin doit pouvoir les distinguer/filtrer
// lui-même plutôt que de les cacher côté serveur.
async function listEmployees(req, res) {
  const employees = await prisma.employee.findMany({ orderBy: [{ department: 'asc' }, { lastName: 'asc' }] });
  return res.json({ employees: employees.map(serializeEmployee) });
}

async function createEmployee(req, res) {
  const { matricule, firstName, lastName, department, section } = req.body;
  if (!matricule || !firstName || !lastName || !department || !section) {
    return res.status(400).json({ error: 'Matricule, nom, prénom, département et section sont requis.' });
  }
  const cleanMatricule = String(matricule).trim();
  const existing = await prisma.employee.findUnique({ where: { matricule: cleanMatricule } });
  if (existing) return res.status(409).json({ error: 'Ce matricule est déjà utilisé.' });

  const employee = await prisma.employee.create({
    data: {
      matricule: cleanMatricule,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      department: String(department).trim(),
      section: String(section).trim(),
    },
  });
  return res.status(201).json({ employee: serializeEmployee(employee) });
}

async function updateEmployee(req, res) {
  const { id } = req.params;
  const { firstName, lastName, department, section, active } = req.body;
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) return res.status(404).json({ error: 'Employé introuvable.' });

  const updated = await prisma.employee.update({
    where: { id },
    data: {
      ...(firstName !== undefined ? { firstName: String(firstName).trim() } : {}),
      ...(lastName !== undefined ? { lastName: String(lastName).trim() } : {}),
      ...(department !== undefined ? { department: String(department).trim() } : {}),
      ...(section !== undefined ? { section: String(section).trim() } : {}),
      ...(active !== undefined ? { active: Boolean(active) } : {}),
    },
  });
  return res.json({ employee: serializeEmployee(updated) });
}

// Pas de suppression : un employé qui part est désactivé (active: false, via
// updateEmployee), jamais supprimé — voir schema.prisma, ça garderait un
// pointage orphelin (contrainte de clé étrangère) et perdrait l'historique
// utile pour la paie/les archives.

// Enlève les accents et met en minuscule ("Département" -> "departement")
// pour que la reconnaissance des colonnes du fichier importé tolère les
// variantes orthographiques (accents oubliés, casse différente) — demande
// de Lancine du 29/08/2026 : il doit pouvoir importer sa propre liste sans
// que le moindre détail de formatage fasse échouer l'import.
// Enlève les marques diacritiques combinantes (accents) laissées par
// normalize('NFD') — ex: "é" devient "e" + accent séparé, on retire cet
// accent séparé. Filtré par code Unicode plutôt que par une regex avec des
// caractères d'accent littéraux dans le code source, pour éviter tout souci
// d'encodage/copier-coller sur ces caractères invisibles.
function stripCombiningMarks(str) {
  let out = '';
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code < 0x0300 || code > 0x036f) out += ch;
  }
  return out;
}
function normalizeHeader(s) {
  return stripCombiningMarks(String(s || '').normalize('NFD'))
    .trim()
    .toLowerCase();
}

const COLUMN_ALIASES = {
  matricule: 'matricule',
  nom: 'lastName',
  prenom: 'firstName',
  departement: 'department',
  section: 'section',
};

// GET /api/employees/import-template — génère un fichier Excel vierge (juste
// les en-têtes + une ligne d'exemple) pour que Lancine sache exactement quoi
// remplir avant de ré-importer via importEmployees ci-dessous.
async function downloadImportTemplate(req, res) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Employés');
  sheet.columns = [
    { header: 'Matricule', key: 'matricule', width: 14 },
    { header: 'Nom', key: 'nom', width: 18 },
    { header: 'Prénom', key: 'prenom', width: 18 },
    { header: 'Département', key: 'departement', width: 20 },
    { header: 'Section', key: 'section', width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.addRow({ matricule: '147', nom: 'Keita', prenom: 'Lancine', departement: 'ADMINISTRATION', section: 'Comptabilité' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="modele_import_employes.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
}

// POST /api/employees/import (multipart, champ "file") — importe en masse
// les employés d'un fichier Excel (voir downloadImportTemplate pour le
// format attendu). Un employé dont le matricule existe déjà est MIS À JOUR
// (nom/prénom/département/section) plutôt que dupliqué ou rejeté — utile si
// Lancine réimporte une liste corrigée. Le statut actif/désactivé n'est
// jamais modifié par l'import : ça reste une action volontaire distincte
// (voir updateEmployee) pour ne pas réactiver un employé parti par erreur.
async function importEmployees(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier reçu.' });
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: "Fichier illisible — vérifie que c'est bien un fichier Excel (.xlsx)." });
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return res.status(400).json({ error: 'Le fichier ne contient aucune feuille.' });
  }

  // Repère quelle colonne correspond à quel champ, à partir de la 1ère ligne
  // (voir normalizeHeader/COLUMN_ALIASES ci-dessus).
  const headerRow = sheet.getRow(1);
  const columnByField = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const field = COLUMN_ALIASES[normalizeHeader(cell.value)];
    if (field) columnByField[field] = colNumber;
  });
  const missingColumns = ['matricule', 'lastName', 'firstName', 'department', 'section'].filter((f) => !columnByField[f]);
  if (missingColumns.length) {
    return res.status(400).json({
      error: 'Colonnes manquantes dans le fichier : Matricule, Nom, Prénom, Département, Section sont toutes requises (télécharge le modèle si besoin).',
    });
  }

  let created = 0;
  let updated = 0;
  const errors = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const get = (field) => row.getCell(columnByField[field]).value;
    const matricule = String(get('matricule') ?? '').trim();
    const lastName = String(get('lastName') ?? '').trim();
    const firstName = String(get('firstName') ?? '').trim();
    const department = String(get('department') ?? '').trim();
    const section = String(get('section') ?? '').trim();

    // Ligne complètement vide (fin de tableau, ligne blanche laissée dans le
    // fichier) : on l'ignore silencieusement, ce n'est pas une erreur.
    if (!matricule && !lastName && !firstName && !department && !section) continue;

    if (!matricule || !lastName || !firstName || !department || !section) {
      errors.push(`Ligne ${rowNumber} : matricule, nom, prénom, département et section sont tous requis.`);
      continue;
    }

    try {
      const existing = await prisma.employee.findUnique({ where: { matricule } });
      if (existing) {
        await prisma.employee.update({
          where: { matricule },
          data: { firstName, lastName, department, section },
        });
        updated += 1;
      } else {
        await prisma.employee.create({
          data: { matricule, firstName, lastName, department, section },
        });
        created += 1;
      }
    } catch (err) {
      errors.push(`Ligne ${rowNumber} (matricule ${matricule}) : erreur inattendue — ${err.message}`);
    }
  }

  return res.json({ created, updated, errors });
}

module.exports = { listEmployees, createEmployee, updateEmployee, importEmployees, downloadImportTemplate };
