// Applications: a board of every job you saved or applied to. Drag cards between
// columns (or use the panel), see what's waiting too long, and keep notes,
// next steps and a timeline per job.
import { $, $$, esc, enc, api, ago, avatar, toast, debounce, icons } from '/ui.js';

const COLS = [
  ['saved', 'Saved', 'Ready when you are'],
  ['applied', 'Applied', 'Waiting to hear back'],
  ['interview', 'Interviewing', 'In the process'],
  ['offer', 'Offer', 'Decide and negotiate'],
  ['rejected', 'Closed', 'Ended'],
];
const LABEL = Object.fromEntries(COLS.map(([k, l]) => [k, l]));
const REASONS = ['Rejected', 'No reply', 'Withdrew', 'Position closed'];
const DAY = 864e5;
const money = (n) => `$${Math.round(n / 1000)}k`;
const daysSince = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : null);
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

let jobs = [];
let ctx = null;
let query = '';
let openUid = null;
let dragging = null;
let boardView = null;

// Every move, oldest first. Older jobs (before history was kept) get a best guess.
function historyOf(j) {
  if (j.history?.length) return j.history;
  const h = [{ status: 'saved', at: j.firstSeen }];
  if (j.appliedAt) h.push({ status: 'applied', at: j.appliedAt });
  if (j.status !== 'saved' && j.status !== 'applied') h.push({ status: j.status, at: null });
  return h;
}
const reachedInterview = (j) => ['interview', 'offer'].includes(j.status) || historyOf(j).some((h) => h.status === 'interview' || h.status === 'offer');

// Applied a while ago, no answer, nobody contacted: worth a nudge.
function staleness(j) {
  if (j.status !== 'applied') return null;
  const d = daysSince(j.appliedAt);
  if (d == null || d < 7) return null;
  return { days: d, level: d >= 21 ? 'cold' : d >= 14 ? 'late' : 'nudge' };
}

export async function renderBoard(view, context) {
  ctx = context;
  view.innerHTML = '<div class="bd-loading"><span class="spinner"></span></div>';
  jobs = (await api('jobs?view=pipeline&limit=2000')).jobs;
  draw(view);
}

function stats() {
  const applied = jobs.filter((j) => j.appliedAt);
  const week = applied.filter((j) => Date.now() - Date.parse(j.appliedAt) < 7 * DAY).length;
  const interviews = applied.filter(reachedInterview).length;
  const waiting = jobs.filter((j) => staleness(j)).length;
  // Applications per day, last 14 days (oldest first).
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (13 - i));
    const n = applied.filter((j) => { const t = Date.parse(j.appliedAt); return t >= d.getTime() && t < d.getTime() + DAY; }).length;
    return { d, n };
  });
  return { applied: applied.length, week, interviews, rate: applied.length ? Math.round((interviews / applied.length) * 100) : 0, offers: jobs.filter((j) => j.status === 'offer').length, waiting, days };
}

function statsHtml() {
  const s = stats();
  const max = Math.max(1, ...s.days.map((x) => x.n));
  return `
    <div class="bd-stats">
      <div class="bd-stat bd-stat-main">
        <div class="k">Applied</div><div class="v">${s.applied}</div>
        <div class="spark" aria-label="Applications per day, last 14 days">${s.days.map((x) => `<i style="height:${Math.max(6, (x.n / max) * 100)}%" class="${x.n ? 'on' : ''}" title="${x.d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${x.n}"></i>`).join('')}</div>
        <div class="s">${s.week} in the last 7 days</div>
      </div>
      <div class="bd-stat"><div class="k">Interviews</div><div class="v">${s.interviews}</div><div class="s">${s.rate}% of applications</div></div>
      <div class="bd-stat"><div class="k">Offers</div><div class="v">${s.offers}</div><div class="s">${s.offers ? 'Negotiate before saying yes' : 'Keep going'}</div></div>
      <div class="bd-stat ${s.waiting ? 'warn' : ''}"><div class="k">Waiting 7+ days</div><div class="v">${s.waiting}</div><div class="s">${s.waiting ? 'A short follow-up helps' : 'Nothing overdue'}</div></div>
    </div>`;
}

