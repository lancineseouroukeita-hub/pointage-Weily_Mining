const express = require('express');
const { getEtat, pointer } = require('../controllers/pointage.controller');
const { asyncHandler } = require('../utils/asyncHandler');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// 30 requêtes/minute/IP : largement suffisant pour un usage normal (un
// employé qui pointe quelques fois par jour), mais bloque un script qui
// tenterait des matricules en boucle (voir middleware/rateLimit.js — aucune
// authentification sur ces routes par choix).
const pointageLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

// PAS de requireAdmin ici volontairement : un employé s'identifie par son
// seul matricule (choix explicite de Lancine), jamais par un compte
// admin/mot de passe — voir pointage.controller.js pour les détails de ce
// que le matricule seul donne le droit de faire (uniquement pointer SA
// PROPRE journée, jamais consulter les autres/modifier un employé).
router.get('/etat/:matricule', pointageLimiter, asyncHandler(getEtat));
router.post('/:action', pointageLimiter, asyncHandler(pointer));

module.exports = router;
