// Crée le tout premier compte admin (aucun autre moyen d'en créer un — pas
// de route "inscription", volontairement, pour qu'on ne puisse pas créer un
// compte admin juste en connaissant l'URL). À lancer UNE SEULE FOIS après le
// tout premier déploiement (voir le guide de déploiement), avec les
// variables d'environnement SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD /
// SEED_ADMIN_NAME définies temporairement.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

(async () => {
  const email = (process.env.SEED_ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD || '';
  const name = process.env.SEED_ADMIN_NAME || 'Administrateur';

  if (!email || !password) {
    console.error('SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD doivent être définies pour créer le premier compte admin.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('SEED_ADMIN_PASSWORD doit faire au moins 8 caractères.');
    process.exit(1);
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`Un compte admin existe déjà pour ${email} — rien à faire.`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.adminUser.create({ data: { email, passwordHash, name } });
  console.log(`Compte admin créé pour ${email}.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
