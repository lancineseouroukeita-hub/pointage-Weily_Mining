const ExcelJS = require('exceljs');
const prisma = require('../config/prisma');
const { dateOnly } = require('../utils/workday');

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
  return res.json({
    entries: entries.map((e) => ({
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
    })),
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

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pointage';
  workbook.created = new Date();
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
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  entries.forEach((e) => {
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
    });
  });

  const filename = `pointage_${from || 'debut'}_${to || 'fin'}.xlsx`.replace(/[^a-zA-Z0-9_.-]/g, '');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

module.exports = { listEntries, exportEntries };