function cardHtml(j) {
  const f = j.fit || {};
  const st = staleness(j);
  const pay = f.salary ? `${money(f.salary.min)}–${money(f.salary.max)}` : '';
  const chips = [];
  if (j.status === 'saved') chips.push(j.approved ? '<span class="bc ok">PDFs ready</span>' : j.tailored ? '<span class="bc">Résumé started</span>' : '');
  if (j.status === 'applied') chips.push(st ? `<span class="bc ${st.level}">${st.days}d no reply</span>` : `<span class="bc">Applied ${ago(j.appliedAt)}</span>`);
  if (j.status === 'interview') chips.push(`<span class="bc int">Since ${ago(j.interviewAt || j.appliedAt)}</span>`);
  if (j.status === 'rejected' && j.closedReason) chips.push(`<span class="bc">${esc(j.closedReason)}</span>`);
  if (j.reach?.replied) chips.push(`<span class="bc ok">${icons.check} Replied</span>`);
  else if (j.reach?.messaged) chips.push('<span class="bc">InMail sent</span>');
  if (j.closedAt && j.status !== 'rejected') chips.push('<span class="bc late">Listing closed</span>');
  if (j.dream) chips.push('<span class="bc dream">Dream</span>');
  const next = j.next?.text && ['applied', 'interview', 'offer'].includes(j.status) ? `<div class="bk-next">${icons.bolt}<span>${esc(j.next.text)}${j.next.at ? ` · ${esc(fmtDay(j.next.at))}` : ''}</span></div>` : '';
  return `
    <article class="bk ${st ? `stale-${st.level}` : ''}" draggable="true" data-uid="${esc(j.uid)}" tabindex="0" aria-label="${esc(j.title)} at ${esc(j.company)}">
      <div class="bk-top">
        ${avatar(j.company, j.logo)}
        <div class="bk-id"><div class="bk-co">${esc(j.company)}</div>${pay ? `<div class="bk-pay">${pay}${f.salary?.source === 'posted' ? '' : ' est.'}</div>` : ''}</div>
        ${f.score ? `<span class="bk-score" title="Match score">${Math.round(f.score)}</span>` : ''}
      </div>
      <div class="bk-title">${esc(j.title)}</div>
      ${next}
      <div class="bk-chips">${chips.filter(Boolean).join('')}</div>
      ${j.notes ? `<div class="bk-notes">${esc(j.notes.split('\n')[0].slice(0, 90))}</div>` : ''}
    </article>`;
}

const fmtDay = (d) => { const t = new Date(`${d}T12:00:00`); return isNaN(t) ? d : t.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };

function draw(view) {
  const collapsed = store.get('board-closed-collapsed', true);
  const q = query.toLowerCase();
  const shown = jobs.filter((j) => !q || `${j.title} ${j.company}`.toLowerCase().includes(q));
  const order = (k, list) => list.sort((a, b) => {
    if (k === 'applied') return Date.parse(a.appliedAt || 0) - Date.parse(b.appliedAt || 0); // oldest first: they need attention
    if (k === 'interview') return (a.next?.at || '9') .localeCompare(b.next?.at || '9');
    return Date.parse(b.history?.at(-1)?.at || b.appliedAt || b.firstSeen) - Date.parse(a.history?.at(-1)?.at || a.appliedAt || a.firstSeen);
  });
  view.innerHTML = `
    <div class="bd">
      <div class="page-head">
        <div class="grow"><h1>Applications</h1><p>Drag cards between columns, or open one for its stage, notes, next step and timeline.</p></div>
        <label class="search">${icons.search}<input class="input" id="bdSearch" placeholder="Search company or role" value="${esc(query)}" aria-label="Search applications"></label>
        <a class="btn" href="#quick">${icons.plus} Add a job</a>
      </div>
      ${statsHtml()}
      <div class="bd-cols ${collapsed ? 'closed-collapsed' : ''}">
        ${COLS.map(([k, label, sub]) => {
          const items = order(k, shown.filter((j) => j.status === k));
          const isClosed = k === 'rejected';
          return `
            <section class="bd-col col-${k} ${isClosed && collapsed ? 'collapsed' : ''}" data-col="${k}">
              <header>
                <span class="dot"></span><h2>${label}</h2><span class="n">${items.length}</span>
                ${isClosed ? `<button class="btn btn-ghost btn-icon btn-sm" id="toggleClosed" title="${collapsed ? 'Show' : 'Hide'} closed" aria-label="${collapsed ? 'Show' : 'Hide'} closed">${collapsed ? '‹' : '›'}</button>` : ''}
              </header>
              <div class="bd-sub">${sub}</div>
              <div class="bd-list" data-drop="${k}">
                ${items.map(cardHtml).join('') || `<div class="bd-empty">${q ? 'No matches' : { saved: 'Save jobs from the Jobs page', applied: 'Press "I applied" on a job', interview: 'Interviews land here', offer: 'Here\'s hoping', rejected: 'Nothing closed' }[k]}</div>`}
              </div>
            </section>`;
        }).join('')}
      </div>
    </div>`;

  const search = $('#bdSearch');
  search.oninput = debounce(() => { query = search.value; const pos = search.selectionStart; draw(view); const s2 = $('#bdSearch'); s2.focus(); s2.setSelectionRange(pos, pos); }, 120);
  $('#toggleClosed')?.addEventListener('click', () => { store.set('board-closed-collapsed', !collapsed); draw(view); });
  $('.col-rejected.collapsed')?.addEventListener('click', (e) => { if (!e.target.closest('.bk')) { store.set('board-closed-collapsed', false); draw(view); } });

  // Drag and drop between columns.
  boardView = view;
  $$('.bk', view).forEach(wireCard);
  $$('.bd-col', view).forEach((col) => {
    col.addEventListener('dragover', (e) => { if (!dragging) return; e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const uid = dragging || e.dataTransfer.getData('text/plain'); dragging = null;
      if (uid) await move(uid, col.dataset.col, view);
    });
  });
  // On a phone, columns scroll sideways: start at the first one with cards.
  const cols = $('.bd-cols', view);
  if (cols.scrollWidth > cols.clientWidth + 10 && !cols.dataset.placed) {
    const first = $$('.bd-col', view).find((c) => $('.bk', c));
    if (first) cols.scrollLeft = first.offsetLeft - cols.offsetLeft;
  }
  if (openUid) openPanel(openUid, view, { keep: true });
}

async function move(uid, status, view, extra = {}) {
  const j = jobs.find((x) => x.uid === uid);
  if (!j || (j.status === status && !Object.keys(extra).length)) return;
  const prev = j.status;
  try {
    const { job } = await api(`jobs/${enc(uid)}`, { method: 'PATCH', body: { status, ...extra } });
    Object.assign(j, { status: job.status, appliedAt: job.appliedAt, interviewAt: job.interviewAt, history: job.history, closedReason: job.closedReason });
  } catch (e) { toast(esc(e.message), { error: true }); return; }
  if (status === 'new') jobs = jobs.filter((x) => x.uid !== uid);
  ctx.refreshState();
  draw(view);
  if (prev !== status && status !== 'new') {
    const t = toast(`Moved to <b>${LABEL[status]}</b>. <a href="#" data-undo>Undo</a>${status === 'interview' ? ' · Log it on the Practice page after.' : ''}`, { ms: 6000 });
    $('[data-undo]', t)?.addEventListener('click', async (e) => { e.preventDefault(); t.remove(); await undo(uid, view); });
  }
  if (status === 'offer') celebrateOffer();
}

