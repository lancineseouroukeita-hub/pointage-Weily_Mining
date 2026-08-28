const express = require('express');
const { listEntries, exportEntries } = require('../controllers/report.controller');
const { requireAdmin } = require('../middleware/adminAuth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/entries', requireAdmin, asyncHandler(listEntries));
router.get('/export.xlsx', requireAdmin, asyncHandler(exportEntries));

module.exports = router;
