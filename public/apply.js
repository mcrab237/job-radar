// The Apply page: one job, five steps.
// 1 Résumé  2 Cover letter  3 Review & make PDFs  4 Apply  5 Reach out
import { $, $$, esc, enc, api, avatar, toast, copy, debounce, icons, plural, ago, color } from '/ui.js';
import { mountPaper } from '/editor.js';

let job = null;
let busy = {};
let ctx = null; // { state, refreshState }

const uidPath = () => `jobs/${enc(job.uid)}`;
// Several things can run at once (résumé, people, pay), so each one only
// copies back the parts it changed.
function take(r, keys) {
  for (const k of keys) job.app[k] = r.job.app?.[k];
  if (r.job.status) job.status = r.job.status;
}
const app = () => job.app || (job.app = { contacts: [] });

// Jobs started from "Any job": tailor with the résumé you picked and write the InMail right away.
export const quickStart = new Map();

export async function renderApply(view, uid, context) {
  ctx = context;
  busy = {};
  try {
    job = (await api(`jobs/${enc(uid)}`)).job;
  } catch {
    view.innerHTML = '<div class="card empty"><h3>Job not found</h3><p><a href="#jobs">Back to jobs</a></p></div>';
    return;
  }
  draw(view);
  const q = quickStart.get(uid);
  quickStart.delete(uid);
  if (q && !needKey()) {
    tailor(q.resumeId);
    const c = app().contacts.find((x) => x.id === q.contactId);
    if (c) writeInMail(c);
  }
  autoPrepare();
  // Grab the description in the background so tailoring is quick.
  if (!app().jd && job.type !== 'manual') {
    api(`${uidPath()}/jd`, { method: 'POST' }).then((r) => { job.app.jd = r.job.app.jd; drawSection('resume'); }).catch(() => {});
  }
}

// Your edits are saved a moment after you stop typing.
let pending = {};
const sendPending = debounce(async () => {
  const patch = pending;
  pending = {};
  if (!Object.keys(patch).length) return;
  const r = await api(`${uidPath()}/app`, { method: 'PUT', body: patch });
  job.app.approvedAt = r.job.app.approvedAt;
}, 500);
// Any change after approval means the PDFs are out of date.
function edited() {
  const a = app();
  if (a.approvedAt) {
    a.approvedAt = null;
    drawSection('review');
    drawSection('apply');
  }
  drawBar();
}
function saveApp(patch) { Object.assign(pending, patch); sendPending(); }
saveApp.flush = (patch = {}) => { Object.assign(pending, patch); return sendPending.flush(); };

// ---------- Layout ----------

function stepState() {
  const a = app();
  return {
    resume: !!a.resume,
    cover: !!a.cover || !!a.skipCover,
    review: !!a.approvedAt,
    apply: ['applied', 'interview', 'offer'].includes(job.status),
    people: (a.contacts || []).some((c) => c.status && c.status !== 'to contact'),
  };
}

const STEPS = [['resume', 'Résumé'], ['cover', 'Cover letter'], ['review', 'Review'], ['apply', 'Apply'], ['people', 'Reach out']];

// The step in view (highlighted in the tracker as you scroll).
let active = 'resume';
let spy = null;

function draw(view) {
  active = 'resume';
  const place = [job.location, job.remote && !/remote/i.test(job.location || '') ? 'Remote' : ''].filter(Boolean).join(' · ');
  view.innerHTML = `
    <div class="ap">
      <a class="back" href="#jobs">${icons.back} Jobs</a>
      <header class="ap-hero" style="--co:${color(job.company)}">
        ${avatar(job.company, job.logo)}
        <div class="ap-title">
          <h1>${esc(job.title)}</h1>
          <div class="ap-sub"><b>${esc(job.company)}</b>${[place && esc(place), job.postedAt ? `Posted ${ago(job.postedAt)}` : job.type === 'manual' ? 'Added by you' : ''].filter(Boolean).map((x) => `<i>·</i>${x}`).join('')}</div>
        </div>
        <div class="ap-actions">
          ${job.type === 'manual' ? `<button class="btn btn-ghost btn-danger" type="button" id="delJob">Delete</button>` : ''}
          <button class="btn" type="button" data-jd="${esc(job.uid)}">${icons.doc} Job description</button>
          ${job.url ? `<a class="btn btn-ghost" href="${esc(job.url)}" target="_blank" rel="noopener">Posting ${icons.ext}</a>` : ''}
        </div>
      </header>
      <section class="ap-facts" id="about"></section>
      <nav class="ap-stepper" id="stepsBar" aria-label="Steps"></nav>
      <div class="ap-panel">
        ${STEPS.map(([k]) => `<section class="ap-step" id="sec-${k}"></section>`).join('')}
      </div>
    </div>`;
  STEPS.forEach(([k]) => drawSection(k));
  drawAbout();
  watchSteps();
  $('#delJob')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${job.title}" at ${job.company}? Its résumé, letter and messages go too.`)) return;
    await api(uidPath(), { method: 'DELETE' });
    await ctx.refreshState();
    toast('Deleted.');
    location.hash = 'quick';
  });
}

// Clicking a step in the tracker scrolls to it.
function showStep(key) {
  active = key;
  clickedAt = Date.now();
  drawBar();
  $(`#sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Highlights the step you're reading as you scroll: the last one whose top
// has passed under the tracker.
let clickedAt = 0;
function watchSteps() {
  spy?.();
  let queued = false;
  const check = () => {
    queued = false;
    if (!document.body.contains($('#stepsBar'))) return spy?.();
    if (Date.now() - clickedAt < 900) return; // let a smooth jump finish first
    const line = Math.max(($('#stepsBar').getBoundingClientRect().bottom || 0) + 40, window.innerHeight * 0.35);
    let now = STEPS[0][0];
    for (const [k] of STEPS) if (($(`#sec-${k}`)?.getBoundingClientRect().top ?? 1e9) <= line) now = k;
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) now = STEPS.at(-1)[0];
    if (now !== active) { active = now; drawBar(); }
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(check); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  spy = () => { window.removeEventListener('scroll', onScroll); spy = null; };
}

// ---------- About this job: pay, level, place, fit ----------

const money = (n) => `$${Math.round(n / 1000)}k`;
const LEVELS = { entry: 'Entry level', mid: 'Mid level', senior: 'Senior title', lead: 'Lead' };
const PLACES = { remote: 'Remote (US)', atlanta: 'Atlanta', relocate: 'Relocation (pays enough)' };

