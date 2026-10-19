// Your study plan progress: what you've checked off, a practice log, and
// interviews (with the weak spots they showed).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { load, save } from './store.js';
import { DAYS, WEEKS, PROJECT, WEAK_SPOTS, PACE, allItems } from './plan.js';

const KIT = path.join(os.homedir(), 'Projects', 'interview-practice');
const id = () => Math.random().toString(36).slice(2, 10);
const dayKey = (d = new Date()) => new Date(d).toLocaleDateString('en-CA'); // YYYY-MM-DD, your time zone

function stateOf(db) {
  db.practice ||= { startedAt: null, done: {}, log: [], interviews: [] };
  db.practice.resolves ||= {};
  return db.practice;
}

// Spaced repetition: every solved problem comes back 3 days later, then 10 days
// after you first solved it. Returns what's due today (oldest first).
const addDays = (key, n) => { const d = new Date(`${key}T00:00:00`); d.setDate(d.getDate() + n); return dayKey(d); };
function dueResolves(p) {
  const today = dayKey();
  const all = allItems();
  const extra = Object.values(WEAK_SPOTS).flat();
  const out = [];
  for (const [id, d] of Object.entries(p.done)) {
    if (!id.startsWith('lc:') || !d.day) continue;
    const r = p.resolves[id] || {};
    let round = 0;
    let due = null;
    if (!r.r1) { round = 1; due = addDays(d.day, 3); }
    else if (!r.r2) { round = 2; due = addDays(d.day, 10); }
    if (!round || due > today) continue;
    const it = all.find((x) => x.id === id) || extra.find((x) => x.id === id);
    if (it) out.push({ id, title: it.title, level: it.level, url: it.url, round, due, struggled: !!d.struggled });
  }
  return out.sort((a, b) => (a.due < b.due ? -1 : 1));
}

// Rest days (every Saturday from p.rest.from): only applying is required, and
// plan days skip them, so the work moves to the next day instead of piling up.
const isRest = (p, key) => !!p.rest && key >= p.rest.from && new Date(`${key}T12:00:00`).getDay() === p.rest.weekday;

// The date of every plan day (YYYY-MM-DD), skipping rest days, and the rest days in between.
function calendar(p) {
  if (!p.startedAt) return { dates: [], rest: [] };
  const d = new Date(p.startedAt);
  d.setHours(12, 0, 0, 0);
  const dates = [], rest = [];
  while (dates.length < DAYS.length) {
    const k = dayKey(d);
    if (isRest(p, k)) rest.push(k); else dates.push(k);
    d.setDate(d.getDate() + 1);
  }
  return { dates, rest };
}

// Which plan day is today: 0 = not started yet, 1..84, capped at the last day.
// On a rest day it's the next plan day (what tomorrow shows), with rest = true.
function todayInfo(p) {
  if (!p.startedAt) return { today: 0, rest: false };
  const { dates } = calendar(p);
  const k = dayKey();
  if (k < dates[0]) return { today: 0, rest: false };
  const i = dates.findIndex((x) => x >= k);
  if (i === -1) return { today: DAYS.length, rest: false };
  return { today: i + 1, rest: dates[i] !== k };
}
const todayIndex = (p) => todayInfo(p).today;

function stats(p) {
  const items = allItems();
  const done = (i) => !!p.done[i.id];
  const lc = items.filter((i) => i.type === 'leetcode');
  const byLevel = {};
  for (const lvl of ['Easy', 'Medium', 'Hard']) {
    const all = lc.filter((i) => i.level === lvl);
    byLevel[lvl] = { done: all.filter(done).length, total: all.length };
  }
  const slot = (s) => { const all = items.filter((i) => i.slot === s); return { done: all.filter(done).length, total: all.length }; };
  const active = new Set([...Object.values(p.done).map((d) => d.day), ...p.log.map((l) => l.day)]);
  let streak = 0;
  const c = new Date();
  if (!active.has(dayKey(c))) c.setDate(c.getDate() - 1);
  while (active.has(dayKey(c))) { streak++; c.setDate(c.getDate() - 1); }
  const weekAgo = Date.now() - 7 * 864e5;
  return {
    solved: lc.filter(done).length, total: lc.length, byLevel,
    practical: slot('Practical'), prep: slot('Interview prep'), frontend: slot('Frontend prep'), drill: slot('Backend drill'), learn: slot('Learn'),
    resolved: Object.values(p.resolves).reduce((n, r) => n + (r.r1 ? 1 : 0) + (r.r2 ? 1 : 0), 0),
    streak,
    hoursThisWeek: Math.round(p.log.filter((l) => Date.parse(l.at) > weekAgo).reduce((n, l) => n + (l.minutes || 0), 0) / 6) / 10,
    redo: Object.entries(p.done).filter(([, d]) => d.struggled).map(([k]) => k),
  };
}

