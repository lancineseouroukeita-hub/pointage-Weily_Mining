const express = require('express');
const { listEmployees, createEmployee, updateEmployee } = require('../controllers/employee.controller');
const { requireAdmin } = require('../middleware/adminAuth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// Toutes protégées par requireAdmin : la gestion des employés (ajout,
// modification, désactivation) est réservée à l'espace responsable/RH.
router.get('/', requireAdmin, asyncHandler(listEmployees));
router.post('/', requireAdmin, asyncHandler(createEmployee));
router.patch('/:id', requireAdmin, asyncHandler(updateEmployee));

module.exports = router;