function drawAbout() {
  const el = $('#about');
  if (!el) return;
  const f = job.fit || {};
  const a = app();
  const posted = f.salary?.source === 'posted';
  const online = a.salaryOnline;
  let pay, paySub;
  if (posted) { pay = `${money(f.salary.min)}–${money(f.salary.max)}`; paySub = f.salary.zones > 1 ? 'From the posting, by location' : 'From the posting'; }
  else if (busy.salary) { pay = '<span class="spinner"></span>'; paySub = 'Checking salary sites…'; }
  else if (online?.high) { pay = `${money(online.low)}–${money(online.high)}`; paySub = 'From salary sites'; }
  else if (f.salary) { pay = `~${money(f.salary.min)}–${money(f.salary.max)}`; paySub = '<button class="linkish" id="checkPay">Estimate · check salary sites</button>'; }
  else { pay = '—'; paySub = 'Not listed'; }
  const score = Math.round(f.score ?? 0);
  const tiles = [
    ['Pay', pay, paySub],
    ['Level', LEVELS[f.level] || '—', f.payments ? 'Payments work' : ''],
    ['Experience asked', f.years != null ? `${f.years}+ years` : '—', f.years != null ? ({ good: 'A good fit', okay: 'Close enough', stretch: 'A stretch' }[f.yearsFit] || '') : 'Not stated'],
    ['Where', PLACES[f.place] || job.location || '—', f.place === 'relocate' ? 'Pays enough to move' : ''],
  ];
  const matched = (a.matched || []).length ? a.matched : (f.why || []);
  el.innerHTML = `
    <div class="ap-tiles">
      ${tiles.map(([k, v, sub]) => `<div class="ap-tile"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`).join('')}
      ${score ? `<div class="ap-tile ap-score"><div class="k">Match</div><div class="v">${score}<small>/100</small></div><div class="meter"><i style="width:${Math.min(100, score)}%"></i></div></div>` : ''}
    </div>
    ${matched.length ? `<div class="ap-match">${matched.slice(0, 8).map((m) => `<span>${icons.check}${esc(m)}</span>`).join('')}</div>` : ''}
    ${online?.sources?.length ? `<div class="ap-sources">Pay sources: ${online.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.site)}</a> ${esc(x.figure)}`).join(' · ')}</div>` : ''}`;
  $('#checkPay', el)?.addEventListener('click', () => { if (!needKey()) checkPay(); });
}

function checkPay() {
  return run('salary', async () => { take(await api(`${uidPath()}/salary`, { method: 'POST' }), ['salaryOnline']); }, ['about']);
}

function findPeople(silent) {
  return run('people', async () => {
    const r = await api(`${uidPath()}/people`, { method: 'POST' });
    take(r, ['contacts', 'peopleSearchedAt']);
    if (!silent) toast(r.found ? `Found ${r.found === 1 ? '1 person' : `${r.found} people`}. Check each profile before you message.` : 'Couldn\'t find anyone with confidence. Try the LinkedIn searches below.', { ms: 7000 });
  }, ['people']);
}

// DMs are for strong matches only (same rule as the "Send a DM" badge).
const strongMatch = () => (job.fit?.score ?? 0) >= (job.smallCo ? 75 : 80);
let showPeopleAnyway = false;

// Opening a job gets the résumé and letter ready (pay and people lookups wait for a click).
function autoPrepare() {
  const st = ctx.state();
  if (!st.settings.prefs?.autoPrepare || !st.ai.hasKey || !st.resumes.length) return;
  const a = app();
  if (!a.resume && !busy.tailor) tailor();
  // Web searches (people, pay) cost the most, so they run only when you press their buttons.
}

// What each step says under its name in the tracker.
function stepNote(k) {
  const a = app();
  if (k === 'resume') return busy.tailor ? 'Tailoring…' : a.resume ? (a.tailoredAt ? `Tailored ${ago(a.tailoredAt)}` : 'Ready') : 'Not started';
  if (k === 'cover') return busy.cover ? 'Writing…' : a.skipCover ? 'Not needed' : a.cover ? `${a.cover.split(/\s+/).filter(Boolean).length} words` : 'Not started';
  if (k === 'review') return busy.approve ? 'Making PDFs…' : a.approvedAt ? 'PDFs ready' : a.files ? 'Needs a redo' : 'Not yet';
  if (k === 'apply') return ['applied', 'interview', 'offer'].includes(job.status) ? `Applied ${job.appliedAt ? ago(job.appliedAt) : ''}` : 'Not yet';
  const sent = (a.contacts || []).filter((c) => c.status && c.status !== 'to contact').length;
  return sent ? `${sent} messaged` : Object.keys(busy).some((x) => x.startsWith('msg-') && busy[x]) ? 'Writing…' : strongMatch() ? 'Recommended' : 'Optional';
}

function drawBar() {
  const bar = $('#stepsBar');
  if (!bar) return;
  const s = stepState();
  const working = { resume: busy.tailor, cover: busy.cover, review: busy.approve, apply: busy.fill, people: busy.people || Object.keys(busy).some((x) => x.startsWith('msg-') && busy[x]) };
  bar.innerHTML = STEPS.map(([k, label], i) => `
    <button type="button" data-jump="${k}" class="${s[k] ? 'done' : ''} ${k === active ? 'on' : ''}" aria-current="${k === active ? 'step' : 'false'}">
      <span class="n">${working[k] ? '<span class="spinner"></span>' : s[k] ? icons.check : i + 1}</span>
      <span class="t"><b>${label}</b><small>${esc(stepNote(k))}</small></span>
    </button>`).join('');
  $$('[data-jump]', bar).forEach((b) => b.onclick = () => showStep(b.dataset.jump));
  // On narrow screens the tracker scrolls sideways: keep the current step in view.
  const on = $('.on', bar);
  if (on && bar.scrollWidth > bar.clientWidth) bar.scrollTo({ left: on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
}

const STEP_INFO = {
  resume: ['Résumé', 'Fitted to this job. Click any line to edit it.'],
  cover: ['Cover letter', 'Written from your résumé and the job. Edit it like a document.'],
  review: ['Review and make PDFs', 'Nothing is made until you approve it.'],
  apply: ['Apply', 'Chrome fills in the form. You press Submit yourself.'],
  people: ['Reach out', 'A short InMail to someone on the team.'],
};

function drawSection(key) {
  if (key === 'about') return drawAbout();
  const el = $(`#sec-${key}`);
  if (!el) return;
  const s = stepState();
  const i = STEPS.findIndex(([k]) => k === key);
  const body = { resume: resumeBody, cover: coverBody, review: reviewBody, apply: applyBody, people: peopleBody }[key];
  const [title, sub] = STEP_INFO[key];
  el.className = `ap-step ${s[key] ? 'done' : ''}`;
  el.innerHTML = `
    <div class="ap-step-head">
      <div><div class="eyebrow">Step ${i + 1} of ${STEPS.length}</div><h2>${title}</h2><p>${key === 'people' && strongMatch() ? 'Strong match: a short note to the hiring manager is worth it.' : sub}</p></div>
    </div>
    <div class="body"></div>`;
  body($('.body', el));
  $$('[data-step-go]', el).forEach((b) => b.onclick = () => showStep(b.dataset.stepGo));
  drawBar();
}

