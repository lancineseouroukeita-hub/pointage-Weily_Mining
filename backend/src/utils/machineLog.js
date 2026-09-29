// Lecture des fichiers de pointage exportés par une machine à empreinte
// (demande de Lancine du 29/09/2026 : adapter l'app à une pointeuse
// biométrique dont la marque n'est pas encore connue). Aucune marque n'est
// supposée : on accepte les formats d'export les plus courants —
//   - ZKTeco « attlog.dat / *_attlog.txt » (clé USB) : "147<TAB>2026-09-28 08:01:23<TAB>1<TAB>0..."
//   - exports CSV / TXT / Excel (.xlsx) des logiciels des machines (ZKTime,
//     ZKBio, Hikvision iVMS, Anviz...) : une ligne par pointage avec au
//     minimum un numéro d'employé et une date+heure (dans une seule colonne
//     ou dans deux colonnes Date / Heure).
// Le NUMÉRO enregistré dans la machine pour chaque travailleur doit être
// son MATRICULE dans l'app (voir machine.controller.js, findEmployeeByPin).
const ExcelJS = require('exceljs');

// Deux pointages du même travailleur à moins de 2 minutes d'écart = un
// doigt posé deux fois par réflexe : on n'en garde qu'un.
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
// Tous les pointages d'un travailleur qui tombent dans les 18h suivant son
// PREMIER pointage appartiennent au même poste de travail — gère les postes
// de nuit (22h -> 6h le lendemain restent UNE journée, datée du jour
// d'arrivée) sans mélanger deux journées de jour (8h lundi -> 8h mardi = 24h).
const SHIFT_MAX_MS = 18 * 60 * 60 * 1000;

function stripAccents(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function norm(s) {
  return stripAccents(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Construit une Date à l'heure LOCALE du serveur (comme le reste de l'app,
// voir workday.js) — la machine enregistre l'heure affichée sur son écran,
// sans fuseau.
function mk(y, mo, d, h, mi, s) {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, s || 0);
  return date.getMonth() === mo - 1 ? date : null;
}

// Heure seule "8:01", "08:01:23", "8:01 PM" -> [h, m, s] ou null.
function parseTime(str) {
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|AM|PM)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = (m[4] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return [h, Number(m[2]), Number(m[3] || 0)];
}

// Date seule -> [y, mo, d] ou null. JJ/MM/AAAA par défaut (usage en Guinée),
// MM/JJ/AAAA seulement si le 2e nombre dépasse 12.
function parseDate(str) {
  const s = String(str).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    return b > 12 ? [Number(m[3]), a, b] : [Number(m[3]), b, a];
  }
  return null;
}

// Date + heure dans une seule chaîne ("2026-09-28 08:01:23", "28/09/2026 8:01").
function parseDateTime(str) {
  const s = String(str).trim().replace('T', ' ');
  const m = s.match(/^(\S+)\s+(.+)$/);
  if (!m) return null;
  const d = parseDate(m[1]);
  const t = parseTime(m[2].replace(/(\.\d+)?(z|[+-]\d{2}:?\d{2})?$/i, ''));
  if (!d || !t) return null;
  return mk(d[0], d[1], d[2], t[0], t[1], t[2]);
}

// Une cellule Excel peut déjà être un objet Date (exceljs lit les dates
// Excel comme des Date UTC représentant l'heure affichée) : on recompose en
// heure locale pour rester cohérent avec parseDateTime.
function cellToParts(v) {
  if (v instanceof Date) {
    const onlyTime = v.getUTCFullYear() < 1901; // cellule "heure" Excel (base 1899-12-30)
    return {
      date: onlyTime ? null : [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()],
      time: [v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds()],
      full: onlyTime ? null : mk(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds()),
      hasTime: onlyTime || v.getUTCHours() + v.getUTCMinutes() + v.getUTCSeconds() > 0,
    };
  }
  const s = v == null ? '' : String(v).trim();
  const full = parseDateTime(s);
  if (full) return { full, date: null, time: null, hasTime: true };
  return { full: null, date: parseDate(s), time: parseTime(s), hasTime: !!parseTime(s) };
}

function cleanPin(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/^'+/, '').replace(/^"+|"+$/g, '');
  return /^[A-Za-z]{0,3}\d{1,15}$/.test(s) ? s : null;
}

const PIN_HEADERS = /^(ac no|no|id|user id|userid|pin|matricule|mat|badge|enroll number|enroll no|enrollnumber|employee id|employee no|emp no|person id|personne id|id personne|n|numero|code|code employe|identifiant)$/;
const DATETIME_HEADERS = /^(date time|datetime|time|heure de pointage|checktime|check time|punch time|pointage|horodatage|date heure|date et heure|attendance time|event time)$/;
const DATE_HEADERS = /^(date|jour|attendance date)$/;
const TIME_HEADERS = /^(heure|hour|time only|horaire)$/;

// Lit les lignes d'un fichier -> tableaux de cellules (texte ou Date).
async function readRows(buffer, filename) {
  const head = buffer.slice(0, 8);
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    const err = new Error('Ancien format Excel (.xls) non pris en charge : ouvrez le fichier dans Excel et enregistrez-le en .xlsx ou en .csv, puis réimportez-le.');
    err.statusCode = 400;
    throw err;
  }
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer);
    } catch (e) {
      const err = new Error('Fichier Excel illisible.');
      err.statusCode = 400;
      throw err;
    }
    const rows = [];
    workbook.worksheets.forEach((sheet) => {
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cells = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          let v = cell.value;
          if (v && typeof v === 'object' && !(v instanceof Date)) v = v.result !== undefined ? v.result : (v.text || (v.richText ? v.richText.map((r) => r.text).join('') : ''));
          cells[col - 1] = v;
        });
        rows.push(cells);
      });
    });
    return rows;
  }
  // Texte : certaines machines exportent en UTF-16 (BOM FF FE).
  let text;
  if (head[0] === 0xff && head[1] === 0xfe) text = buffer.slice(2).toString('utf16le');
  else text = buffer.toString('utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const sample = lines.slice(0, 20).join('\n');
  const delim = sample.includes('\t') ? '\t'
    : (sample.split(';').length > sample.split(',').length ? ';' : ',');
  return lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
}

