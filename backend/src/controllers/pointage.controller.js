const prisma = require('../config/prisma');
const { todayDateOnly } = require('../utils/workday');

function serializeEntry(entry) {
  if (!entry) {
    return { arrivalAt: null, breakStartAt: null, breakEndAt: null, departureAt: null };
  }
  return {
    arrivalAt: entry.arrivalAt,
    breakStartAt: entry.breakStartAt,
    breakEndAt: entry.breakEndAt,
    departureAt: entry.departureAt,
  };
}

// Retrouve l'employé actif correspondant à un matricule tapé par lui-même
// (voir routes/pointage.routes.js, aucune authentification ici — juste le
// matricule, comme demandé par Lancine). Un matricule désactivé (employé
// parti, voir Employee.active) ou inconnu donne EXACTEMENT le même message
// d'erreur générique : ne pas laisser deviner si un matricule existe ou non.
async function findActiveEmployee(matricule) {
  if (!matricule || typeof matricule !== 'string') return null;
  const employee = await prisma.employee.findUnique({ where: { matricule: matricule.trim() } });
  if (!employee || !employee.active) return null;
  return employee;
}

// GET /api/pointage/etat/:matricule — état du jour pour CE matricule, appelé
// dès que l'employé tape son matricule, avant même de pointer quoi que ce
// soit : sert à n'afficher QUE le bouton pertinent côté client (ex: pas de
// bouton "Arrivée" si déjà arrivé aujourd'hui) plutôt que de laisser
// n'importe quel bouton cliquable et rejeter après coup.
async function getEtat(req, res) {
  const employee = await findActiveEmployee(req.params.matricule);
  if (!employee) return res.status(404).json({ error: 'Matricule inconnu ou compte désactivé.' });

  const entry = await prisma.timeEntry.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: todayDateOnly() } },
  });
  return res.json({
    employee: { firstName: employee.firstName, lastName: employee.lastName, department: employee.department, section: employee.section },
    today: serializeEntry(entry),
  });
}

// POST /api/pointage/:action  { matricule }  — action ∈ arrivee|pause-debut|pause-fin|depart
// Chaque action ne peut se produire qu'une fois et dans le bon ordre pour la
// journée en cours (voir les vérifications par action ci-dessous) : un
// double clic accidentel ou une tentative de repointer après le départ est
// refusé avec un message clair plutôt que d'écraser une heure déjà
// enregistrée.
async function pointer(req, res) {
  const { action } = req.params;
  const employee = await findActiveEmployee(req.body.matricule);
  if (!employee) return res.status(404).json({ error: 'Matricule inconnu ou compte désactivé.' });

  const date = todayDateOnly();
  const now = new Date();

  let entry = await prisma.timeEntry.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date } },
  });

  if (action === 'arrivee') {
    if (entry && entry.arrivalAt) return res.status(409).json({ error: 'Arrivée déjà enregistrée aujourd\'hui.' });
    entry = entry
      ? await prisma.timeEntry.update({ where: { id: entry.id }, data: { arrivalAt: now } })
      : await prisma.timeEntry.create({ data: { employeeId: employee.id, date, arrivalAt: now } });
  } else if (action === 'pause-debut') {
    if (!entry || !entry.arrivalAt) return res.status(409).json({ error: 'Il faut d\'abord pointer l\'arrivée.' });
    if (entry.breakStartAt) return res.status(409).json({ error: 'Pause déjà commencée aujourd\'hui.' });
    if (entry.departureAt) return res.status(409).json({ error: 'La journée est déjà terminée.' });
    entry = await prisma.timeEntry.update({ where: { id: entry.id }, data: { breakStartAt: now } });
  } else if (action === 'pause-fin') {
    if (!entry || !entry.breakStartAt) return res.status(409).json({ error: 'La pause n\'a pas encore commencé.' });
    if (entry.breakEndAt) return res.status(409).json({ error: 'Fin de pause déjà enregistrée aujourd\'hui.' });
    entry = await prisma.timeEntry.update({ where: { id: entry.id }, data: { breakEndAt: now } });
  } else if (action === 'depart') {
    if (!entry || !entry.arrivalAt) return res.status(409).json({ error: 'Il faut d\'abord pointer l\'arrivée.' });
    if (entry.departureAt) return res.status(409).json({ error: 'Départ déjà enregistré aujourd\'hui.' });
    if (entry.breakStartAt && !entry.breakEndAt) return res.status(409).json({ error: 'Il faut d\'abord pointer la fin de pause.' });
    entry = await prisma.timeEntry.update({ where: { id: entry.id }, data: { departureAt: now } });
  } else {
    return res.status(400).json({ error: 'Action inconnue.' });
  }

  return res.json({ today: serializeEntry(entry) });
}

module.exports = { getEtat, pointer };