// ---------- History: what you did each day ----------

const minsOf = (m) => (typeof m === 'number' ? m : Number(String(m || '').match(/\d+/)?.[0]) || 0) * (/h/i.test(String(m)) && !/min/i.test(String(m)) ? 60 : 1);
const SLOT_MINS = { Problems: 30, Practical: 60, 'Interview prep': 60, 'Frontend prep': 60, 'Backend drill': 120, Learn: 30, Apply: 0 };
const APPLY_MINS = 10; // about how long one application takes with the app's help
const RESOLVE_MINS = 20;

// One row per day with any activity: tasks by kind, problems by level,
// re-solves, applications (with companies), minutes logged and estimated.
export function history() {
  const db = load();
  const p = stateOf(db);
  const byId = {};
  for (const d of DAYS) for (const b of d.blocks) for (const it of b.items) byId[it.id] = { ...it, slot: b.slot, planDay: d.day };
  for (const it of Object.values(WEAK_SPOTS).flat()) byId[it.id] ||= { ...it, slot: 'Problems' };
  const days = {};
  const row = (k) => (days[k] ||= { day: k, planDay: null, problems: [], tasks: { Problems: 0, Practical: 0, 'Interview prep': 0, 'Frontend prep': 0, 'Backend drill': 0, Learn: 0, Apply: 0 }, levels: { Easy: 0, Medium: 0, Hard: 0 }, resolves: 0, applied: [], logged: 0, est: 0 });
  for (const [id, d] of Object.entries(p.done)) {
    if (!d.day) continue;
    const it = byId[id] || {};
    const r = row(d.day);
    const slot = it.slot || (id.startsWith('lc:') ? 'Problems' : id.startsWith('rest:') ? 'Apply' : 'Practical');
    r.tasks[slot] = (r.tasks[slot] || 0) + 1;
    if (id.startsWith('lc:')) { r.problems.push({ title: it.title || id.slice(3), level: it.level || '', struggled: !!d.struggled }); if (it.level) r.levels[it.level]++; }
    r.est += slot === 'Apply' ? 0 : minsOf(it.mins) || SLOT_MINS[slot] || 0; // applications are counted one by one below
  }
  for (const r of Object.values(p.resolves)) for (const k of ['r1', 'r2']) if (r[k]) { const x = row(r[k]); x.resolves++; x.est += RESOLVE_MINS; }
  for (const l of p.log) { const k = l.day || dayKey(l.at); row(k).logged += l.minutes || 0; }
  for (const j of Object.values(db.jobs)) {
    if (!j.appliedAt) continue;
    const x = row(dayKey(j.appliedAt));
    x.applied.push({ uid: j.uid, title: j.title, company: j.company, status: j.status });
    x.est += APPLY_MINS;
  }
  const cal = calendar(p);
  const list = Object.values(days).sort((a, b) => (a.day < b.day ? -1 : 1));
  for (const r of list) {
    r.minutes = r.logged || r.est; // what you logged, or an estimate from what you did
    r.estimated = !r.logged && r.est > 0;
    const n = cal.dates.indexOf(r.day);
    r.planDay = n === -1 ? null : n + 1;
    r.rest = cal.rest.includes(r.day);
  }
  // Streaks over days with any activity.
  let best = 0, run = 0, prev = null;
  for (const r of list) { const t = Date.parse(`${r.day}T12:00:00`); run = prev && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = t; }
  const jobs = Object.values(db.jobs);
  const appliedJobs = jobs.filter((j) => j.appliedAt);
  const reached = (j) => ['interview', 'offer'].includes(j.status) || (j.history || []).some((h) => h.status === 'interview' || h.status === 'offer');
  return {
    days: list,
    startedAt: p.startedAt,
    bestStreak: best,
    pipeline: { applied: appliedJobs.length, interviews: appliedJobs.filter(reached).length, offers: jobs.filter((j) => j.status === 'offer').length, closed: jobs.filter((j) => j.status === 'rejected').length, waiting: jobs.filter((j) => j.status === 'applied').length },
  };
}

