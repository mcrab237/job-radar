// Job Radar: a local server on http://localhost:4870 that watches job sources
// and serves the dashboard. Only reachable from this computer.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { load, save, flush, DEFAULT_SETTINGS } from './lib/store.js';
import { detect, quickSearches, TYPES } from './lib/sources.js';
import { checkAll, checkSource, schedule, status, onEvent, rematchAll, rescoreAll, enrichStatus, prefsOf, isExcluded } from './lib/radar.js';
import { pickForToday, capPerCompany, pickSmaller, dmWorthy, mixFor, isDream } from './lib/fit.js';
import { notify } from './lib/notify.js';
import { closeBrowser } from './lib/autofill.js';
import { handle as handleApp, todayCount } from './lib/applications.js';
import { handle as handlePractice } from './lib/practice.js';
import { hasKey, listModels, LIGHT_DEFAULT } from './lib/ai.js';
import { closePdf } from './lib/pdf.js';
import { syncLogos, logoFor, logoFile } from './lib/logos.js';
import { outreachOf } from './lib/outreach-style.js';
import { REASONS, snapshot, recentRemovals, adjusted } from './lib/removals.js';
import { chooseReplacement } from './lib/ai.js';
import { gate, isLocal, access, setAccess, addresses, MAC_ONLY, tailscaleStatus, tailscaleLoginLink } from './lib/access.js';

const PORT = Number(process.env.PORT || 4870);
const PUBLIC = path.join(path.dirname(new URL(import.meta.url).pathname), 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 25e6) req.destroy(); });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});
const id = () => Math.random().toString(36).slice(2, 10);

function sortTime(j) {
  const posted = j.postedAt ? Date.parse(j.postedAt) : 0;
  const seen = j.fresh ? Date.parse(j.firstSeen) : 0;
  return Math.max(posted, seen) || Date.parse(j.firstSeen);
}

const CATALOG = JSON.parse(fs.readFileSync(new URL('./lib/companies.json', import.meta.url), 'utf8'));
const ACTIVE = ['new', 'saved'];
const isOpen = (j) => !j.closedAt && j.status !== 'hidden';
const dayAgo = () => Date.now() - 864e5;

// The jobs that pass your filter, best first, at most N per company.
function goodJobs(db) {
  const prefs = prefsOf(db.settings);
  const jobs = Object.values(db.jobs).filter((j) => isOpen(j) && j.fit?.ok && ACTIVE.includes(j.status));
  return capPerCompany(jobs.sort((a, b) => b.fit.score - a.fit.score || sortTime(b) - sortTime(a)), prefs.perCompanyMax);
}

// Which week of the study plan you're in (1 before it starts).
function planWeek(db) {
  const start = db.practice?.startedAt;
  if (!start) return 1;
  const days = Math.floor((Date.now() - Date.parse(start)) / 864e5);
  return days < 0 ? 1 : Math.floor(days / 7) + 1;
}

function mixOf(db) {
  const prefs = prefsOf(db.settings);
  const week = planWeek(db);
  return { ...mixFor(prefs, week, db.settings.dailyGoal || 5), week, dreamHeld: week < (prefs.dreamFromWeek || 0), dreamFromWeek: prefs.dreamFromWeek };
}

// Today's picks: top picks (payments first, best paid) and smaller / lower-paying
// companies, mostly Atlanta. How many of each depends on your plan week. Dream
// companies wait until you're ready. Only the strongest few are marked for a DM.
const todayKey = () => new Date().toLocaleDateString('en-CA');
// Your target companies (the main list). The "smaller" group only shows up when you ask for smaller picks.
const isTarget = (db, j) => { const m = db.sources.find((s) => s.id === j.sourceId)?.meta; return m?.group !== 'smaller'; };
const usable = (j) => j && isOpen(j) && j.fit?.ok && j.fit.enriched && ACTIVE.includes(j.status);
// Replacements chosen today for jobs you removed (they keep their slot all day).
const todayPins = (db) => (db.pins?.day === todayKey() ? db.pins.items : []).filter((p) => usable(db.jobs[p.uid]));

