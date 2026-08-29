const express = require('express');
const multer = require('multer');
const {
  getSettings,
  updateSettings,
  uploadBackgroundImage,
  removeBackgroundImage,
} = require('../controllers/settings.controller');
const { requireAdmin } = require('../middleware/adminAuth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// Limite volontairement modeste (1,5 Mo) : l'image est stockée en base64 en
// base (voir settings.controller.js) et retéléchargée à chaque ouverture de
// l'écran de pointage — une image trop lourde ralentirait le kiosque.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1.5 * 1024 * 1024 } });

// GET public (SANS requireAdmin) : l'écran de pointage (kiosque, public,
// sans connexion) doit pouvoir lire la couleur/image de fond choisie — voir
// settings.controller.js, aucune donnée sensible ici.
router.get('/', asyncHandler(getSettings));
// Modifier le réglage reste réservé à l'admin.
router.put('/', requireAdmin, asyncHandler(updateSettings));
router.post('/background-image', requireAdmin, upload.single('image'), asyncHandler(uploadBackgroundImage));
router.delete('/background-image', requireAdmin, asyncHandler(removeBackgroundImage));

module.exports = router;
