// Réinitialise le mot de passe d'un compte admin EXISTANT (contrairement à
// seed.js qui ne fait rien si le compte existe déjà) — utile quand Lancine a
// oublié son mot de passe et qu'il n'y a pas de flux "mot de passe oublié"
// dans l'application (aucune route publique de gestion des comptes admin,
// volontairement — voir seed.js). À lancer UNE SEULE FOIS via une commande
// de démarrage temporaire sur Render (voir le guide de déploiement), avec
// les variables d'environnement RESET_ADMIN_EMAIL / RESET_ADMIN_PASSWORD
// définies temporairement, puis à retirer/remettre "npm start" ensuite.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

(async () => {
  const email = (process.env.RESET_ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.RESET_ADMIN_PASSWORD || '';

  if (!email || !password) {
    console.error('RESET_ADMIN_EMAIL et RESET_ADMIN_PASSWORD doivent être définies pour réinitialiser un mot de passe.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('RESET_ADMIN_PASSWORD doit faire au moins 8 caractères.');
    process.exit(1);
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (!existing) {
    console.error(`Aucun compte admin trouvé pour ${email} — vérifie l'adresse email (RESET_ADMIN_EMAIL).`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.adminUser.update({ where: { email }, data: { passwordHash } });
  console.log(`Mot de passe réinitialisé pour ${email}.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
