// Pointeuse à empreinte (demande de Lancine du 29/09/2026). Deux façons de
// faire entrer les pointages de la machine dans l'app, quelle que soit sa
// marque :
//   1. Import du fichier exporté par la machine (clé USB ou logiciel) —
//      importMachineLog, depuis l'onglet « Machine » de l'espace admin.
//   2. Envoi direct par la machine (protocole ADMS / iClock, proposé par
//      ZKTeco et de nombreuses machines compatibles) — adms*, ci-dessous.
// Dans les deux cas, chaque passage de doigt est d'abord gardé tel quel
// (MachinePunch), puis les journées (TimeEntry) sont recalculées à partir de
// ces passages bruts (voir applyPunches).
const prisma = require('../config/prisma');
const { parseMachineFile, groupShifts, assignShift, shiftDate, parseDateTime, cleanPin } = require('../utils/machineLog');

const SHIFT_MS = 18 * 60 * 60 * 1000;
const STEPS = ['arrivalAt', 'breakStartAt', 'breakEndAt', 'departureAt'];

// "0147" et "147" désignent le même travailleur : la plupart des machines
// complètent le numéro avec des zéros, alors que le matricule de l'app n'en
// a pas forcément.
function pinKey(pin) {
  const s = String(pin).trim();
  return /^\d+$/.test(s) ? String(Number(s)) : s.toUpperCase();
}

async function employeesByKey() {
  const employees = await prisma.employee.findMany();
  const map = new Map();
  employees.forEach((e) => map.set(pinKey(e.matricule), e));
  return map;
}

function sameTime(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs(new Date(a) - new Date(b)) < 60 * 1000;
}

// Enregistre des passages bruts (sans doublon : même numéro + même seconde).
async function storePunches(punches, origin, deviceSn) {
  const data = punches.map((p) => ({ pin: p.pin, pinKey: pinKey(p.pin), punchedAt: p.at, origin, deviceSn: deviceSn || null }));
  let inserted = 0;
  for (let i = 0; i < data.length; i += 1000) {
    const r = await prisma.machinePunch.createMany({ data: data.slice(i, i + 1000), skipDuplicates: true });
    inserted += r.count;
  }
  return inserted;
}

// Recalcule les journées des numéros `keys` entre `from` et `to` à partir
// des passages bruts. Règles (voir aussi schema.prisma, TimeEntry.source) :
//   - journée inexistante -> créée, source "machine" ;
//   - journée "machine"   -> ses 4 étapes sont recalculées ;
//   - journée "kiosque"   -> JAMAIS écrasée : une fois la journée terminée,
//     seules les étapes vides sont complétées, et un écart de plus de 5 min
//     avec la machine est signalé.
async function applyPunches(keys, from, to) {
  const byKey = await employeesByKey();
  const stats = { created: 0, updated: 0, completed: 0, conflicts: [], anomalies: [], unknownPins: [] };
  const toCreate = [];
  const now = new Date();

  for (const key of keys) {
    const employee = byKey.get(key);
    if (!employee) { stats.unknownPins.push(key); continue; }
    const raw = await prisma.machinePunch.findMany({
      where: { pinKey: key, punchedAt: { gte: new Date(from.getTime() - SHIFT_MS), lte: new Date(to.getTime() + SHIFT_MS) } },
      orderBy: { punchedAt: 'asc' },
      select: { punchedAt: true },
    });
    const shifts = groupShifts(raw.map((r) => r.punchedAt))
      .filter((s) => s[s.length - 1] >= from && s[0] <= to);
    if (!shifts.length) continue;

    const dates = shifts.map((s) => shiftDate(s[0]));
    const existing = await prisma.timeEntry.findMany({ where: { employeeId: employee.id, date: { in: dates } } });
    const existingByDay = new Map(existing.map((e) => [new Date(e.date).getTime(), e]));
    const who = `${employee.matricule} ${employee.lastName} ${employee.firstName}`.trim();

    for (const shift of shifts) {
      const date = shiftDate(shift[0]);
      const computed = assignShift(shift, now);
      const dayLabel = date.toLocaleDateString('fr-FR');
      if (computed.anomaly && stats.anomalies.length < 100) stats.anomalies.push(`${who} — ${dayLabel} : ${computed.anomaly}`);
      const entry = existingByDay.get(date.getTime());
      const values = {};
      STEPS.forEach((f) => { values[f] = computed[f] || null; });

      if (!entry) {
        toCreate.push({ employeeId: employee.id, date, source: 'machine', ...values });
        existingByDay.set(date.getTime(), true);
        continue;
      }
      if (entry === true) continue;
      if (entry.source === 'machine') {
        if (STEPS.some((f) => !sameTime(entry[f], values[f]))) {
          await prisma.timeEntry.update({ where: { id: entry.id }, data: values });
          stats.updated++;
        }
        continue;
      }
      // Journée commencée à l'écran et encore en cours : impossible de savoir
      // à quelle étape correspond un passage de doigt en plein milieu de
      // journée (ex : 12h = départ ou début de pause ?). On attend qu'elle
      // soit terminée (18h après le premier pointage) pour compléter.
      if (now - shift[0] < SHIFT_MS) continue;
      const fill = {};
      STEPS.forEach((f) => {
        if (!entry[f] && values[f]) fill[f] = values[f];
        else if (entry[f] && values[f] && Math.abs(new Date(entry[f]) - values[f]) > 5 * 60 * 1000 && stats.conflicts.length < 100) {
          stats.conflicts.push(`${who} — ${dayLabel} : écran de pointage et machine ne donnent pas la même heure (gardé : écran)`);
        }
      });
      if (Object.keys(fill).length) {
        await prisma.timeEntry.update({ where: { id: entry.id }, data: fill });
        stats.completed++;
      }
    }
  }
  for (let i = 0; i < toCreate.length; i += 500) {
    const r = await prisma.timeEntry.createMany({ data: toCreate.slice(i, i + 500), skipDuplicates: true });
    stats.created += r.count;
  }
  return stats;
}