function picks(db) {
  const prefs = prefsOf(db.settings);
  const mix = mixOf(db);
  const held = (j) => mix.dreamHeld && isDream(j.company, prefs);
  const removed = recentRemovals(db);
  const pins = todayPins(db);
  const pinned = new Set(pins.map((p) => p.uid));
  const orig = (j) => db.jobs[j.uid];
  const top = Math.max(1, mix.top);
  const pinMain = pins.filter((p) => p.track === 'main').slice(0, top);
  const pinSmall = pins.filter((p) => p.track === 'smaller').slice(0, mix.smaller);
  // Jobs like the ones you removed rank lower (adjusted copies are only used to choose).
  const pool = adjusted(goodJobs(db).filter((j) => j.fit.enriched && !held(j) && !pinned.has(j.uid) && isTarget(db, j)), removed);
  const main = [...pinMain.map((p) => ({ ...db.jobs[p.uid], why: p.why })), ...pickForToday(pool, prefs, top - pinMain.length).map(orig)]
    .sort((a, b) => b.fit.score - a.fit.score)
    .map((j) => ({ ...j, track: 'main' }));
  const meta = Object.fromEntries(db.sources.map((s) => [s.id, s.meta]));
  // Smaller companies can have more jobs than the per-company cap allows in goodJobs, so look at all good jobs.
  const all = adjusted(Object.values(db.jobs).filter((j) => usable(j) && !held(j) && !pinned.has(j.uid)), removed);
  const smaller = [...pinSmall.map((p) => ({ ...db.jobs[p.uid], why: p.why })), ...pickSmaller(all, (j) => meta[j.sourceId], prefs, mix.smaller - pinSmall.length, new Set(main.map((j) => j.uid))).map(orig)]
    .map((j) => ({ ...j, track: 'smaller', smallCo: meta[j.sourceId]?.group === 'smaller' }));
  // At most 3 DMs a day: the 2 strongest top picks and 1 smaller company.
  const strong = [
    ...main.filter((j) => dmWorthy(j)).sort((a, b) => b.fit.score - a.fit.score).slice(0, 2),
    ...smaller.filter((j) => dmWorthy(j, j.smallCo)).sort((a, b) => b.fit.score - a.fit.score).slice(0, 1),
  ].map((j) => j.uid);
  return [...main, ...smaller].map((j) => ({ ...j, dm: strong.includes(j.uid) }));
}

// After you remove a pick: the best candidates for its slot, and (with your
// OpenAI key) the one that best avoids why you removed it.
async function findReplacement(db, track, gone, others) {
  const prefs = prefsOf(db.settings);
  const mix = mixOf(db);
  const held = (j) => mix.dreamHeld && isDream(j.company, prefs);
  const removed = recentRemovals(db);
  const skip = new Set([...others, ...todayPins(db).map((p) => p.uid)]);
  let cands;
  if (track === 'smaller') {
    const meta = Object.fromEntries(db.sources.map((s) => [s.id, s.meta]));
    const all = adjusted(Object.values(db.jobs).filter((j) => usable(j) && !held(j)), removed);
    cands = pickSmaller(all, (j) => meta[j.sourceId], prefs, 12, skip);
  } else {
    const pool = adjusted(goodJobs(db).filter((j) => j.fit.enriched && !held(j) && !skip.has(j.uid) && isTarget(db, j)), removed);
    cands = pickForToday(pool, { ...prefs, frontendShare: 100 }, 12);
  }
  if (!cands.length) return null;
  let choice = { uid: cands[0].uid, why: 'The next best match.' };
  if (hasKey()) {
    const brief = (j) => ({ uid: j.uid, title: j.title, company: j.company, level: j.fit.level, years: j.fit.years, language: j.fit.lang, pay: j.fit.salary ? `$${Math.round(j.fit.salary.min / 1000)}k-$${Math.round(j.fit.salary.max / 1000)}k` : 'unknown', place: j.fit.place, payments: !!j.fit.payments, score: Math.round(j.fit.score) });
    try {
      const out = await chooseReplacement({
        removed: { ...brief(gone), reason: REASONS[gone.removed.reason], note: gone.removed.note },
        history: removed.slice(1, 16).map((r) => ({ title: r.snap.title, company: r.snap.company, reason: REASONS[r.reason], note: r.note })),
        candidates: cands.map(brief),
      });
      if (cands.some((j) => j.uid === out.uid)) choice = { uid: out.uid, why: out.why };
    } catch {}
  }
  const day = todayKey();
  if (db.pins?.day !== day) db.pins = { day, items: [] };
  db.pins.items.push({ uid: choice.uid, track, why: choice.why, for: gone.uid });
  const j = db.jobs[choice.uid];
  return { uid: j.uid, title: j.title, company: j.company, why: choice.why };
}

