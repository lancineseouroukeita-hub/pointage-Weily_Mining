const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

// Protège toutes les routes de l'espace admin (gestion des employés,
// consultation des pointages, export Excel) — jamais les routes de pointage
// elles-mêmes (voir pointage.routes.js), qui n'utilisent QUE le matricule.
async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Non authentifié.' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await prisma.adminUser.findUnique({ where: { id: payload.id } });
    if (!admin) return res.status(401).json({ error: 'Compte administrateur introuvable.' });

    req.admin = { id: admin.id, email: admin.email, name: admin.name };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expirée, reconnectez-vous.' });
  }
}

module.exports = { requireAdmin };
