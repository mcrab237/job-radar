// Job Radar dashboard. Plain JavaScript, no build step.
import { $, $$, esc, enc, api, ago, until, avatar, plural, toast, debounce, fileToBase64, icons, copy } from '/ui.js';
import { renderApply } from '/apply.js';
import { mountPaper } from '/editor.js';
import { renderHelp } from '/help.js';
import { renderPractice } from '/practice.js';
import { renderToday } from '/today.js';
import { wireJobPreviews } from '/jd-modal.js';
import { renderQuick } from '/quick.js';
import { renderBoard } from '/board.js';
import { askRemove } from '/remove.js';
import { renderStats } from '/stats.js';

const view = $('#view');
let state = null;
// The Jobs tab you used last (Today's picks, Just posted…) is remembered on this browser.
const savedView = (() => { try { return localStorage.getItem('jobs-view'); } catch { return null; } })();
const jobFilter = { view: ['picks', 'best', 'today', 'all', 'removed'].includes(savedView) ? savedView : 'picks', q: '', source: '' };
let limit = 100;

// ---------- Status bar ----------

function renderStatus() {
  const s = state.status;
  const n = state.sources.filter((x) => !x.paused).length;
  let text;
  if (s.checking) text = `<span class="dot live"></span><span>Checking ${esc(s.current || '')}…</span>`;
  else if (!n) text = '<span class="dot idle"></span><span>No companies yet</span>';
  else if (s.reading) text = `<span class="dot live"></span><span>Reading ${s.reading} new jobs…</span>`;
  else text = `<span class="dot live"></span><span title="Next check in ${s.nextRun ? until(s.nextRun) : 'a few minutes'}">${n} companies · ${ago(s.lastRun) || 'soon'}</span>`;
  $('#status').innerHTML = text;
  $('#checkNow').disabled = s.checking || !n;
  const c = state.counts;
  $$('.nav a').forEach((a) => {
    const t = a.dataset.tab;
    const count = t === 'jobs' ? c.today : t === 'applications' ? c.saved + c.applied : null;
    $('.count', a)?.remove();
    if (count) a.insertAdjacentHTML('beforeend', `<span class="count">${count}</span>`);
  });
  document.title = c.today ? `(${c.today} new) Job Radar` : 'Job Radar';
}

async function refreshState() {
  state = await api('state');
  renderStatus();
}

const progress = () => {
  const goal = state.dailyTarget || state.settings.dailyGoal;
  const pct = Math.min(100, Math.round((state.today / goal) * 100));
  return `<div class="progress"><span><b>${state.today}</b> of ${goal} applied today</span><span class="bar"><i style="width:${pct}%"></i></span></div>`;
};

// ---------- Jobs ----------

function welcome() {
  const needResume = !state.resumes.length;
  const needKey = !state.ai.hasKey;
  return `
    <section class="card welcome">
      <h1>Find jobs early. Apply well. Reach the right person.</h1>
      <p>Job Radar watches the companies you pick, fits your résumé and cover letter to each job, fills in the application, and helps you message the hiring manager. You check everything before it goes anywhere.</p>
      <div class="steps">
        <div class="step"><div class="num">1</div><h3>Set yourself up</h3><p>${needResume || needKey ? `Add ${[needResume && 'your résumé', needKey && 'your OpenAI key'].filter(Boolean).join(' and ')}.` : 'Résumé and OpenAI key are in. ✓'}</p><a class="btn btn-sm ${needResume || needKey ? 'btn-primary' : ''}" href="#settings">Settings</a></div>
        <div class="step"><div class="num">2</div><h3>Add companies</h3><p>Start with ${state.catalog.core + state.catalog.smaller} companies picked for you: payments, fintech and well-paying tech. Add your own any time.</p><button class="btn btn-sm ${!needResume && !needKey ? 'btn-primary' : ''}" id="addCatalog">Add the ${state.catalog.core + state.catalog.smaller} companies</button></div>
        <div class="step"><div class="num">3</div><h3>Apply as jobs appear</h3><p>You get an alert. Open the job, review your résumé and letter, apply, then message someone there.</p><a class="btn btn-sm" href="#help">How it works</a></div>
      </div>
    </section>`;
}

async function addCatalog(btn, groups = ['core', 'smaller']) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Adding…';
  const { added } = await api('catalog', { method: 'POST', body: { groups } });
  toast(`Added ${added} companies. Job Radar is reading their jobs now; your picks fill in over the next few minutes.`, { ms: 9000 });
  await refreshState();
  route();
}