const busyBox = (text) => `<div class="busy"><div class="busy-line"><span class="spinner"></span><span>${text}</span></div><div class="busy-bar"><i></i></div></div>`;

async function run(key, fn, sections) {
  busy[key] = true;
  sections.forEach(drawSection);
  const before = watched(key);
  try {
    await fn();
  } catch (e) {
    if (e.network) await recover(key, fn, before).catch((e2) => toast(esc(e2.message), { error: true, ms: 9000 }));
    else toast(esc(e.message), { error: true, ms: 9000 });
  }
  busy[key] = false;
  sections.forEach(drawSection);
}

// Which server step each kind of work is, and what changes when it's done.
const STEP_OF = (key) => ({ tailor: ['tailor', ['tailoredAt', 'resume']], cover: ['cover', ['cover']], approve: ['approve', ['approvedAt', 'files']], reviseResume: ['revise', ['resume']], reviseCover: ['revise', ['cover']], people: ['people', ['peopleSearchedAt', 'contacts']], salary: ['salary', ['salaryOnline']], skills: ['add-skills', ['resume']], jd: ['jd', ['jd']], fill: ['autofill', []] }[key]
  || (key.startsWith('msg-') ? ['outreach', ['contacts']] : key.startsWith('reply-') ? ['reply', ['contacts']] : [null, []]));
const watched = (key, app = job.app || {}) => JSON.stringify(STEP_OF(key)[1].map((f) => app[f]));

// The connection dropped mid-way. The work may still be running on the Mac
// mini (then wait for it), or a restart may have lost it (then run it again once).
async function recover(key, fn, before) {
  const [step, fields] = STEP_OF(key);
  if (!step || !fields.length) throw new Error('Lost the connection to Job Radar. If Chrome opened, carry on there; otherwise press the button again.');
  const t = toast('<span class="spinner"></span> The connection dropped. Checking whether it finished…', { ms: 200000 });
  try {
    for (let i = 0; i < 70; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      let r;
      try { r = await api(uidPath()); } catch { continue; } // still unreachable
      if (watched(key, r.job.app || {}) !== before) {
        for (const f of fields) job.app[f] = r.job.app?.[f];
        if (key === 'tailor') for (const f of ['baseId', 'changes', 'suggestions', 'matched', 'about', 'approvedAt', 'jd']) job.app[f] = r.job.app?.[f];
        toast('Reconnected. It finished.');
        return;
      }
      let still = [];
      try { still = (await api(`${uidPath()}/running`)).running; } catch { continue; }
      if (!still.includes(step)) {
        // Not done and not running: it was lost. Try once more.
        t.remove();
        toast('Reconnected. Running it again…', { ms: 4000 });
        await fn();
        return;
      }
    }
    throw new Error('Still no answer after a few minutes. Reload the page and try again.');
  } finally { t.remove(); }
}

const needKey = () => {
  if (ctx.state().ai.hasKey) return false;
  toast('Add your OpenAI API key in <a href="#settings">Settings</a> first. It takes a minute.', { ms: 8000 });
  return true;
};

// ---------- 1. Résumé ----------

function jdBox(open) {
  const a = app();
  return `
    <details class="jd side-box quiet" ${open ? 'open' : ''}>
      <summary>${a.jd ? `Edit the job description <span class="hint">(${a.jd.split(/\s+/).length} words)</span>` : 'Paste the job description'}</summary>
      <textarea class="textarea" id="jdText" placeholder="Paste the job description here">${esc(a.jd || '')}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn btn-sm" id="jdSave">Save description</button>${job.type !== 'manual' ? '<button class="btn btn-sm btn-ghost" id="jdReload">Reload from the posting</button>' : ''}</div>
    </details>`;
}

function wireJd(root) {
  $('#jdSave', root)?.addEventListener('click', async () => {
    await api(`${uidPath()}/jd`, { method: 'POST', body: { text: $('#jdText', root).value } });
    job.app.jd = $('#jdText', root).value;
    toast('Saved');
  });
  $('#jdReload', root)?.addEventListener('click', () => run('jd', async () => {
    take(await api(`${uidPath()}/jd`, { method: 'POST' }), ['jd']);
  }, ['resume']));
}

// One-click requests for the "Ask for a change" boxes.
const QUICK = {
  resume: ['Shorter summary', 'Lead with payments work', 'More backend focus', 'More frontend focus', 'Tighter bullets'],
  cover: ['Shorter', 'Warmer', 'Less formal', 'More about the company', 'Stronger opening'],
};
const askBox = (kind, busyNow) => `
  <div class="side-box ask">
    <h3>Ask for a change</h3>
    <div class="quick-asks">${QUICK[kind].map((q) => `<button type="button" class="ask-chip" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <textarea class="textarea" id="ask-${kind}" placeholder="Or type it: ${kind === 'resume' ? 'mention my Stripe Connect work…' : 'mention I use their product…'}"></textarea>
    <button class="btn btn-sm" id="ask-${kind}-btn" ${busyNow ? 'disabled' : ''}>${busyNow ? '<span class="spinner"></span> Changing…' : 'Change it'}</button>
  </div>`;
const wireAsk = (root, kind, send) => {
  const box = $(`#ask-${kind}`, root);
  $$('[data-quick]', root).forEach((b) => b.onclick = () => { box.value = b.dataset.quick; send(b.dataset.quick); });
  $(`#ask-${kind}-btn`, root).onclick = () => {
    const t = box.value.trim();
    if (!t) return box.focus();
    send(t);
  };
};