function rangeOf(punches) {
  let min = null, max = null;
  punches.forEach((p) => {
    if (!min || p.at < min) min = p.at;
    if (!max || p.at > max) max = p.at;
  });
  return { min, max };
}

// POST /api/machine/import  (multipart, champ "file")
//   ?commit=1 absent -> APERÇU seulement : rien n'est enregistré.
//   ?commit=1        -> enregistre les passages et calcule les journées.
// Réimporter le même fichier ne crée aucun doublon.
async function importMachineLog(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
  const { punches, ignored, ignoredSamples } = await parseMachineFile(req.file.buffer, req.file.originalname);
  if (!punches.length) {
    return res.status(400).json({
      error: "Aucun pointage reconnu dans ce fichier. Il faut au moins une colonne avec le numéro de l'employé et une date + heure par ligne.",
      ignoredSamples,
    });
  }
  const byKey = await employeesByKey();
  const keys = [...new Set(punches.map((p) => pinKey(p.pin)))];
  const known = keys.filter((k) => byKey.has(k));
  const unknown = keys.filter((k) => !byKey.has(k));
  const { min, max } = rangeOf(punches);

  // Aperçu : combien de journées complètes / incomplètes ce fichier donne.
  const perKey = new Map();
  punches.forEach((p) => {
    const k = pinKey(p.pin);
    if (!perKey.has(k)) perKey.set(k, []);
    perKey.get(k).push(p.at);
  });
  const dist = { un: 0, deux: 0, trois: 0, quatre: 0, plus: 0 };
  let days = 0;
  perKey.forEach((times, k) => {
    if (!byKey.has(k)) return;
    groupShifts(times).forEach((s) => {
      days++;
      const n = s.length;
      if (n === 1) dist.un++; else if (n === 2) dist.deux++; else if (n === 3) dist.trois++; else if (n === 4) dist.quatre++; else dist.plus++;
    });
  });

  const summary = {
    lines: punches.length + ignored,
    punches: punches.length,
    ignored,
    ignoredSamples,
    from: min,
    to: max,
    employeesFound: known.length,
    unknownPins: unknown.slice(0, 50),
    unknownCount: unknown.length,
    days,
    distribution: dist,
  };
  if (req.query.commit !== '1') return res.json({ preview: true, ...summary });

  const inserted = await storePunches(punches, 'fichier', req.file.originalname);
  const stats = await applyPunches(known, min, max);
  return res.json({ preview: false, ...summary, inserted, ...stats, unknownPins: unknown.slice(0, 50) });
}

