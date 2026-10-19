// One application per job: the job description, a tailored résumé, a cover
// letter, the approved PDFs, and the people you reached out to.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { load, save, dataDir } from './store.js';
import { fetchDescription } from './jd.js';
import { outreachOf } from './outreach-style.js';
import * as ai from './ai.js';
import { resumePdf, coverPdf } from './pdf.js';
import { autofill } from './autofill.js';
import { logoFor } from './logos.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const slug = (s) => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'Job';
const id = () => Math.random().toString(36).slice(2, 10);

export function appOf(job) {
  job.app ||= { contacts: [] };
  job.app.contacts ||= [];
  return job.app;
}

// Picks the starting résumé that fits the job best (backend vs product).
function pickBase(jd, resumes) {
  if (resumes.length < 2) return resumes[0];
  const text = String(jd).toLowerCase();
  const score = (r) => {
    const words = `${r.name} ${r.data.headline} ${r.data.summary} ${r.data.skills.map((s) => s.items).join(' ')}`.toLowerCase().match(/[a-z][a-z+#.]{2,}/g) || [];
    return [...new Set(words)].reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
  };
  const lean = (r) => (/backend|api|payment|infra|platform|distributed|data/.test(r.name.toLowerCase()) ? 1 : 0);
  const backendish = (text.match(/backend|back-end|\bapis?\b|distributed|database|infrastructure|payments|scalab|microservice|server|data platform|pipeline|sql|kafka|queue/g) || []).length;
  const frontendish = (text.match(/frontend|front-end|react|\bui\b|user interface|css|design system|mobile|\bios\b|android|web app|accessibility/g) || []).length;
  return [...resumes].sort((a, b) => (score(b) + (backendish > frontendish ? lean(b) * 5 : -lean(b) * 5)) - (score(a) + (backendish > frontendish ? lean(a) * 5 : -lean(a) * 5)))[0];
}

const jobInfo = (j) => ({ title: j.title, company: j.company, location: j.location });

function addSkills(resume, picks) {
  for (const { skill, group } of picks) {
    const all = resume.skills.map((s) => s.items.toLowerCase());
    if (all.some((items) => items.split(/,\s*/).includes(skill.toLowerCase()))) continue;
    const g = resume.skills.find((s) => s.label.toLowerCase() === String(group).toLowerCase())
      || resume.skills.find((s) => s.label.toLowerCase().includes(String(group).toLowerCase().split(' ')[0]))
      || resume.skills[0];
    if (g) g.items = `${g.items}, ${skill}`;
    else resume.skills.push({ label: group || 'Other', items: skill });
  }
}

function filesFor(job, resume) {
  const dir = path.join(dataDir, 'applications', `${slug(job.company)}-${slug(job.title)}-${job.uid.split(':').pop().slice(-6)}`);
  const who = slug(resume.name || 'My');
  const co = slug(job.company);
  return { dir, resume: path.join(dir, `${who}-Resume-${co}.pdf`), cover: path.join(dir, `${who}-Cover-Letter-${co}.pdf`) };
}

// The page that actually has the application form. Many companies show
// Greenhouse jobs on their own site with the form tucked behind a button, so
// we go straight to Greenhouse's form for that job instead.
const ghForm = (board, id) => `https://job-boards.greenhouse.io/embed/job_app?for=${board}&token=${id}`;
export async function formUrl(job, source) {
  const url = job.applyUrl || job.url || '';
  if (job.type === 'greenhouse' && source?.token) return ghForm(source.token, job.extId || job.uid.split(':').pop());
  const hosted = url.match(/greenhouse\.io\/(?:embed\/job_app\?for=)?([\w-]+)\/jobs\/(\d+)/);
  if (hosted) return ghForm(hosted[1], hosted[2]);
  const ghId = url.match(/[?&](?:gh_jid|token)=(\d+)/)?.[1];
  if (ghId) {
    const name = job.company.toLowerCase();
    const host = (() => { try { return new URL(url).hostname.replace(/^(www|careers|jobs)\./, '').split('.')[0]; } catch { return ''; } })();
    for (const board of [...new Set([name.replace(/[^a-z0-9]/g, ''), name.replace(/[^a-z0-9]+/g, '-'), host].filter(Boolean))]) {
      const ok = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${ghId}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false);
      if (ok) return ghForm(board, ghId);
    }
  }
  const lever = url.match(/^(https:\/\/jobs(?:\.eu)?\.lever\.co\/[^/]+\/[0-9a-f-]{36})\/?$/);
  if (lever) return `${lever[1]}/apply`;
  const ashby = url.match(/^(https:\/\/jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{36})\/?$/);
  if (ashby) return `${ashby[1]}/application`;
  return url;
}

// Returns true when it handled the request.
// "Recruiter at Smartsheet" on a Resend job: returns "Smartsheet" (they work elsewhere), else "".
export function worksElsewhere(title, company) {
  const m = String(title || '').match(/\bat\s+([^,·|()]+)$/i);
  if (!m) return '';
  const where = m[1].trim(), a = where.toLowerCase(), b = String(company).toLowerCase();
  if (a.includes(b) || b.includes(a) || /acquired by/i.test(title)) return '';
  return /^(remote|us|usa|united states|new york|san francisco|atlanta|nyc|sf)$/i.test(where) ? '' : where;
}

// Long AI steps that are running right now ("uid|action"), so a page that lost
// its connection can tell "still working" from "lost in a restart".
const running = new Set();
const LONG = new Set(['tailor', 'use-base', 'add-skills', 'revise', 'cover', 'approve', 'people', 'salary', 'outreach', 'reply', 'jd', 'autofill']);

export async function handle(req, res, parts, ctx) {
  const { send, readBody, emit } = ctx;
  const db = load();

  // ---------- Your base résumés ----------
  if (parts[0] === 'resumes') {
    if (req.method === 'GET' && !parts[1]) return send(res, 200, { resumes: db.resumes, coverSample: db.coverSample }), true;
    if (req.method === 'POST' && !parts[1]) {
      const b = await readBody(req);
      let data = b.data;
      if (!data && b.pdfBase64) {
        const { getDocumentProxy, extractText } = await import('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(b.pdfBase64, 'base64')));
        const { text } = await extractText(pdf, { mergePages: true });
        if (b.kind === 'cover') {
          db.coverSample = text.replace(/^[\s\S]*?(?=Dear\b)/, '').trim() || text;
          save();
          return send(res, 200, { coverSample: db.coverSample }), true;
        }
        data = (await ai.parseResume(text)).resume;
      }
      if (!data) return send(res, 400, { error: 'Nothing to save' }), true;
      const r = { id: id(), name: b.name || `Résumé ${db.resumes.length + 1}`, data, addedAt: new Date().toISOString() };
      db.resumes.push(r);
      save();
      return send(res, 200, { resume: r }), true;
    }
    const r = db.resumes.find((x) => x.id === parts[1]);
    if (!r) return send(res, 404, { error: 'Résumé not found' }), true;
    if (req.method === 'PUT') {
      const b = await readBody(req);
      if (b.data) r.data = b.data;
      if (b.name) r.name = b.name;
      save();
      return send(res, 200, { resume: r }), true;
    }
    if (req.method === 'DELETE') {
      db.resumes = db.resumes.filter((x) => x !== r);
      save();
      return send(res, 200, { ok: true }), true;
    }
  }

  if (parts[0] === 'cover-sample' && req.method === 'PUT') {
    db.coverSample = String((await readBody(req)).text || '');
    save();
    return send(res, 200, { ok: true }), true;
  }

  if (parts[0] === 'ai' && parts[1] === 'models') {
    try { return send(res, 200, { models: await ai.listModels(), current: db.settings.aiModel }), true; }
    catch (e) { return send(res, 400, { error: e.message }), true; }
  }

  // ---------- Add a job you found anywhere (LinkedIn, Indeed, a referral…) ----------
  if (parts[0] === 'jobs' && !parts[1] && req.method === 'POST') {
    const b = await readBody(req);
    if (!b.title || !b.company) return send(res, 400, { error: 'Add at least the job title and company.' }), true;
    const job = await addManualJob(db, b);
    return send(res, 200, { job }), true;
  }

  // ---------- Any job: paste a description (and someone on the team), get a résumé and an InMail ----------
  if (parts[0] === 'quick' && req.method === 'POST') {
    const b = await readBody(req);
    if (!String(b.description || '').trim()) return send(res, 400, { error: 'Paste the job description.' }), true;
    if (!b.title || !b.company) {
      try {
        const p = await ai.readPosting({ jd: b.description });
        b.title ||= p.title; b.company ||= p.company; b.location ||= p.location;
      } catch (e) { return send(res, e.status && e.status < 500 ? e.status : 500, { error: e.message }), true; }
      if (!b.title || !b.company) return send(res, 400, { error: 'Couldn\'t find the job title or company in that text. Type them in.' }), true;
    }
    const job = await addManualJob(db, b);
    const p = b.person || {};
    if (p.name?.trim()) {
      const title = (p.title || '').trim();
      let url = (p.linkedin || '').trim();
      if (url && !/^https?:/.test(url)) url = `https://${url}`;
      job.app.contacts.push({
        id: id(), name: p.name.trim(), title, linkedin: url, profile: (p.info || '').trim(), status: 'to contact', found: 'you',
        kind: /recruit|talent/i.test(title) ? 'recruiter' : /manager|director|head|vp|cto|lead/i.test(title) ? 'hiring manager' : 'engineer',
      });
      job.app.teamContext = (p.info || '').trim();
    }
    if (b.focus?.trim()) job.app.focus = b.focus.trim();
    save();
    return send(res, 200, { job, contactId: job.app.contacts[0]?.id || null }), true;
  }

  // Shared by "Add a job" and "Any job".
  async function addManualJob(db, b) {
    const now = new Date().toISOString();
    const uid = `manual:${id()}`;
    db.jobs[uid] = {
      uid, extId: uid, type: 'manual', sourceId: 'manual', title: b.title.trim(), company: b.company.trim(), location: (b.location || '').trim(),
      remote: /remote/i.test(b.location || ''), url: b.url || '', applyUrl: b.url || '', postedAt: null, department: '',
      firstSeen: now, lastSeen: now, fresh: true, match: true, status: 'saved',
      app: { jd: b.description || '', contacts: [] },
    };
    if (b.description) {
      const { yearsRequired, parseSalary, skillsFit, languageFit } = await import('./fit.js');
      db.jobs[uid].enrich = { years: yearsRequired(b.description), lang: languageFit(b.description, b.title), yv: 3, salary: parseSalary(b.description), skills: skillsFit(b.description, db.settings.skillsBank || []), jdHead: b.description.slice(0, 4000) };
    }
    const { rescore } = await import('./radar.js');
    rescore(db.jobs[uid], null, db.settings);
    save();
    emit({ type: 'jobs' });
    return db.jobs[uid];
  }

  if (parts[0] !== 'jobs' || !parts[1]) return false;
  const job = db.jobs[decodeURIComponent(parts[1])];
  if (!job) return send(res, 404, { error: 'Job not found' }), true;
  const app = appOf(job);
  const action = parts[2];
  if (action === 'running' && req.method === 'GET') return send(res, 200, { running: [...running].filter((k) => k.startsWith(`${job.uid}|`)).map((k) => k.split('|').pop()) }), true;
  if (LONG.has(action) && req.method === 'POST' && !ctx.inner) {
    const key = `${job.uid}|${action}`;
    running.add(key);
    try { return await handle(req, res, parts, { ...ctx, inner: true }); } finally { running.delete(key); }
  }
  const source = db.sources.find((s) => s.id === job.sourceId);
  const fail = (e) => send(res, e.status && e.status < 500 ? e.status : 500, { error: e.message });

  // Jobs you added yourself can be deleted (ones from job boards are hidden instead).
  if (!action && req.method === 'DELETE') {
    if (job.type !== 'manual') return send(res, 400, { error: 'Only jobs you added can be deleted. Hide this one instead.' }), true;
    delete db.jobs[job.uid];
    save();
    emit({ type: 'jobs' });
    return send(res, 200, { ok: true }), true;
  }

  if (!action && req.method === 'GET') return send(res, 200, { job: { ...job, smallCo: source?.meta?.group === 'smaller', logo: logoFor(job.company) } }), true;

  // The job description.
  if (action === 'jd' && req.method === 'POST') {
    const b = await readBody(req);
    if (typeof b.text === 'string') app.jd = b.text;
    else {
      try { app.jd = await fetchDescription(job, source); }
      catch (e) { return fail(e), true; }
    }
    save();
    return send(res, 200, { job }), true;
  }

  // Tailor the résumé.
  if (action === 'tailor' && req.method === 'POST') {
    const b = await readBody(req);
    if (!db.resumes.length) return send(res, 400, { error: 'Add your résumé in Settings first.' }), true;
    if (!app.jd) {
      try { app.jd = await fetchDescription(job, source); } catch (e) { return fail(e), true; }
    }
    const base = db.resumes.find((r) => r.id === b.resumeId) || pickBase(app.jd, db.resumes);
    try {
      const out = await ai.tailorResume({ job: jobInfo(job), jd: app.jd, base: base.data, extraSkills: db.settings.skillsBank, focus: b.focus ?? app.focus, teamContext: app.teamContext });
      out.resume.contact = { ...base.data.contact, ...Object.fromEntries(Object.entries(out.resume.contact).filter(([, v]) => v)) };
      Object.assign(app, {
        baseId: base.id, resume: out.resume, changes: out.changes, suggestions: out.suggestions,
        matched: out.matched, about: out.about, tailoredAt: new Date().toISOString(), approvedAt: null,
      });
      save();
      return send(res, 200, { job }), true;
    } catch (e) { return fail(e), true; }
  }

  // Start from a base résumé without the AI (e.g. no API key).
  if (action === 'use-base' && req.method === 'POST') {
    const b = await readBody(req);
    const base = db.resumes.find((r) => r.id === b.resumeId) || pickBase(app.jd || '', db.resumes);
    if (!base) return send(res, 400, { error: 'Add your résumé in Settings first.' }), true;
    Object.assign(app, { baseId: base.id, resume: clone(base.data), changes: [], suggestions: [], approvedAt: null });
    save();
    return send(res, 200, { job }), true;
  }

  // Add skills you ticked ("I know this").
  if (action === 'add-skills' && req.method === 'POST') {
    const { picks = [], remember = true } = await readBody(req);
    if (!app.resume) return send(res, 400, { error: 'Tailor the résumé first.' }), true;
    addSkills(app.resume, picks);
    app.suggestions = (app.suggestions || []).filter((s) => !picks.some((p) => p.skill === s.skill));
    if (remember) db.settings.skillsBank = [...new Set([...db.settings.skillsBank, ...picks.map((p) => p.skill)])];
    app.approvedAt = null;
    save();
    return send(res, 200, { job }), true;
  }

  // Ask for a change in your own words.
  if (action === 'revise' && req.method === 'POST') {
    const { target, instruction } = await readBody(req);
    if (!instruction?.trim()) return send(res, 400, { error: 'Say what you want changed.' }), true;
    try {
      if (target === 'cover') {
        const out = await ai.reviseCover({ job: jobInfo(job), jd: app.jd, letter: app.cover, instruction, resume: app.resume });
        app.cover = out.letter;
      } else {
        const out = await ai.reviseResume({ job: jobInfo(job), jd: app.jd, resume: app.resume, instruction, extraSkills: db.settings.skillsBank });
        app.resume = out.resume;
        app.changes = [...out.changes.map((c) => `${c} (you asked)`), ...(app.changes || [])].slice(0, 8);
      }
      app.approvedAt = null;
      save();
      return send(res, 200, { job }), true;
    } catch (e) { return fail(e), true; }
  }

  // Write the cover letter.
  if (action === 'cover' && req.method === 'POST') {
    if (!app.resume) return send(res, 400, { error: 'Tailor the résumé first.' }), true;
    try {
      const out = await ai.writeCover({ job: jobInfo(job), jd: app.jd, resume: app.resume, sample: db.coverSample, about: app.about });
      app.cover = out.letter;
      app.approvedAt = null;
      save();
      return send(res, 200, { job }), true;
    } catch (e) { return fail(e), true; }
  }

  // Save your own edits.
  if (action === 'app' && req.method === 'PUT') {
    const b = await readBody(req);
    if (b.resume) { app.resume = b.resume; app.approvedAt = null; }
    if (typeof b.cover === 'string') { app.cover = b.cover; app.approvedAt = null; }
    if (typeof b.skipCover === 'boolean') { app.skipCover = b.skipCover; app.approvedAt = null; }
    if (Array.isArray(b.contacts)) app.contacts = b.contacts;
    save();
    return send(res, 200, { job }), true;
  }

  // You've read it all: make the PDFs.
  if (action === 'approve' && req.method === 'POST') {
    if (!app.resume) return send(res, 400, { error: 'Tailor the résumé first.' }), true;
    const f = filesFor(job, app.resume);
    try {
      const r = await resumePdf(app.resume, f.resume);
      let c = null;
      if (app.cover && !app.skipCover) c = await coverPdf(app.resume, app.cover, f.cover);
      else if (fs.existsSync(f.cover)) fs.rmSync(f.cover);
      app.files = { resume: f.resume, cover: c ? f.cover : null, fontSize: r.fontSize, onePage: r.onePage };
      app.approvedAt = new Date().toISOString();
      if (job.status === 'new') job.status = 'saved';
      save();
      return send(res, 200, { job }), true;
    } catch (e) { return fail(e), true; }
  }

  if (action === 'file' && req.method === 'GET') {
    const file = parts[3] === 'cover' ? app.files?.cover : app.files?.resume;
    if (!file || !fs.existsSync(file)) return send(res, 404, { error: 'Not made yet' }), true;
    const download = new URL(req.url, 'http://x').searchParams.has('download');
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${path.basename(file)}"`,
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  if (action === 'reveal' && req.method === 'POST') {
    const file = app.files?.resume;
    if (file && fs.existsSync(file)) execFile('open', ['-R', file], () => {});
    return send(res, 200, { ok: true }), true;
  }

  // Open the form and fill it in with the approved files.
  if (action === 'autofill' && req.method === 'POST') {
    if (!app.approvedAt) return send(res, 400, { error: 'Review and approve your résumé first (step 3).' }), true;
    try {
      const r = await autofill(await formUrl(job, source), db.settings.profile, { resume: app.files.resume, cover: app.files.cover, coverText: app.skipCover ? '' : app.cover });
      return send(res, 200, r), true;
    } catch (e) { return send(res, 500, { error: e.message.split('\n')[0] }), true; }
  }

  // People to contact.
  if (action === 'people' && req.method === 'POST') {
    try {
      const out = await ai.findPeople({ job: jobInfo(job), about: app.about });
      const known = new Set(app.contacts.map((c) => (c.linkedin || c.name).toLowerCase()));
      // Web search adds "([site](url))" citations and tracking tags; keep it clean.
      const tidyUrl = (u) => { try { const x = new URL(u); x.search = ''; return x.toString(); } catch { return ''; } };
      const sameCo = (x) => { const a = String(x || '').toLowerCase(), b = job.company.toLowerCase(); return !a || a.includes(b) || b.includes(a); };
      out.people = out.people.filter((p) => sameCo(p.currentCompany) && !worksElsewhere(p.title, job.company));
      for (const p of out.people) {
        delete p.currentCompany;
        p.why = p.why.replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '').trim();
        p.linkedin = tidyUrl(p.linkedin);
        p.source = tidyUrl(p.source);
        if (!p.name || known.has((p.linkedin || p.name).toLowerCase())) continue;
        app.contacts.push({ id: id(), ...p, status: 'to contact', found: 'search' });
      }
      app.peopleSearchedAt = new Date().toISOString();
      save();
      return send(res, 200, { job, found: out.people.length }), true;
    } catch (e) { return fail(e), true; }
  }

  // What this job pays, from salary sites, when the posting doesn't say.
  if (action === 'salary' && req.method === 'POST') {
    try {
      const out = await ai.lookupSalary({ job: jobInfo(job), level: job.fit?.level || 'mid' });
      out.sources = (out.sources || []).map((x) => ({ ...x, url: String(x.url || '').replace(/[?&]utm_source=openai/, '') }));
      app.salaryOnline = { ...out, at: new Date().toISOString() };
      save();
      return send(res, 200, { job }), true;
    } catch (e) { return fail(e), true; }
  }

  if (action === 'outreach' && req.method === 'POST') {
    const b = await readBody(req);
    const { contactId, instruction } = b;
    const c = app.contacts.find((x) => x.id === contactId);
    if (!c) return send(res, 404, { error: 'Contact not found' }), true;
    const resume = app.resume || db.resumes[0]?.data;
    if (!resume) return send(res, 400, { error: 'Add your résumé in Settings first.' }), true;
    const elsewhere = worksElsewhere(c.title, job.company);
    if (elsewhere) return send(res, 400, { error: `${c.name.split(' ')[0]} works at ${elsewhere}, not ${job.company}. Remove them and find someone at ${job.company}.` }), true;
    try {
      // Look them up on the public web once (unless you pasted their page, or asked again).
      if (!instruction && (b.research || (!c.researchedAt && !(c.profile || '').trim()))) {
        const tidyUrl = (u) => { try { const x = new URL(u); x.search = ''; return x.toString(); } catch { return ''; } };
        const r = await ai.researchPerson({ person: c, company: job.company, role: job.title });
        c.research = r.found.map((x) => ({ what: x.what.replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '').trim(), when: x.when, url: tidyUrl(x.url) })).filter((x) => x.what);
        c.researchBest = r.best;
        c.researchedAt = new Date().toISOString();
      }
      const out = await ai.draftOutreach({
        job: jobInfo(job), jd: app.jd, about: app.about, resume,
        person: { name: c.name, title: c.title, kind: c.kind, profile: c.profile, research: c.research },
        style: outreachOf(db.settings),
        applied: ['applied', 'interview', 'offer'].includes(job.status),
        attachResume: !!app.files?.resume,
        instruction: instruction || '',
        current: instruction && c.message ? { subject: c.subject, message: c.message } : null,
      });
      const subjects = out.subjects.map((x) => ({ text: x.text.trim(), angle: x.angle })).filter((x) => x.text);
      Object.assign(c, { subject: subjects[0]?.text || c.subject || '', subjects, message: out.message, note: out.note.slice(0, 300), hook: out.hook, writtenAt: new Date().toISOString() });
      save();
      return send(res, 200, { job }), true;
    } catch (e) { return fail(e), true; }
  }

  // They answered: write a short reply in your voice.
  if (action === 'reply' && req.method === 'POST') {
    const { contactId, theirReply, update } = await readBody(req);
    const c = app.contacts.find((x) => x.id === contactId);
    if (!c) return send(res, 404, { error: 'Contact not found' }), true;
    if (!String(theirReply || '').trim()) return send(res, 400, { error: 'Paste what they wrote first.' }), true;
    try {
      const out = await ai.draftReply({
        job: jobInfo(job), person: { name: c.name, title: c.title }, sent: c.message, theirReply, update,
        style: outreachOf(db.settings), applied: ['applied', 'interview', 'offer'].includes(job.status),
      });
      Object.assign(c, { theirReply, update: update || '', reply: out.reply, status: 'replied' });
      save();
      return send(res, 200, { job }), true;
    } catch (e) { return fail(e), true; }
  }

  return false;
}

export function todayCount() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Object.values(load().jobs).filter((j) => j.appliedAt && Date.parse(j.appliedAt) >= start.getTime()).length;
}