// Interprète les lignes -> pointages { pin, at } + statistiques.
function rowsToPunches(rows) {
  let map = null; // colonnes repérées via une ligne d'en-tête
  const punches = [];
  let ignored = 0;
  const ignoredSamples = [];

  for (const raw of rows) {
    const cells = raw.map((c) => (c === undefined ? '' : c));
    const parts = cells.map(cellToParts);
    const anyDate = parts.some((p) => p.full || p.date);

    if (!anyDate) {
      // Ligne sans aucune date : peut-être l'en-tête.
      const headers = cells.map(norm);
      const pinCol = headers.findIndex((h) => PIN_HEADERS.test(h));
      const dtCol = headers.findIndex((h) => DATETIME_HEADERS.test(h));
      const dCol = headers.findIndex((h) => DATE_HEADERS.test(h));
      const tCol = headers.findIndex((h) => TIME_HEADERS.test(h));
      if (pinCol >= 0 && (dtCol >= 0 || dCol >= 0)) map = { pinCol, dtCol, dCol, tCol };
      continue;
    }

    let pin = null;
    let at = null;
    if (map) {
      pin = cleanPin(cells[map.pinCol]);
      if (map.dtCol >= 0 && parts[map.dtCol]) {
        const p = parts[map.dtCol];
        if (p.full) at = p.full;
        else if (p.date && map.tCol >= 0 && parts[map.tCol] && parts[map.tCol].time) {
          const t = parts[map.tCol].time;
          at = mk(p.date[0], p.date[1], p.date[2], t[0], t[1], t[2]);
        }
      }
      if (!at && map.dCol >= 0 && parts[map.dCol]) {
        const p = parts[map.dCol];
        if (p.full && p.hasTime) at = p.full;
        const tp = map.tCol >= 0 ? parts[map.tCol] : (map.dtCol >= 0 ? parts[map.dtCol] : null);
        if (!at && p.date && tp && tp.time) at = mk(p.date[0], p.date[1], p.date[2], tp.time[0], tp.time[1], tp.time[2]);
      }
    }
    if (!at) {
      // Sans en-tête exploitable : 1re cellule date+heure, ou 1re date + 1re heure.
      const fullIdx = parts.findIndex((p) => p.full && p.hasTime);
      if (fullIdx >= 0) at = parts[fullIdx].full;
      else {
        const dIdx = parts.findIndex((p) => p.date);
        const tIdx = parts.findIndex((p, i) => i !== dIdx && p.time);
        if (dIdx >= 0 && tIdx >= 0) {
          const d = parts[dIdx].date, t = parts[tIdx].time;
          at = mk(d[0], d[1], d[2], t[0], t[1], t[2]);
        }
      }
    }
    if (!pin) {
      for (let i = 0; i < cells.length; i++) {
        if (parts[i].full || parts[i].date || parts[i].time) continue;
        pin = cleanPin(cells[i]);
        if (pin) break;
      }
    }
    if (pin && at) punches.push({ pin, at });
    else {
      ignored++;
      if (ignoredSamples.length < 5) ignoredSamples.push(cells.map((c) => (c instanceof Date ? c.toISOString() : String(c))).join(' | ').slice(0, 120));
    }
  }
  return { punches, ignored, ignoredSamples };
}

async function parseMachineFile(buffer, filename) {
  const rows = await readRows(buffer, filename);
  return rowsToPunches(rows);
}

// Regroupe les pointages (Date) d'UN travailleur en postes de travail.
function groupShifts(times) {
  const sorted = times.map((t) => new Date(t)).sort((a, b) => a - b);
  const shifts = [];
  let current = null;
  let last = null;
  for (const t of sorted) {
    if (last && t - last < DUPLICATE_WINDOW_MS) continue;
    if (!current || t - current[0] > SHIFT_MAX_MS) {
      current = [t];
      shifts.push(current);
    } else current.push(t);
    last = t;
  }
  return shifts;
}

// Répartit les pointages d'un poste sur les 4 étapes de la journée — même
// ordre que la carte de pointage papier WEILY-MINING et l'écran kiosque :
// 1 = arrivée · 2 = arrivée + départ · 3 = arrivée + pause (départ encore à
// venir) · 4 = les 4 étapes · plus de 4 = 1er, 2e, 3e et DERNIER.
function assignShift(times, now = new Date()) {
  const n = times.length;
  const r = { arrivalAt: times[0], breakStartAt: null, breakEndAt: null, departureAt: null, anomaly: null };
  const closed = now - times[0] > SHIFT_MAX_MS; // poste terminé : plus rien n'arrivera
  if (n === 2) r.departureAt = times[1];
  if (n >= 3) { r.breakStartAt = times[1]; r.breakEndAt = times[2]; }
  if (n >= 4) r.departureAt = times[n - 1];
  if (n === 1 && closed) r.anomaly = 'Un seul pointage (départ manquant)';
  if (n === 3 && closed) r.anomaly = '3 pointages (départ manquant)';
  if (n > 4) r.anomaly = `${n} pointages (intermédiaires ignorés)`;
  return r;
}

function shiftDate(first) {
  return new Date(first.getFullYear(), first.getMonth(), first.getDate());
}

module.exports = { parseMachineFile, rowsToPunches, groupShifts, assignShift, shiftDate, parseDateTime, cleanPin };