// AI use today and over the last 7 days (tokens and web searches).
function usageSummary(db) {
  const all = db.aiUsage || {};
  const days = Object.keys(all).sort();
  const today = new Date().toLocaleDateString('en-CA');
  const sum = (keys) => keys.reduce((a, k) => { const d = all[k]; a.calls += d.calls; a.input += d.input; a.cached += d.cached; a.output += d.output; a.searches += d.searches; return a; }, { calls: 0, input: 0, cached: 0, output: 0, searches: 0 });
  const tasks = {};
  for (const k of days.slice(-7)) for (const [n, t] of Object.entries(all[k].tasks || {})) { const x = (tasks[n] ||= { calls: 0, input: 0, output: 0, searches: 0 }); x.calls += t.calls; x.input += t.input; x.output += t.output; x.searches += t.searches; }
  return { today: sum(days.filter((d) => d === today)), week: sum(days.slice(-7)), tasks };
}

function statePayload(req) {
  const db = load();
  const jobs = Object.values(db.jobs);
  const open = jobs.filter(isOpen);
  const good = goodJobs(db);
  const { openaiKey, remote, ...settings } = db.settings;
  const local = !req || isLocal(req);
  const acc = access();
  settings.prefs = prefsOf(db.settings);
  settings.outreach = outreachOf(db.settings);
  const key = openaiKey || process.env.OPENAI_API_KEY || '';
  const inCatalog = new Set(db.sources.map((s) => `${s.type}:${String(s.token).toLowerCase()}`));
  return {
    settings,
    ai: { hasKey: hasKey(), keyHint: key ? `…${key.slice(-4)}` : '', model: db.settings.aiModel, modelLight: db.settings.aiModelLight || LIGHT_DEFAULT, usage: usageSummary(db) },
    resumes: db.resumes.map((r) => ({ id: r.id, name: r.name })),
    hasCoverSample: !!db.coverSample,
    today: todayCount(),
    applied: { total: jobs.filter((j) => j.appliedAt).length, week: jobs.filter((j) => j.appliedAt && Date.now() - Date.parse(j.appliedAt) < 7 * 864e5).length },
    mix: mixOf(db),
    dailyTarget: mixOf(db).top + mixOf(db).smaller,
    client: { remote: !local },
    access: { enabled: acc.enabled, code: local ? acc.code : null, urls: local ? addresses(PORT) : [] },
    sources: db.sources.map((s) => ({ ...s, label: TYPES[s.type]?.label || s.type, logo: logoFor(s.name) })),
    status: { ...status, reading: enrichStatus().left },
    quickSearches: quickSearches(db.settings),
    catalog: {
      core: CATALOG.filter((c) => c.group === 'core').length,
      smaller: CATALOG.filter((c) => c.group === 'smaller').length,
      added: CATALOG.filter((c) => inCatalog.has(`${c.type}:${c.token.toLowerCase()}`)).length,
    },
    counts: {
      removed: jobs.filter((j) => j.status === 'hidden' && j.removed).length,
      picks: picks(db).length,
      best: good.length,
      today: good.filter((j) => j.fresh && sortTime(j) > dayAgo()).length,
      all: open.length,
      saved: jobs.filter((j) => j.status === 'saved').length,
      applied: jobs.filter((j) => ['applied', 'interview', 'offer'].includes(j.status)).length,
    },
  };
}

// Who you've contacted about a job, in short (for the board).
const reachOf = (app) => {
  const c = app?.contacts || [];
  return { people: c.length, messaged: c.filter((x) => ['messaged', 'request sent', 'replied'].includes(x.status)).length, replied: c.filter((x) => x.status === 'replied').length };
};

const slimJob = ({ app, enrich, ...j }) => ({
  ...j,
  reach: reachOf(app),
  logo: logoFor(j.company),
  dream: isDream(j.company, prefsOf(load().settings)),
  sortTime: new Date(sortTime(j)).toISOString(),
  tailored: !!app?.resume,
  approved: !!app?.approvedAt,
  years: enrich?.years ?? null,
});