async function renderJobs() {
  if (!state.sources.length && !state.counts.all) {
    view.innerHTML = welcome();
    $('#addCatalog').onclick = (e) => addCatalog(e.currentTarget);
    return;
  }
  const c = state.counts;
  const segs = [['picks', "Today's picks", c.picks], ['best', 'Best matches', c.best], ['today', 'Just posted', c.today], ['all', 'Everything', c.all], ['removed', 'Removed', c.removed || 0]];
  view.innerHTML = `
    <div class="page-head">
      <div class="grow"><h1>Jobs</h1></div>
      ${progress()}
      <a class="btn" href="#quick">${icons.plus} Add a job</a>
    </div>
    <div class="toolbar">
      <div class="seg" role="tablist">${segs.map(([k, l, n]) => `<button role="tab" data-seg="${k}" class="${jobFilter.view === k ? 'active' : ''}" aria-selected="${jobFilter.view === k}">${l}<span class="n">${n}</span></button>`).join('')}</div>
      <label class="search">${icons.search}<input class="input" id="q" placeholder="Search title, company, place" value="${esc(jobFilter.q)}" aria-label="Search jobs"></label>
      <select class="input" id="src" aria-label="Filter by source"><option value="">All sources</option>${state.sources.map((s) => `<option value="${s.id}" ${jobFilter.source === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    </div>
    <div id="list"></div>`;
  $$('[data-seg]').forEach((b) => b.onclick = () => { jobFilter.view = b.dataset.seg; try { localStorage.setItem('jobs-view', b.dataset.seg); } catch {} limit = 100; renderJobs(); });
  $('#q').oninput = debounce((e) => { jobFilter.q = e.target.value; limit = 100; loadList(); }, 150);
  $('#src').onchange = (e) => { jobFilter.source = e.target.value; limit = 100; loadList(); };
  await loadList();
}


async function loadList() {
  const list = $('#list');
  if (!list) return;
  const p = new URLSearchParams({ view: jobFilter.view, q: jobFilter.q, source: jobFilter.source, limit });
  const { jobs, total } = await api(`jobs?${p}`);
  if (!jobs.length) {
    const msg = jobFilter.q || jobFilter.source
      ? ['Nothing found', 'Try a different search or source.']
      : state.status.reading
        ? ['Reading job details…', `Job Radar is going through ${state.status.reading} new jobs to check pay, level and fit. This fills in over the next few minutes.`]
        : jobFilter.view === 'removed'
          ? ['Nothing removed', 'When a job isn\'t right, press × on it and pick a reason. It lands here, and picks learn from it.']
        : jobFilter.view === 'today'
          ? ['No new matches yet', 'Job Radar is watching. New jobs that fit will show up here and you\'ll get an alert. Meanwhile, look at <a href="#" data-goto="best">your best matches</a>.']
          : ['Nothing fits your filter right now', 'Add more companies, or loosen your filter in <a href="#settings">Settings</a>.'];
    list.innerHTML = `<div class="card empty">${icons.radar}<h3>${msg[0]}</h3><p>${msg[1]}</p></div>`;
    $$('[data-goto]', list).forEach((a) => a.onclick = (e) => { e.preventDefault(); jobFilter.view = a.dataset.goto; renderJobs(); });
    return;
  }
  if (jobFilter.view === 'removed') {
    list.innerHTML = `<p class="hint" style="margin:0 0 10px">Jobs you removed, newest first. Picks rank jobs like these lower. Restore one to bring it back.</p>
      <div class="card jobs">${jobs.map(removedRow).join('')}</div>`;
    $$('[data-restore]', list).forEach((b) => b.onclick = async () => {
      b.disabled = true;
      await api(`jobs/${enc(b.dataset.restore)}/restore`, { method: 'POST' });
      toast('Restored. It\'s back in your jobs.');
      await refreshState();
      renderJobs();
    });
    return;
  }
  if (jobFilter.view === 'picks') {
    const main = jobs.filter((j) => j.track !== 'smaller');
    const smaller = jobs.filter((j) => j.track === 'smaller');
    list.innerHTML = `
      ${state.mix?.label ? `<div class="mix-note">${esc(state.mix.label)} (week ${state.mix.week}). ${state.mix.dreamHeld ? `Dream companies join on week ${state.mix.dreamFromWeek}.` : ''} <a href="#settings/filter">Change</a></div>` : ''}
      <div class="track-head"><h2>Top picks</h2><span class="muted">${main.length} · payments first, best paid</span></div>
      <div class="card jobs">${main.map(jobRow).join('') || '<div class="empty" style="padding:20px">None right now</div>'}</div>
      <div class="track-head smaller"><h2>Smaller &amp; local</h2><span class="muted">${smaller.length} · under $${Math.round(state.settings.prefs.smallerMaxPay / 1000)}k, Atlanta first</span></div>
      <div class="card jobs track-smaller">${smaller.map(jobRow).join('') || '<div class="empty" style="padding:20px">No smaller-company matches right now. More appear as new jobs come in.</div>'}</div>`;
  } else {
    list.innerHTML = `<div class="card jobs">${jobs.map(jobRow).join('')}${total > jobs.length ? `<a href="#" class="more" id="more">Show more (${total - jobs.length} left)</a>` : ''}</div>`;
  }
  $('#more')?.addEventListener('click', (e) => { e.preventDefault(); limit += 200; loadList(); });
  jobs.forEach((j) => wireJob($(`[data-uid="${CSS.escape(j.uid)}"]`, list), j));
}

const STATUS_LABEL = { saved: 'Saved', applied: 'Applied', interview: 'Interviewing', offer: 'Offer', rejected: 'Closed' };

const money = (n) => `$${Math.round(n / 1000)}k`;
export const LEVEL = { entry: 'Entry level', mid: 'Mid level', senior: 'Senior', lead: 'Lead' };
const PLACE = { remote: 'Remote (US)', atlanta: 'Atlanta', relocate: 'Relocate' };

function fitChips(j) {
  const f = j.fit;
  if (!f) return j.remote ? '<span class="badge badge-remote">Remote</span>' : '';
  const pay = f.salary ? `<span class="badge badge-pay" title="${f.salary.source === 'posted' ? 'From the job posting' : 'Estimate from the company and level'}">${money(f.salary.min)}–${money(f.salary.max)}${f.salary.source === 'posted' ? '' : ' est.'}</span>` : '';
  return [
    pay,
    `<span class="badge badge-status">${LEVEL[f.level]}</span>`,
    f.years != null ? `<span class="badge ${{ good: 'badge-pay', okay: 'badge-status', stretch: 'badge-pay-domain' }[f.yearsFit] || 'badge-status'}" title="Years of experience the job asks for">${f.years}+ yrs${f.yearsFit === 'stretch' ? ' · stretch' : ''}</span>` : '',
    { js: '<span class="badge badge-pay" title="Asks for JavaScript/TypeScript">TypeScript/JS</span>', any: '<span class="badge badge-status" title="Says any language, or a comparable one, is fine">Other languages OK</span>', unknown: '<span class="badge badge-pay-domain" title="The description doesn\'t name a language">Language not stated</span>' }[f.lang] || '',
    f.place ? `<span class="badge badge-remote">${PLACE[f.place]}</span>` : '',
    f.payments ? '<span class="badge badge-pay-domain">Payments</span>' : '',
  ].join('');
}

function jobRow(j) {
  const hot = Date.now() - Date.parse(j.sortTime) < 3 * 3600e3 && j.fresh;
  const isNew = j.fresh && Date.now() - Date.parse(j.sortTime) < 864e5;
  const tracked = STATUS_LABEL[j.status];
  const applied = ['applied', 'interview', 'offer'].includes(j.status);
  return `
    <div class="job ${j.track === 'smaller' ? 'job-smaller' : ''}" data-uid="${esc(j.uid)}" title="${esc((j.fit?.why || []).join(' · '))}">
      ${avatar(j.company, j.logo)}
      <div class="job-main">
        <a class="job-title" href="#apply/${enc(j.uid)}" data-jd="${esc(j.uid)}" title="Read the job description">${esc(j.title)}</a>
        <div class="job-meta">
          <span>${esc(j.company)}</span>
          ${j.location ? `<span class="sep">·</span><span>${esc(j.location)}</span>` : ''}
          ${isNew ? '<span class="badge badge-new">New</span>' : ''}
          ${j.track === 'smaller' ? `<span class="badge badge-smaller">${j.smallCo ? 'Smaller company' : 'Lower pay'}</span>` : ''}
          ${j.dream ? `<span class="badge badge-dream" title="${state.mix?.dreamHeld ? `Held back from picks until week ${state.mix.dreamFromWeek}` : 'One of your dream companies'}">Dream company${state.mix?.dreamHeld ? ` · week ${state.mix.dreamFromWeek}` : ''}</span>` : ''}
          ${j.dm ? '<span class="badge badge-dm" title="Strong match: a short note to the hiring manager is worth it">Send a DM</span>' : ''}
          ${j.why ? `<span class="badge badge-new-pick" title="${esc(j.why)}">${icons.check} Replacement</span>` : ''}
        </div>
        <div class="job-meta chips-row">
          ${fitChips(j)}
          ${tracked ? `<span class="badge badge-status">${tracked}</span>` : j.approved ? '<span class="badge badge-status">Ready to send</span>' : j.tailored ? '<span class="badge badge-status">Started</span>' : ''}
        </div>
      </div>
      <div class="job-side">
        <span class="when ${hot ? 'hot' : ''}" title="${j.postedAt ? `Posted ${new Date(j.postedAt).toLocaleString()}` : `First seen ${new Date(j.firstSeen).toLocaleString()}`}">${ago(j.sortTime)}</span>
        <button class="btn btn-sm btn-ghost btn-icon" data-jd="${esc(j.uid)}" title="Read the job description" aria-label="Read the job description">${icons.doc}</button>
        ${j.url ? `<a class="btn btn-sm btn-ghost btn-icon" href="${esc(j.url)}" target="_blank" rel="noopener" title="View posting" aria-label="View posting">${icons.ext}</a>` : ''}
        <button class="btn btn-sm btn-ghost btn-icon ${j.status === 'saved' ? 'on' : ''}" data-act="save" title="${j.status === 'saved' ? 'Saved' : 'Save for later'}" aria-label="Save for later">${j.status === 'saved' ? icons.bookmarkFill : icons.bookmark}</button>
        <button class="btn btn-sm btn-ghost btn-icon" data-act="hide" title="Remove (pick a reason)" aria-label="Remove this job">${icons.x}</button>
        <a class="btn btn-sm ${applied ? '' : 'btn-primary'}" href="#apply/${enc(j.uid)}">${applied ? 'Open' : 'Apply'}</a>
      </div>
    </div>`;
}

const REMOVED_LABEL = { stack: 'Not my stack', senior: 'Too senior', pay: 'Pay too low', place: 'Wrong location', company: 'Not this company', meh: 'Not interested' };
function removedRow(j) {
  const r = j.removed || {};
  return `
    <div class="job removed-row" data-uid="${esc(j.uid)}">
      ${avatar(j.company, j.logo)}
      <div class="job-main">
        <a class="job-title" href="#apply/${enc(j.uid)}" data-jd="${esc(j.uid)}">${esc(j.title)}</a>
        <div class="job-meta"><span>${esc(j.company)}</span>${j.location ? `<span class="sep">·</span><span>${esc(j.location)}</span>` : ''}</div>
        <div class="job-meta chips-row">${fitChips(j)}</div>
      </div>
      <div class="job-side">
        <span class="badge badge-removed">${esc(REMOVED_LABEL[r.reason] || 'Removed')}</span>
        <span class="when">${ago(r.at)}</span>
        <button class="btn btn-sm" data-restore="${esc(j.uid)}">Restore</button>
      </div>
    </div>`;
}

async function setStatus(j, status) {
  await api(`jobs/${enc(j.uid)}`, { method: 'PATCH', body: { status } });
  j.status = status;
  refreshState();
}

function wireJob(row, j) {
  if (!row) return;
  $$('[data-act]', row).forEach((b) => b.onclick = async () => {
    if (b.dataset.act === 'save') {
      await setStatus(j, j.status === 'saved' ? 'new' : 'saved');
      row.outerHTML = jobRow(j);
      wireJob($(`[data-uid="${CSS.escape(j.uid)}"]`), j);
    } else if (b.dataset.act === 'hide') {
      askRemove(j, b, async () => { await refreshState(); renderJobs(); });
    }
  });
}

// ---------- Applications ----------

// ---------- Sources ----------

const SUGGESTED = ['Stripe', 'Vercel', 'Figma', 'Notion', 'Linear', 'Airbnb', 'Supabase', 'Coinbase', 'Discord', 'Ramp', 'Plaid', 'Duolingo'];
const BOARDS = [
  ['remotive', 'Remotive', 'Hand-picked remote jobs from around the world.'],
  ['remoteok', 'Remote OK', 'One of the biggest remote job boards.'],
  ['arbeitnow', 'Arbeitnow', 'Jobs in Europe, many with visa sponsorship.'],
];
const labelOf = (t) => ({ greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workable: 'Workable', smartrecruiters: 'SmartRecruiters', recruitee: 'Recruitee' }[t] || t);

function renderSources() {
  const company = state.sources.filter((s) => !['remotive', 'remoteok', 'arbeitnow'].includes(s.type));
  view.innerHTML = `
    <div class="page-head"><div class="grow"><h1>Companies</h1></div></div>

    <section class="card card-pad" style="margin-bottom:16px">
      <h2 style="margin:0 0 4px;font-size:16px">Companies picked for you</h2>
      <p class="hint" style="margin-bottom:12px">${state.catalog.core} payments, fintech and well-paying tech companies, plus ${state.catalog.smaller} smaller ones that pay about $80k–$150k. ${state.catalog.added ? `${state.catalog.added} are already in your list.` : ''}</p>
      ${state.catalog.added >= state.catalog.core + state.catalog.smaller ? '<div class="ok-line" style="margin:0">✓ All added</div>' : `<div class="row">
        <button class="btn btn-primary" data-catalog="core,smaller">Add all ${state.catalog.core + state.catalog.smaller}</button>
        <button class="btn" data-catalog="core">Only the ${state.catalog.core} bigger ones</button>
      </div>`}
    </section>

    <section class="card card-pad">
      <h2 style="margin:0 0 4px;font-size:16px">Add a company</h2>
      <p class="hint" style="margin-bottom:12px">A name or a careers page link.</p>
      <form class="finder" id="finder">
        <input class="input input-lg" id="finderInput" placeholder="e.g. Stripe, or https://acme.com/careers" autocomplete="off" aria-label="Company name or careers page link">
        <button class="btn btn-primary" style="height:46px;padding:0 20px" type="submit">Find jobs</button>
      </form>
      <div class="suggest"><span class="lbl">Try:</span>${SUGGESTED.map((s) => `<button class="chip-btn" data-try="${s}">${s}</button>`).join('')}</div>
      <div class="found" id="found"></div>
    </section>

    <section class="section">
      <h2>Companies you're watching</h2>
      ${company.length ? `<div class="card">${company.map(sourceRow).join('')}</div>` : '<p class="hint">None yet. Add one above.</p>'}
    </section>

    <section class="section">
      <h2>Job boards</h2>
      <p class="hint">Your filter still applies.</p>
      <div class="boards">${BOARDS.map(([type, name, sub]) => {
        const s = state.sources.find((x) => x.type === type);
        return `<div class="board"><div class="name">${name}</div><div class="sub">${sub}${s ? `<br>${plural(s.jobCount || 0, 'job')} · checked ${ago(s.lastChecked)}` : ''}</div>
          ${s ? `<button class="btn btn-sm btn-danger" data-remove="${s.id}">Stop watching</button>` : `<button class="btn btn-sm" data-board="${type}" data-name="${name}">Watch ${name}</button>`}</div>`;
      }).join('')}</div>
    </section>

    <section class="section">
      <h2>LinkedIn, Indeed, Dice and others</h2>
      <p class="hint" style="margin-bottom:10px">These sites block bots, so these just open their newest-first searches. Found something? Use <b>Add a job</b> on the Jobs page.</p>
      <div class="quick">${state.quickSearches.map((q) => `<a href="${esc(q.url)}" target="_blank" rel="noopener"><div class="name">${esc(q.site)} ${icons.ext}</div><div class="sub">${esc(q.hint)}</div></a>`).join('')}</div>
    </section>`;

  $$('[data-catalog]').forEach((b) => b.onclick = () => addCatalog(b, b.dataset.catalog.split(',')));
  $('#finder').onsubmit = (e) => { e.preventDefault(); find($('#finderInput').value); };
  $$('[data-try]').forEach((b) => b.onclick = () => { $('#finderInput').value = b.dataset.try; find(b.dataset.try); });
  $$('[data-board]').forEach((b) => b.onclick = () => addSource({ type: b.dataset.board, token: '', name: b.dataset.name }, b));
  wireSourceRows();
}

function sourceRow(s) {
  return `
    <div class="source ${s.paused ? 'paused' : ''}" data-id="${s.id}">
      ${avatar(s.name, s.logo)}
      <div style="min-width:0">
        <div class="name">${esc(s.name)} <span class="muted" style="font-weight:400;font-size:13px">· ${esc(s.label)}</span></div>
        ${s.lastError ? `<div class="err">Couldn't check: ${esc(s.lastError)}</div>` : `<div class="sub">${plural(s.jobCount || 0, 'open job')} · checked ${ago(s.lastChecked) || 'not yet'}${s.paused ? ' · paused' : ''}</div>`}
      </div>
      <div class="row">
        <button class="btn btn-sm btn-ghost" data-jobs="${s.id}">See jobs</button>
        <button class="btn btn-sm btn-ghost" data-pause="${s.id}">${s.paused ? 'Resume' : 'Pause'}</button>
        <button class="btn btn-sm btn-ghost btn-icon btn-danger" data-remove="${s.id}" title="Stop watching" aria-label="Stop watching ${esc(s.name)}">${icons.x}</button>
      </div>
    </div>`;
}

function wireSourceRows() {
  $$('[data-remove]').forEach((b) => b.onclick = async () => {
    const s = state.sources.find((x) => x.id === b.dataset.remove);
    if (!confirm(`Stop watching ${s.name}? Jobs you saved or applied to stay in Applications.`)) return;
    await api(`sources/${s.id}`, { method: 'DELETE' });
    await refreshState();
    renderSources();
  });
  $$('[data-pause]').forEach((b) => b.onclick = async () => {
    const s = state.sources.find((x) => x.id === b.dataset.pause);
    await api(`sources/${s.id}`, { method: 'PATCH', body: { paused: !s.paused } });
    await refreshState();
    renderSources();
  });
  $$('[data-jobs]').forEach((b) => b.onclick = () => { jobFilter.source = b.dataset.jobs; jobFilter.view = 'all'; location.hash = 'jobs'; });
}

async function find(input) {
  input = input.trim();
  if (!input) return;
  const box = $('#found');
  box.innerHTML = `<div class="found-item"><span class="spinner"></span><div class="grow">Looking for <b>${esc(input)}</b>'s jobs…</div></div>`;
  try {
    const { found } = await api('detect', { method: 'POST', body: { input } });
    if (!found.length) {
      box.innerHTML = `<div class="found-item"><div class="grow"><div class="name">Couldn't find a job board for "${esc(input)}"</div><div class="sub">Try pasting the link to their careers page instead.</div></div></div>`;
      return;
    }
    box.innerHTML = found.map((f, i) => `
      <div class="found-item">
        ${avatar(f.name)}
        <div class="grow">
          <div class="name">${esc(f.name)} <span class="muted" style="font-weight:400;font-size:13px">· ${plural(f.jobCount, 'open job')} on ${esc(f.type === 'page' ? 'their careers page' : labelOf(f.type))}</span></div>
          <div class="sub">${f.sample.length ? `e.g. ${f.sample.map(esc).join(' · ')}` : esc(f.url)}</div>
          ${f.note ? `<div class="note">${esc(f.note)}</div>` : ''}
        </div>
        ${f.added ? '<span class="muted">Already watching</span>' : `<button class="btn btn-primary btn-sm" data-add="${i}">Watch</button>`}
      </div>`).join('');
    $$('[data-add]', box).forEach((b) => b.onclick = () => addSource(found[b.dataset.add], b));
  } catch (e) {
    box.innerHTML = `<div class="found-item"><div class="grow"><div class="name">That didn't work</div><div class="sub">${esc(e.message)}</div></div></div>`;
  }
}

async function addSource(f, btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Adding…';
  try {
    const { source } = await api('sources', { method: 'POST', body: { type: f.type, token: f.token, name: f.name, url: f.url } });
    await refreshState();
    const matchCount = (await api(`jobs?view=matches&source=${source.id}&limit=1`)).total;
    const t = toast(`Now watching <b>${esc(source.name)}</b>. ${plural(matchCount, 'job')} already match${matchCount === 1 ? 'es' : ''}. <a href="#jobs" data-see>See them</a>`, { ms: 7000 });
    $('[data-see]', t).onclick = () => { jobFilter.source = source.id; jobFilter.view = 'matches'; };
    renderSources();
  } catch (e) {
    toast(esc(e.message), { error: true });
    btn.disabled = false;
    btn.textContent = 'Watch';
  }
}

// ---------- Settings ----------

let pendingSettings = {};
const flushSettings = debounce(async () => {
  const body = pendingSettings;
  pendingSettings = {};
  state = { ...state, ...(await api('settings', { method: 'PUT', body })) };
  renderStatus();
  $$('.saved-note').forEach((n) => { n.classList.add('show'); setTimeout(() => n.classList.remove('show'), 1500); });
}, 400);
function queueSave(patch) {
  const profile = patch.profile ? { ...(pendingSettings.profile || {}), ...patch.profile } : pendingSettings.profile;
  const prefs = patch.prefs ? { ...(pendingSettings.prefs || {}), ...patch.prefs } : pendingSettings.prefs;
  const outreach = patch.outreach ? { ...(pendingSettings.outreach || {}), ...patch.outreach } : pendingSettings.outreach;
  Object.assign(pendingSettings, patch, profile ? { profile } : {}, prefs ? { prefs } : {}, outreach ? { outreach } : {});
  flushSettings();
}

const chipGet = (key) => key.startsWith('prefs.') ? state.settings.prefs[key.slice(6)] : state.settings[key];
function chipSet(key, value) {
  if (key.startsWith('prefs.')) {
    state.settings.prefs[key.slice(6)] = value;
    queueSave({ prefs: { [key.slice(6)]: value } });
  } else {
    state.settings[key] = value;
    queueSave({ [key]: value });
  }
}

function chipField(key, cls = '') {
  return `<div class="chips ${cls}" data-chips="${key}">${chipGet(key).map((v, i) => `<span class="chip">${esc(v)}<button type="button" data-del="${i}" aria-label="Remove ${esc(v)}">×</button></span>`).join('')}<input placeholder="Type and press Enter" aria-label="Add to ${key}"></div>`;
}

function wireChips() {
  $$('[data-chips]').forEach((box) => {
    const key = box.dataset.chips;
    const input = $('input', box);
    box.onclick = (e) => { if (e.target === box) input.focus(); };
    const commit = () => {
      const vals = input.value.split(',').map((s) => s.trim()).filter(Boolean);
      if (!vals.length) return;
      chipSet(key, [...new Set([...chipGet(key), ...vals])]);
      rerenderChips(box, key);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
      if (e.key === 'Backspace' && !input.value && chipGet(key).length) {
        chipSet(key, chipGet(key).slice(0, -1));
        rerenderChips(box, key);
      }
    };
    input.onblur = commit;
    $$('[data-del]', box).forEach((b) => b.onclick = () => {
      chipSet(key, chipGet(key).filter((_, i) => i !== Number(b.dataset.del)));
      rerenderChips(box, key);
    });
  });
}
function rerenderChips(box, key) {
  const tmp = document.createElement('div');
  tmp.innerHTML = chipField(key, box.classList.contains('exclude') ? 'exclude' : '');
  box.replaceWith(tmp.firstElementChild);
  wireChips();
  $(`[data-chips="${key}"] input`).focus();
}

// Where the OpenAI money goes: tokens per day and per kind of task.
const TASK_NAMES = { tailored_resume: 'Fit résumé', cover_letter: 'Cover letter', revised_resume: 'Résumé changes', revised_cover_letter: 'Letter changes', outreach: 'InMails', outreach_reply: 'Replies', person_research: 'Person lookup (web)', people: 'Find people (web)', salary: 'Pay lookup (web)', replacement: 'Replacement picks', posting: 'Read a posting', parsed_resume: 'Read a résumé PDF' };
function usageHtml(u) {
  if (!u) return '';
  const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  const rows = Object.entries(u.tasks).sort((a, b) => (b[1].input + b[1].output * 4) - (a[1].input + a[1].output * 4));
  return `
    <div class="usage">
      <div class="usage-top">
        <div><b>${u.today.calls}</b> calls today · ${k(u.today.input)} in · ${k(u.today.output)} out${u.today.searches ? ` · ${u.today.searches} web searches` : ''}</div>
        <a class="hint" href="https://platform.openai.com/usage" target="_blank" rel="noopener">Exact spend ${icons.ext}</a>
      </div>
      ${rows.length ? `<table class="usage-table"><thead><tr><th>Last 7 days</th><th>Calls</th><th>Tokens in</th><th>Tokens out</th><th>Searches</th></tr></thead><tbody>
        ${rows.map(([n, t]) => `<tr><td>${esc(TASK_NAMES[n] || n)}</td><td>${t.calls}</td><td>${k(t.input)}</td><td>${k(t.output)}</td><td>${t.searches || ''}</td></tr>`).join('')}
      </tbody></table>` : '<p class="hint">Usage shows up here after the next AI action.</p>'}
      <p class="hint">Output tokens (including the model's thinking) cost several times more than input. Web searches add a fee each.</p>
    </div>`;
}

async function renderSettings(focus) {
  const s = state.settings;
  const p = s.profile;
  const { coverSample } = await api('resumes');
  const f = (k, label, ph = '', type = 'text') => `<label class="field"><span>${label}</span><input class="input" data-p="${k}" type="${type}" value="${esc(p[k])}" placeholder="${esc(ph)}"></label>`;
  view.innerHTML = `
    <div class="page-head"><div class="grow"><h1>Settings</h1><p>Changes save on their own. <span class="saved-note">Saved ✓</span></p></div></div>
    <div class="settings">

      <section class="card card-pad" id="resumes">
        <h2>Your résumés</h2>
        <p class="hint">One per kind of role. The closest one is used for each job.</p>
        <div class="card resume-list">${state.resumes.map((r) => `
          <div class="source"><div class="avatar" style="background:#64748b">R</div>
            <div><div class="name">${esc(r.name)}</div></div>
            <div class="row"><a class="btn btn-sm" href="#resume/${r.id}">Edit</a><button class="btn btn-sm btn-ghost btn-icon btn-danger" data-delresume="${r.id}" aria-label="Delete ${esc(r.name)}">${icons.x}</button></div>
          </div>`).join('') || '<div class="empty" style="padding:24px">No résumé yet.</div>'}</div>
        <div class="row" style="margin-top:12px">
          <label class="btn file-btn">${icons.plus} Upload a résumé PDF<input type="file" accept="application/pdf" id="uploadResume"></label>
          <span class="hint" id="uploadNote">Uses your OpenAI key to read it. You can check and fix it after.</span>
        </div>
      </section>

      <section class="card card-pad">
        <h2>A cover letter you've sent before</h2>
        <p class="hint">New letters copy its tone.</p>
        <textarea class="textarea" id="coverSample" style="min-height:180px" placeholder="Paste a cover letter you wrote">${esc(coverSample)}</textarea>
        <div class="row" style="margin-top:10px"><label class="btn btn-sm file-btn">Upload a PDF instead<input type="file" accept="application/pdf" id="uploadCover"></label></div>
      </section>

      <section class="card card-pad" id="inmail">
        <h2>Your InMail style</h2>
        <p class="hint">Messages to people at a company copy these. Add new ones that get replies; the more real examples, the closer it gets.</p>
        <div class="stack" style="margin-top:10px">
          <div class="grid-2">
            <label class="field"><span>Portfolio link</span><input class="input" data-o="portfolio" value="${esc(s.outreach.portfolio)}"></label>
            <label class="field"><span>Sign off as</span><input class="input" data-o="signoff" value="${esc(s.outreach.signoff)}"></label>
          </div>
          <label class="field"><span>Things you can say about yourself</span><textarea class="textarea" data-o="facts" style="min-height:150px">${esc(s.outreach.facts)}</textarea>
            <span class="hint">One per line. Used together with your résumé; nothing else about you gets added.</span></label>
          <details class="li-page"><summary>Messages that got replies <span class="hint">(${s.outreach.examples.split(/\n---\n/).length})</span></summary>
            <textarea class="textarea" data-o="examples" style="min-height:420px;font-size:12.5px">${esc(s.outreach.examples)}</textarea>
            <p class="hint">Separate messages with a line containing only <code>---</code>. A "To:" line saying who they went to helps.</p></details>
          <details class="li-page"><summary>Your replies when they answer <span class="hint">(${s.outreach.replies.split(/\n---\n/).length})</span></summary>
            <textarea class="textarea" data-o="replies" style="min-height:260px;font-size:12.5px">${esc(s.outreach.replies)}</textarea></details>
        </div>
      </section>

      <section class="card card-pad">
        <h2>Extra skills you can claim</h2>
        <p class="hint">Not on your résumé, but you could discuss them in an interview.</p>
        ${chipField('skillsBank')}
      </section>

      <section class="card card-pad">
        <h2>OpenAI</h2>
        <p class="hint">Fits résumés, writes letters and messages, finds people. A few cents per job.</p>
        <div class="stack">
          ${state.ai.hasKey ? `<div class="ok-line" style="margin:0">${icons.check} Connected (key ${esc(state.ai.keyHint)})</div>` : ''}
          <div class="row">
            <input class="input" id="aiKey" type="password" autocomplete="off" placeholder="${state.ai.hasKey ? 'Paste a new key to replace it' : 'Paste your API key (starts with sk-)'}" style="flex:1;min-width:240px">
            <button class="btn btn-primary" id="saveKey">Save key</button>
          </div>
          <p class="hint">Get one at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a>. It's stored only on this computer.</p>
          ${state.ai.hasKey ? `<div class="grid-2">
            <label class="field"><span>Main model <small class="muted">· résumé, cover letter, InMails</small></span><select class="input" id="aiModel"><option>${esc(state.ai.model || '')}</option></select></label>
            <label class="field"><span>Small-task model <small class="muted">· replies, lookups, replacements</small></span><select class="input" id="aiModelLight"><option>${esc(state.ai.modelLight || '')}</option></select></label>
          </div>
          ${usageHtml(state.ai.usage)}` : ''}
        </div>
      </section>

      <section class="card card-pad" id="filter">
        <h2>Your job filter</h2>
        
        <div class="stack">
          <div class="field"><span class="field-label">Level mix in your daily picks</span>
            <div class="row">
              <label class="inline-num"><input class="input" type="number" min="0" max="100" data-pref="mix.entry" value="${s.prefs.mix.entry}" aria-label="Entry level percent"><span class="muted">% entry level</span></label>
              <label class="inline-num"><input class="input" type="number" min="0" max="100" data-pref="mix.mid" value="${s.prefs.mix.mid}" aria-label="Mid level percent"><span class="muted">% mid level / SWE II</span></label>
              <label class="inline-num"><input class="input" type="number" min="0" max="100" data-pref="mix.senior" value="${s.prefs.mix.senior}" aria-label="Stretch percent"><span class="muted">% stretch (asks ${s.prefs.maxYears} years)</span></label>
            </div>
          </div>
          <div class="switch"><div class="txt"><b>Most years of experience a job can ask for</b><span>2 or less is ideal, 3 is fine, 4 is a stretch. Jobs asking for more are hidden, and so are senior roles unless they ask ${s.prefs.maxYears} years or less.</span></div><div class="inline-num"><input class="input" type="number" min="1" max="10" data-pref="maxYears" value="${s.prefs.maxYears}" aria-label="Most years asked"><span class="muted">years</span></div></div>
          <div class="field"><span class="field-label">Base pay</span>
            <div class="row">
              <label class="inline-num"><span class="muted">$</span><input class="input" style="width:110px" type="number" step="5000" data-pref="salaryMin" value="${s.prefs.salaryMin}" aria-label="Lowest pay"></label>
              <span class="muted">to</span>
              <label class="inline-num"><span class="muted">$</span><input class="input" style="width:110px" type="number" step="5000" data-pref="salaryMax" value="${s.prefs.salaryMax}" aria-label="Highest pay"></label>
            </div>
            <p class="hint">Uses the pay in the posting. When there isn't one, an estimate from the company and level (marked "est.").</p>
          </div>
          <div class="switch"><div class="txt"><b>Remote (US)</b><span>Remote jobs open to people in the US.</span></div><label class="toggle"><input type="checkbox" data-pref="remote" ${s.prefs.remote ? 'checked' : ''}><i></i></label></div>
          <div class="switch"><div class="txt"><b>Atlanta</b><span>Including Alpharetta and the rest of metro Atlanta.</span></div><label class="toggle"><input type="checkbox" data-pref="atlanta" ${s.prefs.atlanta ? 'checked' : ''}><i></i></label></div>
          <div class="field"><span class="field-label">Places you'd move to</span>${chipField('prefs.relocate')}
            <div class="row" style="margin-top:8px"><span class="muted">only when the pay goes up to at least $</span><input class="input" style="width:110px" type="number" step="5000" data-pref="relocateMinPay" value="${s.prefs.relocateMinPay}" aria-label="Pay needed to relocate"></div>
          </div>
          <div class="switch"><div class="txt"><b>Frontend roles</b><span>At most this share of your picks.</span></div><div class="inline-num"><input class="input" type="number" min="0" max="100" data-pref="frontendShare" value="${s.prefs.frontendShare}" aria-label="Frontend percent"><span class="muted">%</span></div></div>
          <div class="switch"><div class="txt"><b>Jobs per company</b><span>At most this many from one company, its closest matches.</span></div><div class="inline-num"><input class="input" type="number" min="1" max="20" data-pref="perCompanyMax" value="${s.prefs.perCompanyMax}" aria-label="Jobs per company"></div></div>
          <div class="switch"><div class="txt"><b>Top picks a day</b><span>Payments first, best paid.</span></div><div class="inline-num"><input class="input" type="number" min="1" max="100" data-s="dailyGoal" value="${s.dailyGoal}" aria-label="Top picks per day"></div></div>
          <div class="switch"><div class="txt"><b>Smaller &amp; local picks a day</b><span>Smaller or lower-paying companies, any industry, Atlanta first.</span></div><div class="inline-num"><input class="input" type="number" min="0" max="20" data-pref="smallerPerDay" value="${s.prefs.smallerPerDay}" aria-label="Smaller picks per day"></div></div>
          <div class="switch"><div class="txt"><b>Ramp-up schedule</b><span>Weeks 1–2: 2 top + 6 smaller. Weeks 3–4: 4 + 4. Then the numbers above.</span></div><label class="toggle"><input type="checkbox" data-pref="rampUp" ${s.prefs.rampUp ? 'checked' : ''}><i></i></label></div>
          <div class="field"><span class="field-label">Dream companies (held back from picks until you're ready)</span>${chipField('prefs.dreamCompanies')}
            <div class="row" style="margin-top:8px"><span class="muted">Add them to picks from plan week</span><input class="input" style="width:70px" type="number" min="1" max="12" data-pref="dreamFromWeek" value="${s.prefs.dreamFromWeek}" aria-label="Week dream companies start"></div>
          </div>
          <div class="switch"><div class="txt"><b>Smaller picks pay under</b><span>Their pay range starts below this.</span></div><div class="inline-num"><span class="muted">$</span><input class="input" style="width:100px" type="number" step="5000" data-pref="smallerMaxPay" value="${s.prefs.smallerMaxPay}" aria-label="Smaller picks pay limit"></div></div>
          <div class="switch"><div class="txt"><b>Hide jobs that don't say which language</b><span>Jobs built on Java, Python, Go and others are always hidden unless they accept any language. Jobs that don't name a language are shown lower down and never in Today's picks.</span></div><label class="toggle"><input type="checkbox" data-pref="hideUnknownLanguage" ${s.prefs.hideUnknownLanguage ? 'checked' : ''}><i></i></label></div>
          <div class="field"><span class="field-label">Never show jobs from</span>${chipField('prefs.excludeCompanies', 'exclude')}</div>
          <div class="switch"><div class="txt"><b>Get everything ready when I open a job</b><span>Fits your résumé, writes the letter, finds people to contact and checks pay. Uses a few cents of OpenAI credit per job you open.</span></div><label class="toggle"><input type="checkbox" data-pref="autoPrepare" ${s.prefs.autoPrepare ? 'checked' : ''}><i></i></label></div>
        </div>
      </section>

      <section class="card card-pad">
        <h2>Alerts</h2>
        
        <div class="stack">
          <div class="switch"><div class="txt"><b>Check every</b><span>Every few minutes is plenty, and polite to the sites.</span></div><div class="inline-num"><input class="input" type="number" min="1" max="1440" data-s="intervalMinutes" value="${s.intervalMinutes}" aria-label="Minutes between checks"><span class="muted">minutes</span></div></div>
          <div class="switch"><div class="txt"><b>Mac notifications</b><span>A pop-up with a sound when a new job matches.</span></div><label class="toggle"><input type="checkbox" data-s="macNotifications" ${s.macNotifications ? 'checked' : ''}><i></i></label></div>
          <label class="field"><span>Phone alerts (optional)</span><input class="input" data-s="ntfyTopic" value="${esc(s.ntfyTopic)}" placeholder="e.g. jobradar-${Math.random().toString(36).slice(2, 10)}"><p class="hint">Install the free <a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a> app, subscribe to a long made-up name, and put the same name here.</p></label>
          <div><button class="btn btn-sm" id="testAlert">Send a test alert</button></div>
        </div>
      </section>

      <section class="card card-pad" id="devices">
        <h2>Use on your laptop</h2>
        ${state.client.remote ? '<p class="hint">You\'re on another device. Change this on your Mac mini.</p>' : `
        <p class="hint">Your Mac mini keeps running Job Radar; your laptop just opens it in a browser. Your progress is the same everywhere.</p>
        <div class="stack">
          <div class="switch"><div class="txt"><b>Allow other devices</b><span>They'll need the access code once.</span></div><label class="toggle"><input type="checkbox" id="remoteOn" ${state.access.enabled ? 'checked' : ''}><i></i></label></div>
          ${state.access.enabled ? `
          <div class="access-code"><span class="muted">Access code</span><b>${esc(state.access.code)}</b><button class="btn btn-sm btn-ghost" id="newCode" title="Signs out every other device">New code</button></div>
          <div class="addr-list">${state.access.urls.map((u) => `<div class="addr"><span class="muted">${esc(u.label)}</span><code>${esc(u.url)}</code><button class="btn btn-sm btn-ghost" data-copy-url="${esc(u.url)}">Copy</button></div>`).join('')}</div>
          <ol class="hint" style="padding-left:18px;margin:0;line-height:1.7">
            <li><b>At home:</b> on your laptop, open the first address and enter the code.</li>
            <li><b>Away from home:</b> use Tailscale (below).</li>
            <li>Keep the Mac mini on with Job Radar running.</li>
          </ol>
          <div class="ts-box" id="tsBox"><span class="spinner"></span> <span class="muted">Checking Tailscale…</span></div>
          <p class="hint"><b>Fast apply</b> and <b>Open in VS Code</b> open windows on the Mac mini, so on the laptop use <i>Open the application</i> and run the practice kit there.</p>` : ''}
        </div>`}
      </section>

      <section class="card card-pad">
        <h2>Your details for application forms</h2>
        <p class="hint">Used to fill in application forms. Stays on this computer.</p>
        <div class="stack">
          <div class="grid-2">${f('firstName', 'Legal first name')}${f('lastName', 'Legal last name')}</div>
          <div class="grid-2">${f('preferredName', 'Name you go by', 'Leave empty to use your first name')}${f('country', 'Country', 'United States')}</div>
          <div class="grid-2">${f('email', 'Email', '', 'email')}${f('phone', 'Phone', '', 'tel')}</div>
          <div class="grid-2">${f('location', 'Where you live', 'e.g. Atlanta, GA')}${f('salary', 'Salary you want', 'e.g. $120,000')}</div>
          <div class="grid-2">${f('linkedin', 'LinkedIn', 'https://linkedin.com/in/…', 'url')}${f('github', 'GitHub', 'https://github.com/…', 'url')}</div>
          <div class="grid-2">${f('website', 'Portfolio / website', 'https://…', 'url')}${f('yearsExperience', 'Years of full-time experience', 'e.g. 3')}</div>
          <div class="grid-2">${f('school', 'School', 'e.g. Kennesaw State University')}${f('degree', 'Degree', "e.g. Bachelor's Degree")}</div>
          <div class="grid-2">${f('discipline', 'Major', 'e.g. Computer Science')}${f('gradYear', 'Graduation year', 'e.g. 2023')}</div>
          <div class="grid-2">
            <label class="field"><span>Allowed to work in the US?</span><select class="input" data-p="workAuthorized">${['Yes', 'No'].map((o) => `<option ${p.workAuthorized === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
            <label class="field"><span>Need visa sponsorship?</span><select class="input" data-p="needsSponsorship">${['No', 'Yes'].map((o) => `<option ${p.needsSponsorship === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
          </div>
        </div>
      </section>
    </div>`;

  wireChips();
  $$('[data-s]').forEach((el) => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
      state.settings[el.dataset.s] = v;
      queueSave({ [el.dataset.s]: v });
    });
  });
  $$('[data-pref]').forEach((el) => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      const v = el.type === 'checkbox' ? el.checked : Number(el.value);
      const [k, sub] = el.dataset.pref.split('.');
      const value = sub ? { ...state.settings.prefs[k], [sub]: v } : v;
      state.settings.prefs[k] = value;
      queueSave({ prefs: { [k]: value } });
    });
  });
  $$('[data-p]').forEach((el) => {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const v = el.value.trim();
      state.settings.profile[el.dataset.p] = v;
      queueSave({ profile: { [el.dataset.p]: v } });
    });
  });
  // Opened from a link like #settings/devices: jump to that card and flash it.
  if (focus && $(`#${CSS.escape(focus)}`)) {
    const card = $(`#${CSS.escape(focus)}`);
    card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    card.classList.add('flash');
  }
  $('#remoteOn')?.addEventListener('change', async (e) => {
    state = { ...state, ...(await api('access', { method: 'PUT', body: { enabled: e.target.checked } })) };
    renderSettings('devices');
  });
  $('#newCode')?.addEventListener('click', async () => {
    if (!confirm('Make a new code? Other devices will need to enter it again.')) return;
    state = { ...state, ...(await api('access', { method: 'PUT', body: { newCode: true } })) };
    renderSettings('devices');
  });
  $$('[data-copy-url]').forEach((b) => b.onclick = () => copy(b.dataset.copyUrl, 'Address copied'));
  if ($('#tsBox')) drawTailscale();
  $('#testAlert').onclick = async () => {
    await flushSettings.flush();
    await api('test-alert', { method: 'POST' });
    toast('Test alert sent. If nothing popped up, allow notifications for "Script Editor" in System Settings → Notifications.', { ms: 9000 });
  };
  $$('[data-o]').forEach((el) => el.addEventListener('input', debounce(() => {
    state.settings.outreach[el.dataset.o] = el.value;
    queueSave({ outreach: { [el.dataset.o]: el.value } });
  }, 400)));
  $('#coverSample').oninput = debounce((e) => api('cover-sample', { method: 'PUT', body: { text: e.target.value } }).then(() => { state.hasCoverSample = !!e.target.value.trim(); }), 500);
  $$('[data-delresume]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this résumé? Applications you already made keep their copy.')) return;
    await api(`resumes/${b.dataset.delresume}`, { method: 'DELETE' });
    await refreshState();
    renderSettings();
  });
  $('#uploadResume').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!state.ai.hasKey) { toast('Save your OpenAI key below first, so the PDF can be read.', { ms: 7000 }); return; }
    const name = prompt('Name this résumé (e.g. "Backend" or "Frontend")', file.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' '));
    if (name === null) return;
    $('#uploadNote').innerHTML = '<span class="spinner"></span> Reading your résumé… about 30 seconds';
    try {
      const { resume } = await api('resumes', { method: 'POST', body: { name, pdfBase64: await fileToBase64(file) } });
      await refreshState();
      location.hash = `resume/${resume.id}`;
      toast('Done. Check that everything came across right.');
    } catch (err) {
      toast(esc(err.message), { error: true, ms: 8000 });
      $('#uploadNote').textContent = '';
    }
  };
  $('#uploadCover').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const { coverSample: text } = await api('resumes', { method: 'POST', body: { kind: 'cover', pdfBase64: await fileToBase64(file) } });
    $('#coverSample').value = text;
    state.hasCoverSample = true;
    toast('Cover letter saved.');
  };
  $('#saveKey').onclick = async () => {
    const key = $('#aiKey').value.trim();
    if (!key) return toast('Paste your key first.');
    $('#saveKey').innerHTML = '<span class="spinner"></span> Checking…';
    try {
      state = { ...state, ...(await api('settings', { method: 'PUT', body: { openaiKey: key } })) };
      toast('Key saved and working.');
      renderSettings();
    } catch (err) {
      toast(esc(err.message), { error: true, ms: 8000 });
      $('#saveKey').textContent = 'Save key';
    }
  };
  if ($('#aiModel')) {
    api('ai/models').then(({ models, current }) => {
      $('#aiModel').innerHTML = models.map((m) => `<option ${m === current ? 'selected' : ''}>${esc(m)}</option>`).join('');
    }).catch(() => {});
    $('#aiModel').onchange = (e) => queueSave({ aiModel: e.target.value });
    api('ai/models').then(({ models }) => {
      const cur = state.ai.modelLight;
      $('#aiModelLight').innerHTML = models.map((m) => `<option ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('');
    }).catch(() => {});
    $('#aiModelLight').onchange = (e) => { state.ai.modelLight = e.target.value; queueSave({ aiModelLight: e.target.value }); };
  }
}

// Tailscale lets the laptop reach this Mac from anywhere.
async function drawTailscale() {
  const box = $('#tsBox');
  let st;
  try { st = await api('tailscale'); } catch { st = { installed: false }; }
  if (!box.isConnected) return;
  if (!st.installed) {
    box.innerHTML = '<b>Tailscale</b> <span class="muted">isn\'t running on this Mac.</span>';
  } else if (st.state === 'Running' && st.ip) {
    box.innerHTML = `<b>Tailscale connected</b><div class="addr-list">${st.urls.map((u) => `<div class="addr"><span class="muted">From anywhere</span><code>${esc(u)}</code><button class="btn btn-sm btn-ghost" data-copy-url="${esc(u)}">Copy</button></div>`).join('')}</div>`;
    $$('[data-copy-url]', box).forEach((b) => b.onclick = () => copy(b.dataset.copyUrl, 'Address copied'));
  } else {
    box.innerHTML = `<b>Tailscale needs signing in</b> <span class="muted">Open the link on any device and sign in.</span>
      <div class="row" style="margin-top:6px">${st.loginUrl ? `<a class="btn btn-sm btn-primary" href="${esc(st.loginUrl)}" target="_blank" rel="noopener">Open sign-in link</a>` : ''}<button class="btn btn-sm" id="tsLink">Get a new link</button></div>`;
    $('#tsLink').onclick = async () => {
      $('#tsLink').innerHTML = '<span class="spinner"></span>';
      const { url } = await api('tailscale/login', { method: 'POST' });
      if (url) { copy(url, 'Sign-in link copied'); window.open(url, '_blank', 'noopener'); }
      drawTailscale();
    };
  }
}

// ---------- Editing a base résumé ----------

async function renderResumeEditor(id) {
  const { resumes } = await api('resumes');
  const r = resumes.find((x) => x.id === id);
  if (!r) { view.innerHTML = '<div class="card empty"><h3>Résumé not found</h3><p><a href="#settings">Back to Settings</a></p></div>'; return; }
  view.innerHTML = `
    <a class="back" href="#settings">${icons.back} Settings</a>
    <div class="page-head"><div class="grow"><input class="input" id="rname" value="${esc(r.name)}" style="font-size:18px;font-weight:600;max-width:420px" aria-label="Résumé name"><p>Click any text to change it. Changes save on their own. <span class="saved-note">Saved ✓</span></p></div></div>
    <div id="paper"></div>`;
  const save = debounce(async () => {
    await api(`resumes/${id}`, { method: 'PUT', body: { data: r.data, name: $('#rname').value.trim() || r.name } });
    $$('.saved-note').forEach((n) => { n.classList.add('show'); setTimeout(() => n.classList.remove('show'), 1500); });
  }, 500);
  mountPaper($('#paper'), r.data, save);
  $('#rname').oninput = async () => { save(); };
  $('#rname').onblur = () => refreshState();
}

// ---------- Routing & live updates ----------

async function route() {
  const [tab, arg] = (location.hash.slice(1) || 'today').split('/');
  const nav = { apply: 'jobs', resume: 'settings' }[tab] || tab;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === nav));
  window.scrollTo(0, 0);
  if (tab === 'apply') return renderApply(view, decodeURIComponent(arg), { state: () => state, refreshState });
  if (tab === 'resume') return renderResumeEditor(arg);
  if (tab === 'applications' || tab === 'tracker') return renderBoard(view, { state: () => state, refreshState });
  if (tab === 'sources') return renderSources();
  if (tab === 'settings') return renderSettings(arg);
  if (tab === 'practice') return renderPractice(view, { state: () => state, refreshState });
  if (tab === 'help') return renderHelp(view, state);
  if (tab === 'jobs') return renderJobs();
  if (tab === 'stats') return renderStats(view);
  if (tab === 'quick') return renderQuick(view, { state: () => state, refreshState });
  return renderToday(view, { state: () => state, refreshState }, arg);
}

$('#checkNow').onclick = async () => {
  await api('check', { method: 'POST' });
  state.status.checking = true;
  renderStatus();
};

let reloadTimer;
function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'new-jobs') {
      const n = e.jobs.length;
      const j = e.jobs[0];
      toast(n === 1
        ? `New job: <b>${esc(j.title)}</b> at ${esc(j.company)}. <a href="#apply/${enc(j.uid)}">Apply now</a>`
        : `<b>${n} new jobs</b> match what you want. <a href="#jobs">See them</a>`, { ms: 15000 });
    }
    if (e.type === 'status' || e.type === 'jobs' || e.type === 'new-jobs') {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        const wasChecking = state?.status.checking;
        await refreshState();
        const tab = location.hash.slice(1) || 'today';
        if (tab === 'jobs' && (e.type !== 'status' || (wasChecking && !state.status.checking))) {
          if (!$('#list')) renderJobs(); else loadList();
        }
      }, 250);
    }
  };
  es.onerror = () => { $('#status').innerHTML = '<span class="dot idle"></span><span>Job Radar isn\'t running. Start it again.</span>'; };
  es.onopen = () => refreshState().catch(() => {});
}

// Light / dark switch. Remembers your choice; otherwise follows your Mac.
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('#themeToggle');
  btn.setAttribute('aria-pressed', String(theme === 'dark'));
  btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}
applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
$('#themeToggle').onclick = () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', next); } catch {}
  applyTheme(next);
};
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  let stored = null;
  try { stored = localStorage.getItem('theme'); } catch {}
  if (!stored) applyTheme(e.matches ? 'dark' : 'light');
});

setInterval(() => state && renderStatus(), 30000);
window.addEventListener('hashchange', route);
wireJobPreviews();
await refreshState();
route();
connect();