function resumeBody(root) {
  const a = app();
  const st = ctx.state();
  if (!st.resumes.length) {
    root.innerHTML = `<p class="hint">First add your résumé in <a href="#settings">Settings</a>. You can upload a PDF.</p>`;
    return;
  }
  if (busy.tailor) {
    root.innerHTML = busyBox('Reading the job and fitting your résumé to it. This takes about 30 to 90 seconds.');
    return;
  }
  if (busy.jd) { root.innerHTML = busyBox('Loading the job description…'); return; }
  const baseSelect = `<select class="input" id="baseSel" style="width:auto">
      <option value="">Pick for me</option>
      ${st.resumes.map((r) => `<option value="${r.id}" ${a.baseId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
    </select>`;

  if (!a.resume) {
    root.innerHTML = `
      <div class="start-card">
        <div class="start-icon">${icons.doc}</div>
        <div class="grow">
          <h3>Fit your résumé to this job</h3>
          <p>Reorders and rewords what's already on your résumé to match this posting. Nothing gets invented. About a minute.</p>
          <div class="row" style="margin-top:12px">
            <button class="btn btn-primary" id="tailor">Fit my résumé</button>
            <span class="field-label">from</span>${baseSelect}
            <button class="btn btn-ghost" id="asIs">Use it as it is</button>
          </div>
        </div>
      </div>
      <div style="margin-top:12px">${jdBox(!a.jd && job.type === 'manual')}</div>`;
    $('#tailor', root).onclick = () => { if (!needKey()) tailor(); };
    $('#asIs', root).onclick = () => run('tailor', async () => {
      take(await api(`${uidPath()}/use-base`, { method: 'POST', body: { resumeId: $('#baseSel', root).value } }), ['baseId', 'resume', 'changes', 'suggestions', 'matched', 'about', 'tailoredAt', 'approvedAt', 'jd']);
    }, ['resume', 'cover', 'review']);
    wireJd(root);
    return;
  }

  const sugg = a.suggestions || [];
  root.innerHTML = `
    <div class="split">
      <div id="paper"></div>
      <aside class="side">
        ${(a.changes || []).length ? `<div class="side-box"><h3>What changed</h3><ul class="ticks">${a.changes.map((c) => `<li>${icons.check}<span>${esc(c)}</span></li>`).join('')}</ul></div>` : ''}
        ${askBox('resume', busy.reviseResume)}
        ${sugg.length ? `<div class="side-box"><h3>This job also asks for</h3>
          <p class="hint">Tick only what you could talk about in an interview. It's added to your skills.</p>
          <div class="sugg">${sugg.map((x, i) => `<label class="sugg-item"><input type="checkbox" data-sugg="${i}"><span><b>${esc(x.skill)}</b><small>${esc(x.why)}</small></span></label>`).join('')}</div>
          <button class="btn btn-sm" id="addSkills">Add the ones I ticked</button>
        </div>` : ''}
        <div class="side-box quiet">
          <h3>Start again</h3>
          <div class="row nowrap">${baseSelect}<button class="btn btn-sm btn-ghost" id="retailor">Fit again</button></div>
        </div>
        ${jdBox(false)}
      </aside>
    </div>`;
  mountPaper($('#paper', root), a.resume, (r) => { edited(); saveApp({ resume: r }); });
  $('#addSkills', root)?.addEventListener('click', () => {
    const picks = $$('[data-sugg]:checked', root).map((c) => sugg[c.dataset.sugg]);
    if (!picks.length) return toast('Tick at least one first.');
    run('skills', async () => { take(await api(`${uidPath()}/add-skills`, { method: 'POST', body: { picks } }), ['resume', 'suggestions', 'approvedAt']); }, ['resume', 'review']);
  });
  wireAsk(root, 'resume', (instruction) => {
    if (needKey()) return;
    run('reviseResume', async () => { take(await api(`${uidPath()}/revise`, { method: 'POST', body: { target: 'resume', instruction } }), ['resume', 'changes', 'approvedAt']); }, ['resume', 'review']);
  });
  $('#retailor', root).onclick = () => { if (!needKey() && confirm('Start over? Your edits on this page will be replaced.')) tailor($('#baseSel', root).value); };
  wireJd(root);
}

function tailor(resumeId = $('#baseSel')?.value) {
  return run('tailor', async () => {
    take(await api(`${uidPath()}/tailor`, { method: 'POST', body: { resumeId } }), ['baseId', 'resume', 'changes', 'suggestions', 'matched', 'about', 'tailoredAt', 'approvedAt', 'jd']);
    if (!job.app.cover && !job.app.skipCover && ctx.state().ai.hasKey) writeCover();
  }, ['resume', 'review']);
}

// ---------- 2. Cover letter ----------

function writeCover() {
  return run('cover', async () => { take(await api(`${uidPath()}/cover`, { method: 'POST' }), ['cover', 'approvedAt']); }, ['cover', 'review']);
}

function coverBody(root) {
  const a = app();
  if (busy.cover) { root.innerHTML = busyBox('Writing your cover letter… about 20 to 40 seconds.'); return; }
  const toggle = `<div class="switch"><div class="txt"><b>Send a cover letter</b><span>Turn off if there's nowhere to send one.</span></div><label class="toggle"><input type="checkbox" id="needCover" ${a.skipCover ? '' : 'checked'}><i></i></label></div>`;
  if (!a.resume) { root.innerHTML = '<p class="hint">Do your résumé first.</p>'; return; }
  if (!a.cover) {
    root.innerHTML = `<div class="side-box" style="max-width:460px;margin-bottom:14px">${toggle}</div>${a.skipCover ? '<div class="empty-step"><b>No cover letter for this job.</b><span>Turn it back on above if you change your mind.</span></div>' : `
      <div class="start-card">
        <div class="start-icon">${icons.doc}</div>
        <div class="grow">
          <h3>Write the cover letter</h3>
          <p>Uses your fitted résumé and the job description${ctx.state().hasCoverSample ? ', in the tone of the letter you saved in Settings' : ''}. About 30 seconds.</p>
          <div class="row" style="margin-top:12px"><button class="btn btn-primary" id="writeCover">Write my cover letter</button><button class="btn btn-ghost" id="blankCover">I'll write it myself</button></div>
        </div>
      </div>`}`;
  } else {
    root.innerHTML = `
      <div class="split">
        <div class="letter-wrap"><textarea class="letter" id="letter" spellcheck="true">${esc(a.cover)}</textarea></div>
        <aside class="side">
          <div class="side-box">${toggle}</div>
          ${askBox('cover', busy.reviseCover)}
          <div class="side-box quiet">
            <h3>Start again</h3>
            <div class="row"><button class="btn btn-sm btn-ghost" id="rewrite">Write a new one</button><span class="hint" id="coverWords">${a.cover.split(/\s+/).filter(Boolean).length} words</span></div>
          </div>
        </aside>
      </div>`;
    const letter = $('#letter', root);
    letter.addEventListener('input', (e) => {
      a.cover = e.target.value;
      $('#coverWords', root).textContent = `${a.cover.split(/\s+/).filter(Boolean).length} words`;
      edited(); saveApp({ cover: a.cover });
    });
    wireAsk(root, 'cover', (instruction) => {
      if (needKey()) return;
      run('reviseCover', async () => { take(await api(`${uidPath()}/revise`, { method: 'POST', body: { target: 'cover', instruction } }), ['cover', 'approvedAt']); }, ['cover', 'review']);
    });
    $('#rewrite', root).onclick = () => { if (!needKey() && confirm('Write a new letter? This one will be replaced.')) writeCover(); };
  }
  $('#needCover', root).onchange = async (e) => {
    a.skipCover = !e.target.checked;
    await saveApp.flush({ skipCover: a.skipCover });
    a.approvedAt = null;
    drawSection('cover');
    drawSection('review');
  };
  $('#writeCover', root)?.addEventListener('click', () => { if (!needKey()) writeCover(); });
  $('#blankCover', root)?.addEventListener('click', async () => {
    a.cover = `Dear ${job.company} Hiring Team,\n\n\n\nBest,\n${a.resume.name}`;
    await saveApp.flush({ cover: a.cover });
    drawSection('cover');
  });
}

// ---------- 3. Review & make PDFs ----------

function fileRow(kind, label) {
  const f = app().files?.[kind];
  if (!f) return '';
  const name = f.split('/').pop();
  return `<div class="file"><div class="ic">PDF</div><div class="grow"><div class="name">${esc(name)}</div><div class="sub">${label}</div></div>
    <a class="btn btn-sm" href="/api/${uidPath()}/file/${kind}" target="_blank" rel="noopener">Open</a>
    <a class="btn btn-sm" href="/api/${uidPath()}/file/${kind}?download" download="${esc(name)}">Download</a></div>`;
}

function reviewBody(root) {
  const a = app();
  if (!a.resume) { root.innerHTML = '<div class="empty-step"><b>Nothing to review yet.</b><span>Fit your résumé in step 1 first.</span></div>'; return; }
  if (busy.approve) { root.innerHTML = busyBox('Making your PDFs…'); return; }
  const coverMissing = !a.skipCover && !a.cover;
  if (a.approvedAt) {
    const pdf = (kind, label) => a.files?.[kind] ? `
      <figure class="pdf">
        <iframe src="/api/${uidPath()}/file/${kind}#toolbar=0&navpanes=0&page=1&zoom=page-width" title="${label}" loading="lazy"></iframe>
        <figcaption>
          <span><b>${label}</b><small>${esc(a.files[kind].split('/').pop())}</small></span>
          <span class="row"><a class="btn btn-sm btn-ghost" href="/api/${uidPath()}/file/${kind}" target="_blank" rel="noopener">Open ${icons.ext}</a><a class="btn btn-sm" href="/api/${uidPath()}/file/${kind}?download" download="${esc(a.files[kind].split('/').pop())}">Download</a></span>
        </figcaption>
      </figure>` : '';
    root.innerHTML = `
      <div class="ok-banner">${icons.check}<span><b>Approved ${ago(a.approvedAt)}.</b> These are the exact files that get attached.</span><button class="btn btn-sm btn-ghost" id="reveal">Show in Finder</button></div>
      ${a.files?.fontSize < 9 ? `<p class="paper-note">The résumé text came out small (${a.files.fontSize}pt) to fit one page. Removing a bullet or two would help.</p>` : ''}
      <div class="pdfs ${a.files?.cover ? '' : 'one'}">${pdf('resume', 'Résumé')}${pdf('cover', 'Cover letter')}</div>`;
    $('#reveal', root).onclick = () => api(`${uidPath()}/reveal`, { method: 'POST' });
    return;
  }
  root.innerHTML = `
    ${a.files ? `<div class="warn-banner">${icons.warn}<span>You changed something since the last PDFs. Make them again when you're done.</span></div>` : ''}
    <div class="checklist">
      <label><input type="checkbox"><span><b>Every line on the résumé is true</b><small>and something you could talk about for two minutes.</small></span><button type="button" class="linkish" data-step-go="resume">Open résumé</button></label>
      <label><input type="checkbox"><span><b>${a.skipCover ? 'No cover letter for this job' : 'The cover letter sounds like you'}</b><small>${a.skipCover ? 'You switched it off in step 2.' : 'Read it once out loud. Cut anything you wouldn\'t say.'}</small></span>${a.skipCover ? '' : '<button type="button" class="linkish" data-step-go="cover">Open letter</button>'}</label>
      <label><input type="checkbox"><span><b>Contact details are right</b><small>Name, email, phone and links at the top of the résumé.</small></span></label>
    </div>
    <div class="row" style="margin-top:16px">
      <button class="btn btn-primary btn-lg" id="approve" ${coverMissing ? 'disabled' : ''}>Looks good, make my PDFs</button>
      ${coverMissing ? '<span class="hint">Write the cover letter first, or switch it off in step 2.</span>' : '<span class="hint">Takes a few seconds. Fits the résumé on one page.</span>'}
    </div>`;
  $$('[data-step-go]', root).forEach((b) => b.onclick = (e) => { e.preventDefault(); showStep(b.dataset.stepGo); });
  $('#approve', root)?.addEventListener('click', () => run('approve', async () => {
    await saveApp.flush({ resume: a.resume, ...(a.cover ? { cover: a.cover } : {}) });
    take(await api(`${uidPath()}/approve`, { method: 'POST' }), ['files', 'approvedAt']);
  }, ['review', 'apply']));
}

// ---------- 4. Apply ----------

function applyBody(root) {
  const a = app();
  const applied = ['applied', 'interview', 'offer'].includes(job.status);
  const st = ctx.state();
  const goal = st.dailyTarget || st.settings.dailyGoal || 1;
  const today = `<div class="today-meter"><span>Today: <b>${st.today}</b> of ${goal}</span><div class="meter"><i style="width:${Math.min(100, Math.round((st.today / goal) * 100))}%"></i></div></div>`;
  if (applied) {
    root.innerHTML = `
      <div class="applied-card">
        <div class="big-check">${icons.check}</div>
        <div class="grow"><h3>You applied ${job.appliedAt ? ago(job.appliedAt) : ''}</h3><p>It's on your Applications board. A short InMail to someone on the team is the next best move.</p>${today}</div>
        <div class="stack" style="justify-items:end"><button class="btn btn-primary" type="button" data-step-go="people">Reach out →</button><button class="btn btn-sm btn-ghost" id="undoApplied">I didn't apply after all</button></div>
      </div>`;
    $('[data-step-go]', root).onclick = () => showStep('people');
    $('#undoApplied', root).onclick = async () => { await api(uidPath(), { method: 'PATCH', body: { status: 'saved' } }); job.status = 'saved'; await ctx.refreshState(); drawSection('apply'); };
    return;
  }
  const remote = !!st.client?.remote;
  const canFill = !!a.approvedAt && !!job.applyUrl && !remote;
  root.innerHTML = `
    <div class="apply-hero">
      <div class="ah-main">
        <div class="ah-icon">${icons.bolt}</div>
        <div>
          <h3>Let Chrome fill it in</h3>
          <ol class="ah-steps">
            <li>Opens the form with your details, résumé and cover letter in place</li>
            <li>You answer the questions it couldn't</li>
            <li>You check everything and press Submit</li>
          </ol>
        </div>
      </div>
      <div class="ah-cta">
        <button class="btn btn-primary btn-lg" id="fill" ${canFill ? '' : 'disabled'}>${busy.fill ? '<span class="spinner"></span> Opening Chrome…' : `${icons.bolt} Fill in the application`}</button>
        ${job.applyUrl ? `<a class="btn" href="${esc(job.applyUrl)}" target="_blank" rel="noopener">Open it myself ${icons.ext}</a>` : ''}
        <p class="hint">${remote ? 'Fast apply opens Chrome on your Mac mini. From this laptop, open it yourself and download your PDFs in step 3.' : !a.approvedAt ? 'Make your PDFs in step 3 first.' : 'If a site asks you to sign in, do it once. Chrome remembers.'}</p>
      </div>
    </div>
    ${a.approvedAt && !a.skipCover && a.cover ? `<div class="row" style="margin-top:12px"><button class="btn btn-sm btn-ghost" id="copyCover">${icons.copy} Copy cover letter text</button><span class="hint">for forms with a text box instead of an upload</span></div>` : ''}
    <div class="did-apply">
      <div><b>Submitted it?</b><span>Mark it so it counts toward today and moves to your board.</span></div>
      ${today}
      <button class="btn" id="didApply">${icons.check} I applied</button>
    </div>`;
  $('#fill', root).onclick = () => run('fill', async () => {
    const p = st.settings.profile;
    if (!p.email || !p.firstName) throw new Error('Add your name and email in Settings → Your details first.');
    const r = await api(`${uidPath()}/autofill`, { method: 'POST' });
    if (r.noForm) {
      toast('Chrome opened the job, but the application form wasn\'t on that page. Click the site\'s Apply button there. Your PDFs are in step 3 and the letter is one click away below.', { ms: 12000 });
      return;
    }
    if (!r.filled) {
      toast('Chrome found the form but couldn\'t match its fields, so fill it in by hand. Your PDFs are in step 3.', { ms: 10000 });
      return;
    }
    toast(`Chrome is open: ${plural(r.filled, 'field')} filled, résumé ${esc(r.resume)}${r.cover ? `, cover letter ${esc(r.cover)}` : ''}. Check it and press <b>Submit</b> yourself. Then come back and press <b>I applied</b>.`, { ms: 12000 });
  }, ['apply']);
  $('#copyCover', root)?.addEventListener('click', () => copy(a.cover, 'Cover letter copied'));
  $('#didApply', root).onclick = async () => {
    await api(uidPath(), { method: 'PATCH', body: { status: 'applied' } });
    job.status = 'applied';
    job.appliedAt = new Date().toISOString();
    await ctx.refreshState();
    drawSection('apply');
    toast(`Nice. That's ${ctx.state().today} today. Now send a quick note to someone there (step 5).`, { ms: 7000 });
    showStep('people');
  };
}

