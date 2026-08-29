const ExcelJS = require('exceljs');
const prisma = require('../config/prisma');
const { dateOnly, workedHours, dailyOvertimeHours, weekStart, weekEnd, fmtHours } = require('../utils/workday');

// Construit la clause "where" commune à la consultation (listEntries) ET à
// l'export Excel (exportEntries) — évite que les deux finissent par
// diverger silencieusement si l'un des deux filtres est modifié sans
// l'autre. "to" est inclusif côté utilisateur (ex: "jusqu'au 31/08") donc on
// pousse la borne haute au lendemain à minuit pour couvrir toute la journée.
function buildWhere({ from, to, department }) {
  const where = {};
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = dateOnly(from);
    if (to) {
      const toExclusive = dateOnly(to);
      toExclusive.setDate(toExclusive.getDate() + 1);
      where.date.lt = toExclusive;
    }
  }
  if (department) {
    where.employee = { department };
  }
  return where;
}

async function listEntries(req, res) {
  const { from, to, department } = req.query;
  const where = buildWhere({ from, to, department });
  const entries = await prisma.timeEntry.findMany({
    where,
    include: { employee: true },
    orderBy: [{ date: 'desc' }, { employee: { lastName: 'asc' } }],
  });
  const weeklySummary = await computeWeeklySummary({ from, to, department });
  return res.json({
    entries: entries.map((e) => {
      const hours = workedHours(e);
      return {
        id: e.id,
        date: e.date,
        matricule: e.employee.matricule,
        firstName: e.employee.firstName,
        lastName: e.employee.lastName,
        department: e.employee.department,
        section: e.employee.section,
        arrivalAt: e.arrivalAt,
        breakStartAt: e.breakStartAt,
        breakEndAt: e.breakEndAt,
        departureAt: e.departureAt,
        workedHours: hours,
        dailyOvertimeHours: dailyOvertimeHours(hours),
      };
    }),
    weeklySummary,
  });
}

