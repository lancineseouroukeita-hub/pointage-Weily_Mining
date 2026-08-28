const prisma = require('../config/prisma');

function serializeEmployee(e) {
  return {
    id: e.id,
    matricule: e.matricule,
    firstName: e.firstName,
    lastName: e.lastName,
    department: e.department,
    section: e.section,
    active: e.active,
    createdAt: e.createdAt,
  };
}

// Liste tous les employés (actifs ET désactivés — voir schema.prisma,
// Employee.active) : l'espace admin doit pouvoir les distinguer/filtrer
// lui-même plutôt que de les cacher côté serveur.
async function listEmployees(req, res) {
  const employees = await prisma.employee.findMany({ orderBy: [{ department: 'asc' }, { lastName: 'asc' }] });
  return res.json({ employees: employees.map(serializeEmployee) });
}

async function createEmployee(req, res) {
  const { matricule, firstName, lastName, department, section } = req.body;
  if (!matricule || !firstName || !lastName || !department || !section) {
    return res.status(400).json({ error: 'Matricule, nom, prénom, département et section sont requis.' });
  }
  const cleanMatricule = String(matricule).trim();
  const existing = await prisma.employee.findUnique({ where: { matricule: cleanMatricule } });
  if (existing) return res.status(409).json({ error: 'Ce matricule est déjà utilisé.' });

  const employee = await prisma.employee.create({
    data: {
      matricule: cleanMatricule,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      department: String(department).trim(),
      section: String(section).trim(),
    },
  });
  return res.status(201).json({ employee: serializeEmployee(employee) });
}

async function updateEmployee(req, res) {
  const { id } = req.params;
  const { firstName, lastName, department, section, active } = req.body;
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) return res.status(404).json({ error: 'Employé introuvable.' });

  const updated = await prisma.employee.update({
    where: { id },
    data: {
      ...(firstName !== undefined ? { firstName: String(firstName).trim() } : {}),
      ...(lastName !== undefined ? { lastName: String(lastName).trim() } : {}),
      ...(department !== undefined ? { department: String(department).trim() } : {}),
      ...(section !== undefined ? { section: String(section).trim() } : {}),
      ...(active !== undefined ? { active: Boolean(active) } : {}),
    },
  });
  return res.json({ employee: serializeEmployee(updated) });
}

// Pas de suppression : un employé qui part est désactivé (active: false, via
// updateEmployee), jamais supprimé — voir schema.prisma, ça garderait un
// pointage orphelin (contrainte de clé étrangère) et perdrait l'historique
// utile pour la paie/les archives.

module.exports = { listEmployees, createEmployee, updateEmployee };
