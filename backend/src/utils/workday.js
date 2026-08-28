// Normalise une date à minuit (partie date seule, sans l'heure) — sert de
// clé pour "la journée de pointage en cours" (voir schema.prisma, TimeEntry
// et la contrainte unique employeeId+date). Utilise le FUSEAU DU SERVEUR
// (voir index.js/TZ) : comme l'app cible une seule entreprise/un seul pays,
// pas besoin de gérer plusieurs fuseaux par employé.
function todayDateOnly() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Même normalisation, mais pour une date arbitraire (ex: filtre de période
// dans l'espace admin/export) plutôt que "aujourd'hui".
function dateOnly(d) {
  const date = new Date(d);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

module.exports = { todayDateOnly, dateOnly };