// Regroupe les heures travaillées par employé et par semaine (lundi→
// dimanche, voir workday.js) pour calculer les heures sup HEBDOMADAIRES
// (> 40h/semaine, demande de Lancine du 28/08/2026) — distinctes des heures
// sup quotidiennes calculées dans listEntries/exportEntries (> 8h/jour).
//
// Élargit volontairement la période demandée aux semaines complètes qui la
// recouvrent : sans ça, un filtre "cette semaine" ou "du 1er au 15" pourrait
// tomber en plein milieu d'une semaine et sous-compter son total, faussant
// le calcul des heures sup hebdomadaires.
async function computeWeeklySummary({ from, to, department }) {
  const extendedFrom = from ? weekStart(from) : undefined;
  const extendedTo = to ? weekEnd(to) : undefined;
  const where = buildWhere({ from: extendedFrom, to: extendedTo, department });
  const entries = await prisma.timeEntry.findMany({ where, include: { employee: true } });

  const byKey = new Map();
  for (const e of entries) {
    const hours = workedHours(e);
    if (hours === null) continue; // journée incomplète (pas de départ pointé) : ne compte pas dans le total
    const ws = weekStart(e.date);
    const key = e.employeeId + '|' + ws.toISOString();
    if (!byKey.has(key)) {
      byKey.set(key, {
        matricule: e.employee.matricule,
        firstName: e.employee.firstName,
        lastName: e.employee.lastName,
        department: e.employee.department,
        weekStart: ws,
        totalHours: 0,
      });
    }
    byKey.get(key).totalHours += hours;
  }

  return Array.from(byKey.values())
    .map((w) => ({ ...w, weeklyOvertimeHours: Math.max(0, w.totalHours - 40) }))
    .sort((a, b) => {
      if (a.weekStart.getTime() !== b.weekStart.getTime()) return b.weekStart - a.weekStart;
      return a.lastName.localeCompare(b.lastName);
    });
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('fr-FR');
}
function fmtTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// GET /api/report/export.xlsx?from=&to=&department= — génère un vrai
// classeur Excel (pas juste un CSV renommé) avec en-têtes figés et colonnes
// ajustées, téléchargé directement par le navigateur de l'admin. Une ligne
// par employé par jour pointé dans la période — pas de ligne pour les jours
// non pointés (un employé absent n'a simplement pas de TimeEntry ce jour-là).
async function exportEntries(req, res) {
  const { from, to, department } = req.query;
  const where = buildWhere({ from, to, department });
  const entries = await prisma.timeEntry.findMany({
    where,
    include: { employee: true },
    orderBy: [{ date: 'asc' }, { employee: { department: 'asc' } }, { employee: { lastName: 'asc' } }],
  });
  const weeklySummary = await computeWeeklySummary({ from, to, department });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pointage';
  workbook.created = new Date();

  // ---- Feuille 1 : pointages jour par jour, avec heures travaillées et
  // heures sup DU JOUR (> 8h ce jour-là, voir workday.js) ----
  const sheet = workbook.addWorksheet('Pointage');
  sheet.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Matricule', key: 'matricule', width: 12 },
    { header: 'Nom', key: 'lastName', width: 16 },
    { header: 'Prénom', key: 'firstName', width: 16 },
    { header: 'Département', key: 'department', width: 18 },
    { header: 'Section', key: 'section', width: 16 },
    { header: 'Arrivée', key: 'arrival', width: 10 },
    { header: 'Début pause', key: 'breakStart', width: 12 },
    { header: 'Fin pause', key: 'breakEnd', width: 12 },
    { header: 'Départ', key: 'departure', width: 10 },
    { header: 'Heures travaillées', key: 'worked', width: 16 },
    { header: 'Heures sup (jour, >8h)', key: 'overtimeDay', width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  entries.forEach((e) => {
    const hours = workedHours(e);
    sheet.addRow({
      date: fmtDate(e.date),
      matricule: e.employee.matricule,
      lastName: e.employee.lastName,
      firstName: e.employee.firstName,
      department: e.employee.department,
      section: e.employee.section,
      arrival: fmtTime(e.arrivalAt),
      breakStart: fmtTime(e.breakStartAt),
      breakEnd: fmtTime(e.breakEndAt),
      departure: fmtTime(e.departureAt),
      worked: fmtHours(hours),
      overtimeDay: fmtHours(dailyOvertimeHours(hours)),
    });
  });

  // ---- Feuille 2 : total hebdomadaire par employé et heures sup SEMAINE
  // (> 40h/semaine, voir workday.js/computeWeeklySummary) ----
  const weekSheet = workbook.addWorksheet('Récap hebdomadaire');
  weekSheet.columns = [
    { header: 'Semaine du', key: 'weekStart', width: 14 },
    { header: 'Matricule', key: 'matricule', width: 12 },
    { header: 'Nom', key: 'lastName', width: 16 },
    { header: 'Prénom', key: 'firstName', width: 16 },
    { header: 'Département', key: 'department', width: 18 },
    { header: 'Total heures travaillées', key: 'total', width: 20 },
    { header: 'Heures sup (semaine, >40h)', key: 'overtimeWeek', width: 22 },
  ];
  weekSheet.getRow(1).font = { bold: true };
  weekSheet.views = [{ state: 'frozen', ySplit: 1 }];
  weeklySummary.forEach((w) => {
    weekSheet.addRow({
      weekStart: fmtDate(w.weekStart),
      matricule: w.matricule,
      lastName: w.lastName,
      firstName: w.firstName,
      department: w.department,
      total: fmtHours(w.totalHours),
      overtimeWeek: fmtHours(w.weeklyOvertimeHours),
    });
  });

  const filename = `pointage_${from || 'debut'}_${to || 'fin'}.xlsx`.replace(/[^a-zA-Z0-9_.-]/g, '');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

// POST /api/report/archive?from=&to=&department= — supprime DÉFINITIVEMENT
// les pointages de la période/filtre donnés. Pensé pour être appelé juste
// après un téléchargement Excel (voir admin.html, bouton "Archiver et
// vider") : Lancine veut pouvoir repartir d'un tableau vide chaque semaine
// tout en gardant l'historique dans le fichier Excel exporté juste avant
// (demande du 29/08/2026 — voir aussi le choix explicite de NE PAS le faire
// automatiquement, pour garder la main sur le moment de la suppression).
// "from" ET "to" sont obligatoires ici (contrairement à listEntries/export) :
// un appel sans filtre supprimerait TOUT l'historique de pointage, ce qui ne
// doit jamais arriver par erreur (champs vides oubliés, appel API direct).
async function archiveAndClearEntries(req, res) {
  const { from, to, department } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'Une période (date de début ET de fin) est obligatoire avant de vider — ça évite de supprimer tout l’historique par erreur.' });
  }
  const where = buildWhere({ from, to, department });
  const result = await prisma.timeEntry.deleteMany({ where });
  return res.json({ deletedCount: result.count });
}