async function undo(uid, view) {
  const j = jobs.find((x) => x.uid === uid);
  try {
    const { job } = await api(`jobs/${enc(uid)}`, { method: 'PATCH', body: { undo: true } });
    Object.assign(j, { status: job.status, appliedAt: job.appliedAt, interviewAt: job.interviewAt, history: job.history, closedReason: job.closedReason });
  } catch (e) { toast(esc(e.message), { error: true }); return; }
  ctx.refreshState();
  draw(view);
}

function celebrateOffer() {
  import('/ui.js').then((m) => m.celebrate?.()).catch(() => {});
}

function wireCard(card) {
  card.addEventListener('dragstart', (e) => { dragging = card.dataset.uid; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragging); });
  card.addEventListener('dragend', () => { card.classList.remove('dragging'); $$('.bd-col.over').forEach((c) => c.classList.remove('over')); });
  card.addEventListener('click', () => openPanel(card.dataset.uid, boardView));
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel(card.dataset.uid, boardView); } });
}

// ---------- The detail panel ----------

function timelineHtml(j) {
  const items = historyOf(j).map((h) => ({ at: h.at, text: { saved: 'Saved', applied: 'Applied', interview: 'Moved to interviewing', offer: 'Got an offer', rejected: `Closed${j.closedReason && h === historyOf(j).at(-1) ? `: ${j.closedReason}` : ''}`, new: 'Removed' }[h.status] || h.status, kind: h.status }));
  if (j.reach?.messaged) items.push({ at: null, text: `Messaged ${j.reach.messaged} ${j.reach.messaged === 1 ? 'person' : 'people'}${j.reach.replied ? `, ${j.reach.replied} replied` : ''}`, kind: 'reach' });
  if (j.closedAt) items.push({ at: j.closedAt, text: 'The listing came down', kind: 'closed' });
  items.sort((a, b) => (a.at ? Date.parse(a.at) : Infinity) - (b.at ? Date.parse(b.at) : Infinity));
  return `<ol class="tl">${items.map((x) => `<li class="tl-${x.kind}"><span class="tl-dot"></span><span class="tl-text">${esc(x.text)}</span><span class="tl-when">${x.at ? new Date(x.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span></li>`).join('')}</ol>`;
}

function nextHint(j) {
  const st = staleness(j);
  if (j.status === 'saved') return j.approved ? 'Your PDFs are ready. Fill in the application.' : 'Open it to fit your résumé and apply.';
  if (st && !j.reach?.messaged) return `${st.days} days with no reply. Send a short InMail to someone on the team.`;
  if (st) return `${st.days} days with no reply. If nothing by day 21, move it to Closed (No reply).`;
  if (j.status === 'applied') return 'Most replies come within two weeks.';
  if (j.status === 'interview') return 'Add the next round below. After each round, log it on the Practice page.';
  if (j.status === 'offer') return 'Ask for the offer in writing and take a day before answering. Check pay with "Check salary sites" on the job page.';
  return '';
}

function openPanel(uid, view, { keep = false } = {}) {
  const j = jobs.find((x) => x.uid === uid);
  if (!j) { openUid = null; return; }
  openUid = uid;
  $('.bd-panel')?.remove();
  $('.bd-scrim')?.remove();
  const f = j.fit || {};
  const scrim = document.createElement('div');
  scrim.className = 'bd-scrim';
  const p = document.createElement('aside');
  p.className = `bd-panel ${keep ? 'no-anim' : ''}`;
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', `${j.title} at ${j.company}`);
  p.innerHTML = `
    <header class="bp-head">
      ${avatar(j.company, j.logo)}
      <div class="grow"><h2>${esc(j.title)}</h2><div class="sub">${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ''}${f.salary ? ` · ${money(f.salary.min)}–${money(f.salary.max)}` : ''}</div></div>
      <button class="btn btn-ghost btn-icon" data-close aria-label="Close">${icons.x}</button>
    </header>
    <div class="bp-links">
      <a class="btn btn-sm btn-primary" href="#apply/${enc(j.uid)}">Open job page</a>
      ${j.url ? `<a class="btn btn-sm" href="${esc(j.url)}" target="_blank" rel="noopener">Posting ${icons.ext}</a>` : ''}
      <button class="btn btn-sm" type="button" data-jd="${esc(j.uid)}">${icons.doc} Description</button>
    </div>
    <div class="bp-body">
      <section>
        <h3>Stage</h3>
        <div class="bp-stages">${COLS.map(([k, l]) => `<button type="button" data-stage="${k}" class="${j.status === k ? 'on' : ''} st-${k}">${l}</button>`).join('')}</div>
        ${j.status === 'rejected' ? `<div class="bp-reasons">${REASONS.map((r) => `<button type="button" class="ask-chip ${j.closedReason === r ? 'on' : ''}" data-reason="${r}">${r}</button>`).join('')}</div>` : ''}
        ${nextHint(j) ? `<p class="bp-hint">${nextHint(j)}</p>` : ''}
      </section>
      ${['applied', 'interview', 'offer'].includes(j.status) ? `
      <section>
        <h3>Next step</h3>
        <div class="bp-next">
          <input class="input" id="nextText" placeholder="${j.status === 'interview' ? 'e.g. Technical screen with Ryan' : 'e.g. Follow up with the recruiter'}" value="${esc(j.next?.text || '')}">
          <input class="input" id="nextAt" type="date" value="${esc(j.next?.at || '')}">
        </div>
      </section>` : ''}
      <section>
        <h3>Notes</h3>
        <textarea class="textarea" id="bpNotes" placeholder="Who you talked to, what they asked, salary range, anything to remember">${esc(j.notes || '')}</textarea>
        <div class="hint" id="bpSaved"></div>
      </section>
      <section>
        <h3>Timeline</h3>
        ${timelineHtml(j)}
      </section>
    </div>
    <footer class="bp-foot"><button class="btn btn-sm btn-ghost btn-danger" data-remove>Remove from board</button></footer>`;
  document.body.append(scrim, p);
  const close = () => { openUid = null; p.classList.add('leaving'); scrim.remove(); setTimeout(() => p.remove(), 160); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) close(); };
  document.addEventListener('keydown', onKey);
  scrim.onclick = close;
  $('[data-close]', p).onclick = close;
  $$('a[href^="#apply"]', p).forEach((a) => a.addEventListener('click', close));
  $$('[data-stage]', p).forEach((b) => b.onclick = () => move(uid, b.dataset.stage, view));
  $$('[data-reason]', p).forEach((b) => b.onclick = () => move(uid, 'rejected', view, { closedReason: b.dataset.reason }));
  $('[data-remove]', p).onclick = async () => {
    if (!confirm('Take this job off your board? It goes back to the Jobs list.')) return;
    close();
    await move(uid, 'new', view);
  };
  const saved = () => { $('#bpSaved', p).textContent = 'Saved'; setTimeout(() => { const el = $('#bpSaved', p); if (el) el.textContent = ''; }, 1500); };
  $('#bpNotes', p).oninput = debounce(async (e) => { j.notes = e.target.value; await api(`jobs/${enc(uid)}`, { method: 'PATCH', body: { notes: j.notes } }); saved(); refreshCard(uid); }, 500);
  const saveNext = debounce(async () => {
    j.next = { text: $('#nextText', p).value.trim(), at: $('#nextAt', p).value };
    await api(`jobs/${enc(uid)}`, { method: 'PATCH', body: { next: j.next } });
    saved(); refreshCard(uid);
  }, 500);
  $('#nextText', p)?.addEventListener('input', saveNext);
  $('#nextAt', p)?.addEventListener('change', saveNext);
}

// Redraws one card in place (after notes or next step change).
function refreshCard(uid) {
  const j = jobs.find((x) => x.uid === uid);
  const el = document.querySelector(`.bk[data-uid="${CSS.escape(uid)}"]`);
  if (!j || !el) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = cardHtml(j).trim();
  const fresh = tmp.firstChild;
  el.replaceWith(fresh);
  wireCard(fresh);
}
