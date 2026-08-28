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

// Nombre d'heures (décimal) entre deux dates, ou null si l'une des deux
// bornes manque — brique de base du calcul des heures travaillées/sup (voir
// workedHours ci-dessous et report.controller.js).
function hoursBetween(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms / 1000 / 60 / 60;
}

// Heures effectivement travaillées pour un pointage (arrivée -> départ,
// moins la pause) — null tant que la journée n'est pas complète (pas encore
// de départ pointé). Par construction (voir pointage.controller.js : on ne
// peut pas pointer le départ en plein milieu d'une pause), dès que
// departureAt est rempli, la pause est soit absente soit complète — pas
// besoin de gérer ici une pause à moitié entamée.
function workedHours(entry) {
  const total = hoursBetween(entry.arrivalAt, entry.departureAt);
  if (total === null) return null;
  const breakDuration = hoursBetween(entry.breakStartAt, entry.breakEndAt) || 0;
  return Math.max(0, total - breakDuration);
}

// Heures supplémentaires DU JOUR : au-delà de 8h travaillées ce jour-là
// (seuil demandé par Lancine, voir échange du 28/08/2026). Retourne null
// tant que la journée n'est pas complète (cohérent avec workedHours), 0
// sinon dès que le seuil n'est pas dépassé.
function dailyOvertimeHours(hours) {
  if (hours === null) return null;
  return Math.max(0, hours - 8);
}

// Lundi (minuit) de la semaine contenant `d` — clé de regroupement pour le
// total hebdomadaire (voir report.controller.js, computeWeeklySummary).
// Semaine lundi→dimanche (convention FR), calculée sur le fuseau du serveur
// comme le reste de l'app (voir dateOnly ci-dessus).
function weekStart(d) {
  const date = dateOnly(d);
  const day = date.getDay(); // 0 = dimanche, 1 = lundi, ...
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

// Dimanche (minuit) de la même semaine que weekStart(d) — sert à élargir une
// période de filtre à des semaines complètes (voir computeWeeklySummary).
function weekEnd(d) {
  const start = weekStart(d);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}

// Formatte un nombre d'heures décimal en "8h30" — pour l'affichage admin et
// l'export Excel (plus lisible qu'une décimale pour un responsable RH).
function fmtHours(hours) {
  if (hours === null || hours === undefined) return '';
  let h = Math.floor(hours);
  let m = Math.round((hours - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return `${h}h${String(m).padStart(2, '0')}`;
}

module.exports = {
  todayDateOnly, dateOnly, hoursBetween, workedHours, dailyOvertimeHours,
  weekStart, weekEnd, fmtHours,
};
