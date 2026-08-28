const { PrismaClient } = require('@prisma/client');

// Instance unique partagée par tout le serveur (comme seourouApps) : évite
// d'ouvrir une nouvelle connexion Postgres à chaque requête.
const prisma = new PrismaClient();

module.exports = prisma;