function listJobs(params) {
  const db = load();
  const view = params.get('view') || 'picks';
  const q = (params.get('q') || '').toLowerCase().trim();
  const source = params.get('source');
  let jobs;
  if (view === 'pipeline') jobs = Object.values(db.jobs).filter((j) => ['saved', 'applied', 'interview', 'offer', 'rejected'].includes(j.status));
  else if (view === 'removed') jobs = Object.values(db.jobs).filter((j) => j.status === 'hidden' && j.removed).sort((a, b) => Date.parse(b.removed.at) - Date.parse(a.removed.at));
  else if (view === 'picks') jobs = picks(db);
  else if (view === 'best') jobs = goodJobs(db);
  else if (view === 'today') jobs = goodJobs(db).filter((j) => j.fresh && sortTime(j) > dayAgo()).sort((a, b) => sortTime(b) - sortTime(a));
  else jobs = Object.values(db.jobs).filter(isOpen).sort((a, b) => sortTime(b) - sortTime(a));
  if (source) jobs = jobs.filter((j) => j.sourceId === source);
  if (q) jobs = jobs.filter((j) => `${j.title} ${j.company} ${j.location} ${j.department}`.toLowerCase().includes(q));
  const total = jobs.length;
  return { total, jobs: jobs.slice(0, Number(params.get('limit') || 200)).map(slimJob) };
}

// Adds the companies from the built-in list as sources.
function importCatalog(groups) {
  const db = load();
  const prefs = prefsOf(db.settings);
  const have = new Set(db.sources.map((s) => `${s.type}:${String(s.token).toLowerCase()}`));
  let added = 0;
  for (const c of CATALOG) {
    if (!groups.includes(c.group) || isExcluded(c.name, prefs)) continue;
    if (have.has(`${c.type}:${c.token.toLowerCase()}`)) {
      // Already added by hand: give it the list's pay level and focus.
      const s = db.sources.find((x) => x.type === c.type && String(x.token).toLowerCase() === c.token.toLowerCase());
      if (s) s.meta = { tier: c.tier, focus: c.focus, group: c.group, atlanta: c.atlanta };
      continue;
    }
    db.sources.push({
      id: id(), type: c.type, token: c.token, name: c.name.replace(/ \(.*\)$/, ''), url: TYPES[c.type].boardUrl(c.token),
      addedAt: new Date().toISOString(), meta: { tier: c.tier, focus: c.focus, group: c.group, atlanta: c.atlanta },
    });
    added++;
  }
  save();
  return added;
}

const clients = new Set();
onEvent((e) => { for (const res of clients) res.write(`data: ${JSON.stringify(e)}\n\n`); });

