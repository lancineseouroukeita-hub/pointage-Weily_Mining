const express = require('express');
const multer = require('multer');
const {
  listEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  importEmployees,
  downloadImportTemplate,
} = require('../controllers/employee.controller');
const { requireAdmin } = require('../middleware/adminAuth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// Stockage en mémoire (pas sur disque) : le fichier importé est un petit
// tableau d'employés, pas la peine de l'écrire sur le disque du serveur —
// on le lit directement depuis req.file.buffer (voir importEmployees).
// Limite à 5 Mo : largement suffisant pour une liste d'employés, ça évite
// qu'un fichier envoyé par erreur (ou malveillant) ne consomme la mémoire
// du serveur.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Toutes protégées par requireAdmin : la gestion des employés (ajout,
// modification, désactivation, import en masse) est réservée à l'espace
// responsable/RH.
router.get('/', requireAdmin, asyncHandler(listEmployees));
router.post('/', requireAdmin, asyncHandler(createEmployee));
router.patch('/:id', requireAdmin, asyncHandler(updateEmployee));
// Voir deleteEmployee : refuse si l'employé a déjà des pointages (409),
// pour ne jamais perdre d'historique de paie par erreur.
router.delete('/:id', requireAdmin, asyncHandler(deleteEmployee));
router.get('/import-template', requireAdmin, asyncHandler(downloadImportTemplate));
router.post('/import', requireAdmin, upload.single('file'), asyncHandler(importEmployees));

module.exports = router;
