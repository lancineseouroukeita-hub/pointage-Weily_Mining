const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');

// Connexion de l'espace admin (email + mot de passe) — les employés, eux,
// ne se connectent jamais ici : voir pointage.controller.js, qui identifie
// juste par matricule, sans mot de passe.
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }
  const admin = await prisma.adminUser.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  if (!admin) return res.status(401).json({ error: 'Identifiants incorrects.' });

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Identifiants incorrects.' });

  const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
  return res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name } });
}

async function me(req, res) {
  return res.json({ admin: req.admin });
}

module.exports = { login, me };