// ---------- 5. Reach out ----------

const STATUSES = ['to contact', 'request sent', 'messaged', 'replied', 'not relevant'];

function searchLinks() {
  const co = job.company;
  const team = app().about?.team;
  const li = (q) => `https://www.linkedin.com/search/results/people/?keywords=${enc(q)}&origin=GLOBAL_SEARCH_HEADER`;
  const links = [
    ['Engineering managers', li(`${co} engineering manager${team ? ` ${team}` : ''}`)],
    ['Recruiters', li(`${co} technical recruiter`)],
    ['Engineering leaders', li(`${co} (head of engineering OR VP engineering OR director of engineering OR CTO)`)],
    ['Google search', `https://www.google.com/search?q=${enc(`site:linkedin.com/in "${co}" ("engineering manager" OR "head of engineering" OR "technical recruiter"${team ? ` OR "${team}"` : ''})`)}`],
  ];
  return links.map(([l, u]) => `<a class="btn btn-sm" href="${esc(u)}" target="_blank" rel="noopener">${l} ${icons.ext}</a>`).join('');
}

// "Recruiter at Smartsheet" listed on a Resend job: they work somewhere else.
function worksElsewhere(title) {
  const m = String(title || '').match(/\bat\s+([^,·|()]+)$/i);
  if (!m) return '';
  const a = m[1].trim().toLowerCase(), b = job.company.toLowerCase();
  return a.includes(b) || b.includes(a) ? '' : m[1].trim();
}