// Devine QUELLE action vient d'être pointée (arrivée/pause début/pause
// fin/départ) à partir d'un TimeEntry, pour le message de notification (voir
// latestEntries ci-dessous) — le champ modifié en dernier est forcément
// celui dont l'horodatage est le plus proche de `updatedAt` (les 3 autres,
// s'ils existent, datent d'une étape précédente de la même journée, donc de
// plusieurs minutes/heures plus tôt). Pas de colonne dédiée en base pour
// stocker "la dernière action" : ce serait redondant avec ce qu'on peut déjà
// déduire des 4 horodatages existants.
function guessLastAction(entry) {
  const updatedMs = new Date(entry.updatedAt).getTime();
  const candidates = [
    { field: 'arrivalAt', label: 'Arrivée' },
    { field: 'breakStartAt', label: 'Début de pause' },
    { field: 'breakEndAt', label: 'Fin de pause' },
    { field: 'departureAt', label: 'Départ' },
  ];
  let bestLabel = 'Pointage';
  let bestDiff = Infinity;
  for (const c of candidates) {
    const value = entry[c.field];
    if (!value) continue;
    const diff = Math.abs(new Date(value).getTime() - updatedMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLabel = c.label;
    }
  }
  return bestLabel;
}

// GET /api/report/latest?since=<ISO> — pointages créés/modifiés depuis
// `since`, pour que l'espace admin détecte automatiquement les nouveaux
// pointages sans que l'employé n'ait à "envoyer" quoi que ce soit (demande
// de Lancine du 29/08/2026) : admin.html interroge cette route toutes les
// ~15s et affiche une alerte pour chaque nouvel évènement. Renvoie aussi
// `serverNow` : le client doit s'en servir comme prochain `since` plutôt que
// sa propre horloge, pour éviter tout souci de décalage horloge client/
// serveur qui ferait rater ou dupliquer des évènements.
async function latestEntries(req, res) {
  const { since } = req.query;
  const sinceDate = since ? new Date(since) : new Date(Date.now() - 60000);
  const entries = await prisma.timeEntry.findMany({
    where: { updatedAt: { gt: sinceDate } },
    include: { employee: true },
    orderBy: { updatedAt: 'asc' },
  });
  return res.json({
    serverNow: new Date().toISOString(),
    events: entries.map((e) => ({
      id: e.id,
      matricule: e.employee.matricule,
      firstName: e.employee.firstName,
      lastName: e.employee.lastName,
      department: e.employee.department,
      section: e.employee.section,
      action: guessLastAction(e),
      at: e.updatedAt,
    })),
  });
}

module.exports = { listEntries, exportEntries, archiveAndClearEntries, latestEntries };