export function practicePayload() {
  const db = load();
  const p = stateOf(db);
  const { today, rest } = todayInfo(p);
  const week = today ? DAYS[today - 1].week : 1;
  return {
    days: DAYS,
    weeks: WEEKS.map(({ n, theme, goal }) => ({ n, theme, goal })),
    project: PROJECT,
    weakSpots: WEAK_SPOTS,
    today,
    todayRest: rest,
    calendar: calendar(p),
    week,
    pace: PACE.find((x) => week <= x.until) || PACE.at(-1),
    state: p,
    weak: [...new Set(p.interviews.flatMap((i) => i.weak || []))],
    resolvesDue: dueResolves(p),
    stats: (() => {
      // Hours this week: logged time, or an estimate from what you did (same as Today and Stats).
      const st = stats(p);
      const since = dayKey(new Date(Date.now() - 6 * 864e5));
      const mins = history().days.filter((d) => d.day >= since).reduce((a, d) => a + d.minutes, 0);
      return { ...st, hoursThisWeek: Math.round(mins / 6) / 10 };
    })(),
    kitInstalled: fs.existsSync(path.join(KIT, 'package.json')),
  };
}

// Opens a practice-kit exercise in your editor.
function openKit(name) {
  const dir = path.join(KIT, 'exercises', name);
  if (!fs.existsSync(dir)) return false;
  const files = [KIT, path.join(dir, 'README.md'), path.join(dir, 'solution.ts')];
  execFile('open', ['-a', 'Visual Studio Code', ...files], (err) => {
    if (err) execFile('open', ['-a', 'Cursor', ...files], () => {});
  });
  return true;
}

// Returns true when it handled the request.
export async function handle(req, res, parts, { send, readBody }) {
  if (parts[0] !== 'practice') return false;
  const db = load();
  const p = stateOf(db);
  const b = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};

  if (req.method === 'GET' && !parts[1]) return send(res, 200, practicePayload()), true;
  if (req.method === 'GET' && parts[1] === 'history') return send(res, 200, history()), true;

  // The task description for a practice-kit exercise (works from the laptop too).
  if (req.method === 'GET' && parts[1] === 'kit' && /^[a-z0-9-]+$/.test(parts[2] || '')) {
    const file = path.join(KIT, 'exercises', parts[2], 'README.md');
    if (!fs.existsSync(file)) return send(res, 404, { error: 'Exercise not found' }), true;
    return send(res, 200, { name: parts[2], text: fs.readFileSync(file, 'utf8') }), true;
  }

  if (parts[1] === 'rest' && req.method === 'POST') {
    // Rest day every week from a date on (weekday: 0 = Sunday … 6 = Saturday). weekday null turns it off.
    p.rest = b.weekday == null ? null : { weekday: Number(b.weekday), from: b.from || dayKey() };
  } else if (parts[1] === 'start' && req.method === 'POST') {
    // Start on a given day (YYYY-MM-DD), or today.
    const d = b.date ? new Date(`${b.date}T00:00:00`) : new Date();
    d.setHours(0, 0, 0, 0);
    p.startedAt = d.toISOString();
  } else if (parts[1] === 'done' && req.method === 'PUT') {
    if (b.done === false) delete p.done[b.id];
    else p.done[b.id] = { ...(p.done[b.id] || { at: new Date().toISOString(), day: dayKey() }), ...(typeof b.struggled === 'boolean' ? { struggled: b.struggled } : {}) };
  } else if (parts[1] === 'resolve' && req.method === 'PUT') {
    // Tick off a re-solve round (1 = after 3 days, 2 = after 10 days); done:false undoes it.
    const r = (p.resolves[b.id] ||= {});
    if (b.done === false) delete r[`r${b.round}`];
    else r[`r${b.round}`] = dayKey();
  } else if (parts[1] === 'log' && req.method === 'POST') {
    if (!b.what?.trim() && !b.minutes) return send(res, 400, { error: 'Say what you practiced.' }), true;
    p.log.unshift({ id: id(), at: new Date().toISOString(), day: dayKey(), minutes: Number(b.minutes) || 0, what: String(b.what || '').trim() });
  } else if (parts[1] === 'interviews' && req.method === 'POST') {
    if (!b.company?.trim()) return send(res, 400, { error: 'Add the company.' }), true;
    p.interviews.unshift({ id: id(), company: b.company.trim(), date: b.date || '', stage: b.stage || 'Coding', result: b.result || 'Waiting', notes: b.notes || '', weak: b.weak || [] });
  } else if (parts[1] === 'interviews' && parts[2] && req.method === 'DELETE') {
    p.interviews = p.interviews.filter((x) => x.id !== parts[2]);
  } else if (parts[1] === 'open-kit' && req.method === 'POST') {
    return send(res, openKit(b.kit) ? 200 : 404, { ok: true }), true;
  } else {
    return false;
  }
  save();
  return send(res, 200, practicePayload()), true;
}