function contactCard(c) {
  const elsewhere = worksElsewhere(c.title);
  const writing = busy[`msg-${c.id}`];
  const replying = busy[`reply-${c.id}`];
  const first = esc((c.name || '').split(' ')[0] || 'them');
  const resumePdf = app().files?.resume;
  const pasteBox = (open) => `
    <details class="li-page" ${open ? 'open' : ''}>
      <summary>${c.profile ? `${icons.check} Their LinkedIn page is pasted <span class="hint">(${Math.round(c.profile.length / 100) / 10}k characters)</span>` : `Add their LinkedIn page <span class="hint">(optional, for posts only LinkedIn shows)</span>`}</summary>
      <p class="hint">On their profile press <kbd>⌘A</kbd> then <kbd>⌘C</kbd> and paste here, and the same on their <i>Activity</i> page for recent posts. Then press <i>Start over</i>.</p>
      <textarea class="textarea" data-field="profile" placeholder="Paste their profile and recent posts here">${esc(c.profile || '')}</textarea>
    </details>`;
  let body;
  const research = c.researchedAt ? `
    <details class="li-page" ${c.message ? '' : 'open'}>
      <summary>What I found about ${first} online <span class="hint">(${(c.research || []).length || 'nothing'})</span></summary>
      ${(c.research || []).length ? `<ul class="found">${c.research.map((x) => `<li>${esc(x.what)}${x.when ? ` <span class="hint">${esc(x.when)}</span>` : ''}${x.url ? ` <a href="${esc(x.url)}" target="_blank" rel="noopener" class="hint">source ${icons.ext}</a>` : ''}</li>`).join('')}</ul>`
        : '<p class="hint">Nothing public about them turned up, so the message opens plainly. Their LinkedIn posts would help (below).</p>'}
      <div class="row"><span class="hint">Searched ${ago(c.researchedAt)}. Public pages only; nothing is read from LinkedIn with your account.</span><button class="btn btn-sm btn-ghost" type="button" data-research>Search again</button></div>
    </details>` : '';
  if (elsewhere) body = `<div class="warn-banner">${icons.warn}<span>${first} works at <b>${esc(elsewhere)}</b>, not ${esc(job.company)}. Remove them (×) and find someone at ${esc(job.company)}.</span></div>`;
  else if (writing) body = busyBox(c.researchedAt || (c.profile || '').trim() ? `Writing your InMail to ${first}… about 20 to 40 seconds.` : `Looking ${first} up online, then writing your InMail… about a minute.`);
  else if (!c.message) body = `
    <div class="row write-row">
      <button class="btn btn-sm btn-primary" data-write>Write my InMail</button>
      <span class="hint">${c.profile ? 'Uses the LinkedIn page you pasted.' : `Looks ${first} up on the web first (posts, talks, articles), then writes it in your style.`}</span>
    </div>
    ${research}
    ${pasteBox(false)}`;
  else body = `
    ${c.hook ? `<div class="hook">${c.hook === 'nothing personal found' ? 'Their page had nothing personal to mention, so it opens plainly.' : `Opens with <b>${esc(c.hook)}</b>. Check it's right.`}</div>` : ''}
    <label>Subject <span class="hint" data-chars>${(c.subject || '').length}/60</span>
      <div class="row nowrap"><input class="input subject-input" data-field="subject" value="${esc(c.subject || '')}"><button class="btn btn-sm" data-copy="subject">${icons.copy} Copy</button></div></label>
    ${(c.subjects || []).length > 1 ? `<div class="subject-picks">${c.subjects.map((x) => `
      <button type="button" class="subject-pick ${x.text === c.subject ? 'on' : ''}" data-subject="${esc(x.text)}"><span class="angle">${esc(x.angle)}</span>${esc(x.text)}</button>`).join('')}</div>` : ''}
    <label>InMail <span class="hint" data-words>${(c.message.match(/\S+/g) || []).length} words</span>
      <textarea class="textarea inmail" data-field="message">${esc(c.message)}</textarea></label>
    <div class="row">
      <span class="row">
        ${resumePdf ? `<a class="btn btn-sm btn-ghost" href="/api/${uidPath()}/file/resume?download" download="${esc(resumePdf.split('/').pop())}" title="Attach this to the InMail">Résumé PDF to attach</a>` : ''}
      </span>
      <span class="row">
        <button class="btn btn-sm" data-copy="message">${icons.copy} Copy</button>
        ${c.linkedin ? `<button class="btn btn-sm btn-primary" data-copyopen>${icons.copy} Copy and open profile</button>` : ''}
      </span>
    </div>
    <form class="row nowrap redo" data-redo>
      <input class="input" name="instruction" placeholder="Change something: shorter, mention escrow, warmer close…">
      <button class="btn btn-sm" type="submit">Rewrite</button>
      <button class="btn btn-sm btn-ghost" type="button" data-write title="Write it again from scratch">Start over</button>
    </form>
    ${research}
    ${pasteBox(false)}
    <details class="li-page">
      <summary>Connection request instead <span class="hint">(no InMail credits)</span></summary>
      <label><span class="hint" data-count>${(c.note || '').length}/300</span>
        <textarea class="textarea" data-field="note" maxlength="300">${esc(c.note || '')}</textarea></label>
      <div class="row"><span class="hint">Connect → Add a note → paste.</span><button class="btn btn-sm" data-copy="note">${icons.copy} Copy</button></div>
    </details>
    <details class="li-page" ${c.theirReply || c.status === 'replied' ? 'open' : ''}>
      <summary>${first} replied?</summary>
      <textarea class="textarea" data-field="theirReply" placeholder="Paste what they wrote">${esc(c.theirReply || '')}</textarea>
      <input class="input" data-field="update" value="${esc(c.update || '')}" placeholder="Anything new to tell them? (optional, e.g. a recruiter reached out, call booked for Wednesday)">
      ${replying ? busyBox('Writing your reply…') : `<div><button class="btn btn-sm" data-reply>Write my reply</button></div>`}
      ${c.reply && !replying ? `<label>Your reply<textarea class="textarea" data-field="reply">${esc(c.reply)}</textarea></label>
        <div class="row"><span></span><button class="btn btn-sm" data-copy="reply">${icons.copy} Copy</button></div>` : ''}
    </details>`;
  return `
    <div class="contact" data-cid="${c.id}">
      <div class="top">
        ${avatar(c.name)}
        <div class="grow">
          <div class="name">${esc(c.name)} ${c.confidence ? `<span class="conf ${c.confidence}">${c.confidence === 'high' ? 'confirmed' : c.confidence === 'medium' ? 'likely' : 'unsure'}</span>` : ''}</div>
          <div class="sub">${esc(c.title || '')}${c.kind ? ` · ${esc(c.kind)}` : ''}</div>
        </div>
        ${c.linkedin ? `<a class="btn btn-sm btn-ghost" href="${esc(c.linkedin)}" target="_blank" rel="noopener">Profile ${icons.ext}</a>` : c.source ? `<a class="btn btn-sm btn-ghost" href="${esc(c.source)}" target="_blank" rel="noopener">Source ${icons.ext}</a>` : ''}
        <select class="input" data-status aria-label="Status">${STATUSES.map((s) => `<option ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <button class="btn btn-sm btn-ghost btn-icon btn-danger" data-del title="Remove" aria-label="Remove ${esc(c.name)}">${icons.x}</button>
      </div>
      ${c.why ? `<div class="why">${esc(c.why)}</div>` : ''}
      <div class="msgs">${body}</div>
    </div>`;
}

function writeInMail(c, instruction = '', research = false) {
  if (needKey()) return;
  if (research) c.researchedAt = null;
  run(`msg-${c.id}`, async () => { take(await api(`${uidPath()}/outreach`, { method: 'POST', body: { contactId: c.id, instruction, research } }), ['contacts']); }, ['people']);
}

const saveContacts = debounce(() => api(`${uidPath()}/app`, { method: 'PUT', body: { contacts: app().contacts } }), 500);

function peopleBody(root) {
  const a = app();
  if (!strongMatch() && !showPeopleAnyway && !(a.contacts || []).length) {
    root.innerHTML = `<p class="hint">Optional for this one. DMs are worth your time on your strongest matches (marked <b>Send a DM</b> in your picks).</p>
      <button class="btn btn-sm btn-ghost" id="peopleAnyway" style="margin-top:6px;margin-left:-8px">Find people anyway</button>`;
    $('#peopleAnyway', root).onclick = () => { showPeopleAnyway = true; drawSection('people'); };
    return;
  }
  const contacts = a.contacts || [];
  root.innerHTML = `
    <div class="stack">
      <div class="row">
        <button class="btn btn-primary" id="findPeople" ${busy.people ? 'disabled' : ''}>${busy.people ? '<span class="spinner"></span> Searching… 1 to 2 minutes' : `Find people at ${esc(job.company)} for me`}</button>
        ${a.peopleSearchedAt ? `<span class="hint">Last searched ${ago(a.peopleSearchedAt)}</span>` : ''}
      </div>
      <p class="hint">Searches the web for the likely hiring manager, recruiters and engineering leaders. Always open the profile to check they still work there before you message.</p>
      <div><span class="field-label">Or search LinkedIn yourself</span><div class="links">${searchLinks()}</div></div>
      <div id="contacts">${contacts.map(contactCard).join('')}</div>
      <form class="add-contact" id="addContact">
        <input class="input" name="linkedin" placeholder="Paste a LinkedIn profile link">
        <input class="input" name="name" placeholder="Name">
        <input class="input" name="title" placeholder="Their job title">
        <button class="btn" type="submit">${icons.plus} Add</button>
      </form>
    </div>`;

  $('#findPeople', root).onclick = () => { if (!needKey()) findPeople(false); };

  const form = $('#addContact', root);
  form.linkedin.addEventListener('input', () => {
    const m = form.linkedin.value.match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (m && !form.name.value) form.name.value = decodeURIComponent(m[1]).replace(/-[a-z0-9]*\d[a-z0-9]*$/i, '').split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) return toast('Add their name.');
    let url = form.linkedin.value.trim();
    if (url && !/^https?:/.test(url)) url = `https://${url}`;
    const title = form.title.value.trim();
    a.contacts.push({ id: Math.random().toString(36).slice(2, 10), name, title, linkedin: url, kind: /recruit|talent/i.test(title) ? 'recruiter' : /manager|director|head|vp|cto|lead/i.test(title) ? 'hiring manager' : 'engineer', status: 'to contact', found: 'you' });
    await saveContacts.flush();
    drawSection('people');
  };

  $$('.contact', root).forEach((card) => {
    const c = a.contacts.find((x) => x.id === card.dataset.cid);
    $('[data-status]', card).onchange = (e) => { c.status = e.target.value; saveContacts(); drawBar(); $('#sec-people').classList.toggle('done', stepState().people); };
    $('[data-del]', card).onclick = async () => { a.contacts = a.contacts.filter((x) => x !== c); await saveContacts.flush(); drawSection('people'); };
    const write = (instruction = '', research = false) => writeInMail(c, instruction, research);
    $('[data-research]', card)?.addEventListener('click', async () => { await saveContacts.flush(); write('', true); });
    $$('[data-write]', card).forEach((b) => b.onclick = async () => { await saveContacts.flush(); write(); });
    const redo = $('[data-redo]', card);
    if (redo) redo.onsubmit = async (e) => {
      e.preventDefault();
      const t = redo.instruction.value.trim();
      if (!t) return redo.instruction.focus();
      await saveContacts.flush();
      write(t);
    };
    $('[data-reply]', card)?.addEventListener('click', async () => {
      if (needKey()) return;
      if (!(c.theirReply || '').trim()) return toast('Paste what they wrote first.');
      await saveContacts.flush();
      run(`reply-${c.id}`, async () => {
        take(await api(`${uidPath()}/reply`, { method: 'POST', body: { contactId: c.id, theirReply: c.theirReply, update: c.update } }), ['contacts']);
        drawBar();
      }, ['people']);
    });
    $$('[data-field]', card).forEach((t) => t.addEventListener('input', () => {
      c[t.dataset.field] = t.value;
      if (t.dataset.field === 'note') $('[data-count]', card).textContent = `${t.value.length}/300`;
      if (t.dataset.field === 'subject') { $('[data-chars]', card).textContent = `${t.value.length}/60`; $$('[data-subject]', card).forEach((b) => b.classList.toggle('on', b.dataset.subject === t.value)); }
      if (t.dataset.field === 'message') $('[data-words]', card).textContent = `${(t.value.match(/\S+/g) || []).length} words`;
      saveContacts();
    }));
    $$('[data-subject]', card).forEach((b) => b.onclick = () => {
      const input = $('[data-field="subject"]', card);
      input.value = b.dataset.subject;
      input.dispatchEvent(new Event('input'));
    });
    $$('[data-copy]', card).forEach((b) => b.onclick = () => copy(c[b.dataset.copy], 'Copied. Paste it into LinkedIn.'));
    $('[data-copyopen]', card)?.addEventListener('click', () => {
      copy(c.message, `InMail copied. On ${c.name.split(' ')[0]}'s profile press Message, paste the subject and the message.`);
      window.open(c.linkedin, '_blank', 'noopener');
      if (c.status === 'to contact' || c.status === 'request sent') { c.status = 'messaged'; saveContacts(); $('[data-status]', card).value = c.status; drawBar(); }
    });
  });
}