// POST /api/machine/reapply?from=YYYY-MM-DD&to=YYYY-MM-DD — recalcule les
// journées à partir des passages déjà reçus : utile après avoir ajouté un
// employé dont le numéro était inconnu au moment du pointage.
async function reapplyPunches(req, res) {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Choisissez une période (du / au).' });
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T23:59:59`);
  const rows = await prisma.machinePunch.findMany({
    where: { punchedAt: { gte: start, lte: end } },
    distinct: ['pinKey'],
    select: { pinKey: true },
  });
  const stats = await applyPunches(rows.map((r) => r.pinKey), start, end);
  return res.json(stats);
}

// GET /api/machine/status — dernière activité de chaque machine et numéros
// reçus qui ne correspondent à aucun employé.
async function machineStatus(req, res) {
  const total = await prisma.machinePunch.count();
  const devices = await prisma.machinePunch.groupBy({
    by: ['origin', 'deviceSn'],
    _count: { _all: true },
    _max: { punchedAt: true, createdAt: true },
    orderBy: { _max: { createdAt: 'desc' } },
    take: 20,
  });
  const byKey = await employeesByKey();
  const since = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const recentKeys = await prisma.machinePunch.findMany({ where: { createdAt: { gte: since } }, distinct: ['pinKey'], select: { pinKey: true } });
  const unknownPins = recentKeys.map((r) => r.pinKey).filter((k) => !byKey.has(k)).slice(0, 50);
  return res.json({
    total,
    admsEnabled: allowedSerials().length > 0,
    devices: devices.map((d) => ({ origin: d.origin, deviceSn: d.deviceSn, count: d._count._all, lastPunchAt: d._max.punchedAt, lastReceivedAt: d._max.createdAt })),
    unknownPins,
  });
}

// ---------- Envoi direct par la machine (ADMS / iClock) ----------
// La machine appelle d'elle-même l'adresse du serveur (réglage « Cloud /
// ADMS / Serveur » de la machine). Seules les machines dont le numéro de
// série figure dans la variable d'environnement MACHINE_SERIALS (Render,
// séparés par des virgules) sont acceptées : sans cette liste, la fonction
// est désactivée, pour qu'aucun appareil inconnu ne puisse créer de
// pointages.
function allowedSerials() {
  return (process.env.MACHINE_SERIALS || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function checkSerial(req, res) {
  const sn = String(req.query.SN || '').trim();
  if (!sn || !allowedSerials().includes(sn)) {
    res.status(403).type('text/plain').send('Machine non autorisée');
    return null;
  }
  return sn;
}

// GET /iclock/cdata?SN=... — la machine demande sa configuration au démarrage.
async function admsHandshake(req, res) {
  const sn = checkSerial(req, res);
  if (!sn) return;
  res.type('text/plain').send([
    `GET OPTION FROM: ${sn}`,
    'ATTLOGStamp=None',
    'OPERLOGStamp=9999',
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog',
    'TimeZone=0',
    'Realtime=1',
    'Encrypt=None',
  ].join('\n'));
}

// POST /iclock/cdata?SN=...&table=ATTLOG — la machine envoie des pointages,
// une ligne par passage : "PIN<TAB>AAAA-MM-JJ HH:MM:SS<TAB>état<TAB>...".
async function admsReceive(req, res) {
  const sn = checkSerial(req, res);
  if (!sn) return;
  const table = String(req.query.table || '').toUpperCase();
  const body = typeof req.body === 'string' ? req.body : '';
  if (table !== 'ATTLOG') return res.type('text/plain').send('OK');
  const punches = [];
  body.split(/\r?\n/).forEach((line) => {
    const cells = line.split('\t');
    const pin = cleanPin(cells[0]);
    const at = cells[1] ? parseDateTime(cells[1]) : null;
    if (pin && at) punches.push({ pin, at });
  });
  if (punches.length) {
    await storePunches(punches, 'adms', sn);
    const { min, max } = rangeOf(punches);
    await applyPunches([...new Set(punches.map((p) => pinKey(p.pin)))], min, max);
  }
  res.type('text/plain').send(`OK: ${punches.length}`);
}

// GET /iclock/getrequest et POST /iclock/devicecmd — la machine demande s'il
// y a des commandes à exécuter : jamais, on répond simplement OK.
async function admsIdle(req, res) {
  const sn = checkSerial(req, res);
  if (!sn) return;
  res.type('text/plain').send('OK');
}

module.exports = { importMachineLog, reapplyPunches, machineStatus, admsHandshake, admsReceive, admsIdle, pinKey };
