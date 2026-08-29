const express = require('express');
const { listEntries, exportEntries, archiveAndClearEntries } = require('../controllers/report.controller');
const { requireAdmin } = require('../middleware/adminAuth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/entries', requireAdmin, asyncHandler(listEntries));
router.get('/export.xlsx', requireAdmin, asyncHandler(exportEntries));
// POST (pas GET) car cette route SUPPRIME des données — une requête GET doit
// rester sans effet de bord (voir archiveAndClearEntries).
router.post('/archive', requireAdmin, asyncHandler(archiveAndClearEntries));

module.exports = router;
