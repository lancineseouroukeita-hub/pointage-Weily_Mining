const express = require('express');
const { login, me } = require('../controllers/auth.controller');
const { requireAdmin } = require('../middleware/adminAuth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.post('/login', asyncHandler(login));
router.get('/me', requireAdmin, asyncHandler(me));

module.exports = router;