async function api(req, res, url) {
  const db = load();
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  const method = req.method;

  if (parts[0] === 'events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('data: {"type":"hello"}\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clients.delete(res); clearInterval(ping); });
    return;
  }
  if (!isLocal(req) && MAC_ONLY.test(url.pathname)) {
    return send(res, 409, { error: 'This opens on your Mac mini, not this device. Use it there, or do this step by hand here.' });
  }
  if (parts[0] === 'tailscale' && method === 'GET') {
    if (!isLocal(req)) return send(res, 403, { error: 'Check this on the Mac mini.' });
    const st = await tailscaleStatus();
    if (st.ip) st.urls = [`http://${st.ip}:${PORT}`, ...(st.name ? [`http://${st.name.split('.')[0]}:${PORT}`] : [])];
    return send(res, 200, st);
  }
  if (parts[0] === 'tailscale' && parts[1] === 'login' && method === 'POST') {
    if (!isLocal(req)) return send(res, 403, { error: 'Do this on the Mac mini.' });
    return send(res, 200, { url: await tailscaleLoginLink() });
  }
  if (parts[0] === 'access' && method === 'PUT') {
    if (!isLocal(req)) return send(res, 403, { error: 'Change this on the Mac mini.' });
    setAccess(await readBody(req));
    return send(res, 200, statePayload(req));
  }
  if (parts[0] === 'state' && method === 'GET') return send(res, 200, statePayload(req));
  if (parts[0] === 'jobs' && !parts[1] && method === 'GET') return send(res, 200, listJobs(url.searchParams));

  // Remove a job (with a reason) and get a better one in its place.
  if (parts[0] === 'jobs' && parts[1] && parts[2] === 'remove' && method === 'POST') {
    const job = db.jobs[decodeURIComponent(parts[1])];
    if (!job) return send(res, 404, { error: 'Job not found' });
    const b = await readBody(req);
    const reason = REASONS[b.reason] ? b.reason : 'meh';
    const before = picks(db);
    const was = before.find((j) => j.uid === job.uid);
    job.removed = { reason, note: String(b.note || '').slice(0, 200), at: new Date().toISOString(), prevStatus: job.status === 'hidden' ? 'new' : job.status, snap: snapshot(job), track: was?.track || null };
    job.status = 'hidden';
    if (reason === 'company') {
      const prefs = prefsOf(db.settings);
      if (!isExcluded(job.company, prefs)) {
        db.settings.prefs = { ...prefs, excludeCompanies: [...(prefs.excludeCompanies || []), job.company] };
        job.removed.excludedCompany = job.company;
        rescoreAll();
      }
    }
    let replacement = null;
    if (was) replacement = await findReplacement(db, was.track, job, before.filter((j) => j.uid !== job.uid).map((j) => j.uid)).catch(() => null);
    save();
    for (const c of clients) c.write(`data: ${JSON.stringify({ type: 'jobs' })}\n\n`);
    return send(res, 200, { ok: true, replacement });
  }

  // Put a removed job back.
  if (parts[0] === 'jobs' && parts[1] && parts[2] === 'restore' && method === 'POST') {
    const job = db.jobs[decodeURIComponent(parts[1])];
    if (!job) return send(res, 404, { error: 'Job not found' });
    const r = job.removed || {};
    job.status = r.prevStatus || 'new';
    if (r.excludedCompany) {
      const prefs = prefsOf(db.settings);
      db.settings.prefs = { ...prefs, excludeCompanies: (prefs.excludeCompanies || []).filter((c) => c !== r.excludedCompany) };
      rescoreAll();
    }
    delete job.removed;
    // Undo means undo: the replacement chosen for it leaves today's list too.
    if (db.pins?.items) db.pins.items = db.pins.items.filter((p) => p.for !== job.uid);
    save();
    for (const c of clients) c.write(`data: ${JSON.stringify({ type: 'jobs' })}\n\n`);
    return send(res, 200, { ok: true });
  }

  if (parts[0] === 'jobs' && parts[1] && method === 'PATCH') {
    const job = db.jobs[decodeURIComponent(parts[1])];
    if (!job) return send(res, 404, { error: 'Job not found' });
    const body = await readBody(req);
    // Undo the last move: drop it from the history as if it never happened.
    if (body.undo && job.history?.length > 1) {
      const last = job.history.pop();
      job.status = job.history.at(-1).status;
      if (last.status === 'applied' && job.appliedAt === last.at) delete job.appliedAt;
      if (last.status === 'interview' && job.interviewAt === last.at) delete job.interviewAt;
      if (last.status === 'rejected') delete job.closedReason;
      save();
      return send(res, 200, { job });
    }
    if (body.status && body.status !== job.status) {
      // Older jobs started before history was kept: write down where they were first.
      if (!job.history?.length) job.history = [{ status: job.status, at: job.appliedAt || job.firstSeen }];
      const now = new Date().toISOString();
      job.status = body.status;
      if (body.status === 'applied' && !job.appliedAt) job.appliedAt = now;
      if (body.status === 'interview' && !job.interviewAt) job.interviewAt = now;
      // A record of every move, for the timeline on the Applications board.
      (job.history ||= []).push({ status: body.status, at: now });
      if (body.status !== 'rejected') delete job.closedReason;
    }
    if (typeof body.notes === 'string') job.notes = body.notes;
    if (typeof body.closedReason === 'string') job.closedReason = body.closedReason;
    if (body.next && typeof body.next === 'object') job.next = { text: String(body.next.text || '').slice(0, 200), at: body.next.at || '' };
    save();
    return send(res, 200, { job });
  }

  if (await handlePractice(req, res, parts, { send, readBody })) return;
  if (await handleApp(req, res, parts, { send, readBody, emit: (e) => { for (const c of clients) c.write(`data: ${JSON.stringify(e)}\n\n`); } })) return;

  if (parts[0] === 'detect' && method === 'POST') {
    const { input } = await readBody(req);
    try {
      const found = await detect(input);
      const known = new Set(db.sources.map((s) => `${s.type}:${String(s.token).toLowerCase()}`));
      return send(res, 200, { found: found.map((f) => ({ ...f, added: known.has(`${f.type}:${String(f.token).toLowerCase()}`) })) });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (parts[0] === 'sources' && !parts[1] && method === 'POST') {
    const b = await readBody(req);
    if (!TYPES[b.type]) return send(res, 400, { error: 'Unknown source type' });
    const dupe = db.sources.find((s) => s.type === b.type && String(s.token).toLowerCase() === String(b.token || '').toLowerCase());
    if (dupe) return send(res, 200, { source: dupe });
    const source = { id: id(), type: b.type, token: b.token || '', name: b.name || TYPES[b.type].label, url: b.url || TYPES[b.type].boardUrl(b.token), addedAt: new Date().toISOString() };
    db.sources.push(source);
    save();
    await checkSource(source);
    for (const c of clients) c.write('data: {"type":"jobs"}\n\n');
    return send(res, 200, { source });
  }

  if (parts[0] === 'sources' && parts[1] && method === 'PATCH') {
    const s = db.sources.find((x) => x.id === parts[1]);
    if (!s) return send(res, 404, { error: 'Not found' });
    const b = await readBody(req);
    if (typeof b.paused === 'boolean') s.paused = b.paused;
    if (typeof b.name === 'string' && b.name.trim()) s.name = b.name.trim();
    save();
    return send(res, 200, { source: s });
  }

  if (parts[0] === 'sources' && parts[1] && method === 'DELETE') {
    db.sources = db.sources.filter((s) => s.id !== parts[1]);
    for (const [uid, j] of Object.entries(db.jobs)) {
      if (j.sourceId === parts[1] && j.status === 'new') delete db.jobs[uid];
    }
    save();
    return send(res, 200, { ok: true });
  }

  if (parts[0] === 'catalog' && method === 'POST') {
    const { groups = ['core', 'smaller'] } = await readBody(req);
    const added = importCatalog(groups);
    checkAll().then(schedule);
    return send(res, 200, { added });
  }

  if (parts[0] === 'check' && method === 'POST') {
    checkAll().then(schedule);
    return send(res, 200, { ok: true });
  }

  if (parts[0] === 'settings' && method === 'PUT') {
    const b = await readBody(req);
    const clean = { ...db.settings };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in b && k !== 'profile' && k !== 'openaiKey') clean[k] = b[k];
    if (typeof b.openaiKey === 'string') {
      const key = b.openaiKey.trim();
      if (key) {
        let models;
        try { models = await listModels(key); } catch (e) { return send(res, 400, { error: e.message }); }
        clean.openaiKey = key;
        if (!clean.aiModel || !models.includes(clean.aiModel)) clean.aiModel = models.find((m) => !/-pro\b/.test(m)) || models[0] || 'gpt-5-mini';
      } else clean.openaiKey = '';
    }
    clean.dailyGoal = Math.min(100, Math.max(1, Number(clean.dailyGoal) || 12));
    if (b.profile) clean.profile = { ...db.settings.profile, ...b.profile };
    if (b.outreach) clean.outreach = { ...(db.settings.outreach || {}), ...b.outreach };
    clean.intervalMinutes = Math.min(1440, Math.max(1, Number(clean.intervalMinutes) || 5));
    if (b.prefs) clean.prefs = { ...prefsOf(db.settings), ...b.prefs };
    const filtersChanged = ['keywords', 'exclude', 'locations', 'remoteOnly'].some((k) => JSON.stringify(clean[k]) !== JSON.stringify(db.settings[k]));
    const prefsChanged = JSON.stringify(clean.prefs || {}) !== JSON.stringify(db.settings.prefs || {}) || JSON.stringify(clean.skillsBank) !== JSON.stringify(db.settings.skillsBank);
    const intervalChanged = clean.intervalMinutes !== db.settings.intervalMinutes;
    db.settings = clean;
    if (filtersChanged) rematchAll();
    if (prefsChanged) { db.settings = clean; rescoreAll(); }
    if (intervalChanged) schedule();
    save();
    return send(res, 200, statePayload(req));
  }

  if (parts[0] === 'test-alert' && method === 'POST') {
    notify([], db.settings, { test: true });
    return send(res, 200, { ok: true });
  }

  if (parts[0] === 'reveal-data' && method === 'POST') {
    execFile('open', [path.dirname(new URL('./data/db.json', import.meta.url).pathname)], () => {});
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (await gate(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/logos/')) {
      const f = logoFile(decodeURIComponent(url.pathname.slice(7)));
      if (!f) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' });
      return fs.createReadStream(f).pipe(res);
    }
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

// Listens on the network too, but other devices are refused unless you turn
// "Use on other devices" on in Settings (and then they need the access code).
server.listen(PORT, '0.0.0.0', async () => {
  load();
  rescoreAll(); // scoring rules may have changed since last time
  syncLogos().catch(() => {}); // fetch any missing company logos in the background
  console.log(`\n  Job Radar is running → http://localhost:${PORT}\n  Keep this window open; it checks for new jobs every ${load().settings.intervalMinutes} min.\n`);
  if (process.argv.includes('--open')) execFile('open', [`http://localhost:${PORT}`], () => {});
  await checkAll();
  schedule();
});

const shutdown = async () => { flush(); await closeBrowser(); await closePdf(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
