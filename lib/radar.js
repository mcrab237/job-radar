// The watcher: checks every source on a timer, records new jobs, decides which
// ones match what you're looking for, and sends alerts for fresh matches.
import { TYPES } from './sources.js';
import { load, save } from './store.js';
import { notify } from './notify.js';
import { fetchDetails } from './jd.js';
import { assess, isRelevant, levelOf, placeOf, parseSalary, yearsRequired, skillsFit, languageFit, DEFAULT_PREFS } from './fit.js';

const listeners = new Set();
export const onEvent = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (e) => listeners.forEach((fn) => { try { fn(e); } catch {} });

// ---------- Matching ----------

const US = /united states|\busa?\b|u\.s\.|americas|north america|,\s*(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/i;
const words = (list) => (list || []).map((s) => s.trim().toLowerCase()).filter(Boolean);

function includesWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

export function matches(job, s) {
  const title = (job.title || '').toLowerCase();
  const kw = words(s.keywords);
  if (kw.length && !kw.some((k) => includesWord(title, k))) return false;
  if (words(s.exclude).some((k) => includesWord(title, k))) return false;
  if (s.remoteOnly) return !!job.remote || (!job.location && job.type === 'page');
  const locs = words(s.locations);
  if (!locs.length || !job.location) return true;
  const loc = job.location.toLowerCase();
  return locs.some((l) =>
    (l === 'remote' && job.remote) ||
    (/^(us|usa|united states|america)$/.test(l) && US.test(job.location)) ||
    loc.includes(l));
}

export function rematchAll() {
  const db = load();
  for (const j of Object.values(db.jobs)) j.match = matches(j, db.settings);
  save();
}

// ---------- Your filter ----------

export const prefsOf = (settings) => ({ ...DEFAULT_PREFS, ...(settings.prefs || {}) });

export function isExcluded(name, prefs) {
  const n = String(name || '').toLowerCase().trim();
  return (prefs.excludeCompanies || []).some((x) => {
    const e = String(x).toLowerCase().trim();
    return e && (n === e || n.startsWith(`${e} `) || n.startsWith(`${e},`) || n.startsWith(`${e}.`));
  });
}

export function rescore(job, source, settings = load().settings) {
  const prefs = prefsOf(settings);
  job.fit = assess(job, source?.meta || {}, prefs, settings.skillsBank || []);
  if (isExcluded(job.company, prefs) || isExcluded(source?.name, prefs)) {
    job.fit.ok = false;
    job.fit.why = ['company you excluded', ...job.fit.why];
  }
  job.fit.enriched = !!job.enrich;
}

const YEARS_VERSION = 4; // bump when the years or language reader changes, so saved jobs are re-read

export function rescoreAll() {
  const db = load();
  const sources = Object.fromEntries(db.sources.map((s) => [s.id, s]));
  for (const j of Object.values(db.jobs)) {
    if (j.enrich && j.enrich.yv !== YEARS_VERSION && (j.app?.jd || j.enrich.jdHead)) {
      j.enrich.years = yearsRequired(j.app?.jd || j.enrich.jdHead);
      j.enrich.lang = languageFit(j.app?.jd || j.enrich.jdHead, j.title);
      j.enrich.yv = YEARS_VERSION;
    }
    rescore(j, sources[j.sourceId], db.settings);
  }
  save();
}

// Worth reading the full description? Software role, not a lead role, in a place that could work.
function worthReading(job, prefs) {
  if (!isRelevant(job.title) || levelOf(job.title) === 'lead') return false;
  if (/^\d+ locations?$/i.test(job.location || '') || !job.location) return true;
  return !!placeOf(job, 1e9, prefs);
}

// ---------- Reading job descriptions in the background ----------

const queue = [];
const queued = new Set();
let active = 0;
let toNotify = [];
export const enrichStatus = () => ({ left: queue.length + active });

function enqueue(job) {
  if (job.enrich || queued.has(job.uid)) return;
  queued.add(job.uid);
  queue.push(job.uid);
  pump();
}

function pump() {
  while (active < 4 && queue.length) {
    const uid = queue.shift();
    active++;
    enrichOne(uid).catch(() => {}).finally(() => {
      active--;
      queued.delete(uid);
      if (!queue.length && !active) flushAlerts();
      else pump();
    });
  }
}

async function enrichOne(uid) {
  const db = load();
  const job = db.jobs[uid];
  if (!job || job.enrich) return;
  const source = db.sources.find((s) => s.id === job.sourceId);
  try {
    const d = await fetchDetails(job, source);
    const text = d.text || '';
    job.enrich = {
      salary: job.salaryPosted || parseSalary(job.salaryText) || parseSalary(text),
      years: yearsRequired(text),
      lang: languageFit(text, job.title),
      yv: YEARS_VERSION,
      skills: skillsFit(text, db.settings.skillsBank || []),
      jdHead: text.slice(0, 4000),
      at: new Date().toISOString(),
    };
    if (d.location) Object.assign(job, { location: d.location, remote: job.remote || d.remote }), (job.enrich.location = d.location);
    job.app ||= { contacts: [] };
    if (!job.app.jd && text.length > 200) job.app.jd = text.slice(0, 20000);
  } catch (e) {
    job.enrich = { failed: e.message, at: new Date().toISOString(), salary: job.salaryPosted || parseSalary(job.salaryText) };
  }
  rescore(job, source, db.settings);
  if (job.alertPending && job.fit.ok) toNotify.push(job);
  delete job.alertPending;
  save();
  if (queue.length % 25 === 0) emit({ type: 'status' });
}

function flushAlerts() {
  const db = load();
  emit({ type: 'status' });
  emit({ type: 'jobs' });
  if (!toNotify.length) return;
  const jobs = toNotify.sort((a, b) => b.fit.score - a.fit.score);
  toNotify = [];
  notify(jobs, db.settings);
  emit({ type: 'new-jobs', jobs: jobs.map(slim) });
}

// ---------- Checking sources ----------

let running = false;
let timer = null;
export const status = { checking: false, lastRun: null, nextRun: null, current: '' };

export async function checkSource(source, { force = false } = {}) {
  const db = load();
  const now = new Date().toISOString();
  const firstRun = !source.baselineAt;
  const every = TYPES[source.type]?.everyMinutes;
  if (!force && every && source.lastChecked && Date.now() - Date.parse(source.lastChecked) < every * 60e3 - 30e3) return;
  const prefs = prefsOf(db.settings);
  try {
    status.current = source.name;
    emit({ type: 'status' });
    const jobs = await TYPES[source.type].fetch(source.token);
    const live = new Set();
    for (const j of jobs) {
      const uid = `${source.id}:${j.id}`;
      const existing = db.jobs[uid];
      // Only keep software roles (and anything matching your title words) so the file stays small.
      if (!existing && !isRelevant(j.title) && !matches({ ...j, company: j.company || source.name }, db.settings)) continue;
      live.add(uid);
      if (existing) {
        Object.assign(existing, { title: j.title, url: j.url, applyUrl: j.applyUrl, lastSeen: now });
        if (source.meta) existing.company = source.name;
        // Pay that the board lists (Lever, Ashby) may appear after the job was first saved.
        if (j.salaryPosted || j.salaryText) {
          Object.assign(existing, { salaryPosted: j.salaryPosted || existing.salaryPosted, salaryText: j.salaryText || existing.salaryText });
          if (existing.enrich && existing.enrich.salary?.source !== 'posted') {
            existing.enrich.salary = existing.salaryPosted || parseSalary(existing.salaryText) || existing.enrich.salary;
            rescore(existing, source, db.settings);
          }
        }
        if (!existing.enrich?.location) Object.assign(existing, { location: j.location, remote: j.remote });
        if (existing.closedAt) delete existing.closedAt;
        continue;
      }
      const job = {
        uid, ...j, id: undefined, extId: j.id,
        // Companies from the built-in list keep their proper name ("Modern Treasury", not "Moderntreasury").
        company: (source.meta && source.name) || j.company || source.name,
        type: source.type,
        sourceId: source.id,
        firstSeen: now,
        lastSeen: now,
        // On the first check everything already exists, so only jobs posted in
        // the last day count as "just posted". After that, anything new is.
        fresh: firstRun ? !!(j.postedAt && Date.now() - Date.parse(j.postedAt) < 864e5) : true,
        status: 'new',
      };
      job.match = matches(job, db.settings);
      rescore(job, source, db.settings);
      db.jobs[uid] = job;
      if (worthReading(job, prefs) && !isExcluded(job.company, prefs)) {
        if (!firstRun) job.alertPending = true;
        enqueue(job);
      }
    }
    for (const j of Object.values(db.jobs)) {
      if (j.sourceId === source.id && !live.has(j.uid) && !j.closedAt && db.jobs[j.uid] && j.lastSeen !== now && j.type !== 'manual') j.closedAt = now;
    }
    Object.assign(source, { lastChecked: now, lastError: null, jobCount: jobs.length });
    if (firstRun) source.baselineAt = now;
  } catch (e) {
    Object.assign(source, { lastChecked: now, lastError: e.message || String(e) });
  }
  save();
}

export async function checkAll({ force = false } = {}) {
  if (running) return;
  running = true;
  status.checking = true;
  emit({ type: 'status' });
  const db = load();
  const list = [...db.sources.filter((s) => !s.paused)];
  const worker = async () => {
    while (list.length) await checkSource(list.shift(), { force });
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  running = false;
  status.checking = false;
  status.current = '';
  status.lastRun = new Date().toISOString();
  pruneOld();
  // Jobs found earlier but never read (e.g. the app was closed mid-way).
  const prefs = prefsOf(db.settings);
  for (const j of Object.values(db.jobs)) if (!j.enrich && !j.closedAt && worthReading(j, prefs) && !isExcluded(j.company, prefs)) enqueue(j);
  if (!queue.length && !active) flushAlerts();
  emit({ type: 'status' });
  emit({ type: 'jobs' });
}

// Keep the file small: forget closed jobs you never touched after 30 days.
function pruneOld() {
  const db = load();
  const cutoff = Date.now() - 30 * 864e5;
  for (const [uid, j] of Object.entries(db.jobs)) {
    if (j.closedAt && j.status === 'new' && Date.parse(j.closedAt) < cutoff) delete db.jobs[uid];
  }
  save();
}

export const slim = (j) => ({ uid: j.uid, title: j.title, company: j.company, location: j.location, url: j.url, applyUrl: j.applyUrl });

export function schedule() {
  clearTimeout(timer);
  const mins = Math.max(1, Number(load().settings.intervalMinutes) || 5);
  status.nextRun = new Date(Date.now() + mins * 60e3).toISOString();
  timer = setTimeout(async () => { await checkAll(); schedule(); }, mins * 60e3);
  emit({ type: 'status' });
}
