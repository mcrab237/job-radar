// Today: exactly what to do today. Study tasks on the left, jobs to apply to on the right.
import { $, $$, esc, enc, api, toast, copy, icons, avatar, ago, celebrate } from '/ui.js';
import { askRemove } from '/remove.js';

let plan = null;
let ctx = null;
let shownDay = null;
let history = null; // what you did each day (tasks, applications, time)
let restKey = null; // set when showing a rest day (YYYY-MM-DD)
let cal = null; // { dates: [date of each plan day], rest: [rest days] }

const fmtDate = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const shortDate = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
// The date of plan day n. Plan days skip rest days, so use the server's calendar.
export function setCalendar(c) { cal = c; }
export function dateOfDay(startedAt, n) {
  const k = cal?.dates?.[n - 1];
  if (k) return new Date(`${k}T12:00:00`);
  const d = new Date(startedAt);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n - 1);
  return d;
}
const addKey = (k, n) => { const d = new Date(`${k}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

export async function loadPlan() {
  plan = await api('practice');
  cal = plan.calendar;
  return plan;
}

// A rest day: applying is the only required task.
function restDay(key) {
  // A rest day belongs to the week it ends (the plan day before it).
  const before = cal.dates.filter((x) => x < key).length;
  const week = plan.days[Math.max(0, Math.min(plan.days.length, before || 1) - 1)].week;
  return {
    day: null, rest: true, week, review: false,
    blocks: [{ slot: 'Apply', time: '45 min', items: [{ type: 'task', id: `rest:${key}:apply`, title: 'Apply to today\'s picks', note: 'Rest day: just your applications. Send InMails only to the ones marked DM. Everything else waits for tomorrow.' }] }],
  };
}

// Where the ‹ › buttons go from the day you're looking at (a plan day number, or "r-DATE" for a rest day).
function neighbours() {
  if (!cal?.dates?.length) return { prev: shownDay > 1 ? shownDay - 1 : null, next: shownDay < plan.days.length ? shownDay + 1 : null };
  const here = restKey || cal.dates[shownDay - 1];
  const step = (dir) => {
    const k = addKey(here, dir);
    if (cal.rest.includes(k)) return `r-${k}`;
    const i = cal.dates.indexOf(k);
    return i === -1 ? null : i + 1;
  };
  return { prev: step(-1), next: step(1) };
}

export async function renderToday(view, context, dayArg) {
  ctx = context;
  await loadPlan();
  const firstDay = plan.today || 1;
  const todayKey = new Date().toLocaleDateString('en-CA');
  restKey = String(dayArg || '').startsWith('r-') ? String(dayArg).slice(2) : (!dayArg && plan.todayRest ? todayKey : null);
  if (restKey && !cal?.rest?.includes(restKey)) restKey = null;
  shownDay = restKey ? Math.max(1, cal.dates.findIndex((x) => x > restKey) + 1 || plan.days.length) : dayArg ? Math.min(Math.max(1, Number(dayArg)), plan.days.length) : firstDay;
  const [{ jobs }, hist] = await Promise.all([api('jobs?view=picks'), api('practice/history').catch(() => null)]);
  history = hist;
  draw(view, jobs);
}

// Optional blocks (Learn) don't count toward the day's progress.
function itemsOf(day) { return day.blocks.filter((b) => !b.optional).flatMap((b) => b.items); }

// A progress ring for the day.
function ring(done, total) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pctDone = total ? done / total : 0;
  return `<div class="ring" role="img" aria-label="${done} of ${total} done">
    <svg viewBox="0 0 80 80"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#a3e635"/></linearGradient></defs>
      <circle cx="40" cy="40" r="${r}" class="ring-track"/>
      <circle cx="40" cy="40" r="${r}" class="ring-fill" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pctDone)}"/></svg>
    <div class="ring-label"><b>${done === total && total ? '✓' : `${done}/${total}`}</b><span>${done === total && total ? 'Day done' : 'done today'}</span></div>
  </div>`;
}
function doneCount(day) { return itemsOf(day).filter((i) => plan.state.done[i.id]).length; }

function taskRow(i) {
  const d = plan.state.done[i.id];
  const title = i.url
    ? `<a class="task-title" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>`
    : i.type === 'apply' ? `<a class="task-title" href="#jobs">${esc(i.title)}</a>` : `<span class="task-title">${esc(i.title)}</span>`;
  const meta = [];
  if (i.type === 'leetcode') meta.push(`<span class="lvl lvl-${i.level}">${i.level}</span>`, 'LeetCode');
  if (i.type === 'codesignal') meta.push('<span class="where where-cs">CodeSignal</span>', 'opens codesignal.com, solve in their editor');
  if (i.type === 'sql') meta.push(`<span class="where where-sql">SQL</span>`, /pgexercises/.test(i.url || '') ? 'pgexercises.com, solve in the browser' : 'LeetCode, solve in the browser');
  if (i.type === 'kit') meta.push('<span class="where where-kit">Practice kit</span>', `assessment-style drill, ${esc(i.mins)}, solve in VS Code`, `<code class="kit-cmd" data-copy="npm test ${esc(i.kit)}" title="Click to copy">npm test ${esc(i.kit)}</code>`);
  return `
    <div class="task ${d ? 'is-done' : ''}" data-id="${esc(i.id)}">
      <input type="checkbox" class="task-check" ${d ? 'checked' : ''} aria-label="Done: ${esc(i.title)}">
      <div class="task-main">
        ${title}
        ${i.note ? `<div class="task-note">${esc(i.note)}</div>` : ''}
        ${meta.length ? `<div class="task-meta">${meta.join('<span>·</span>')}</div>` : ''}
      </div>
      <div class="task-side">
        ${i.type === 'kit' ? `<button class="btn btn-sm" data-read-kit="${esc(i.kit)}">Read the task</button>` : ''}
        ${i.type === 'kit' && !ctx.state().client?.remote ? `<button class="btn btn-sm" data-open-kit="${esc(i.kit)}">Open in VS Code</button>` : ''}
        ${i.type === 'leetcode' && d ? (d.struggled
          ? `<button class="hard-pill" data-struggle title="Marked hard: it comes back on review day. Click to unmark." aria-label="Unmark hard">Hard <span aria-hidden="true">×</span></button>`
          : '<button class="btn btn-sm btn-ghost" data-struggle title="Needed help? Mark it so it comes back on review day.">Mark hard</button>') : ''}
      </div>
    </div>`;
}

// "Next CodeSignal: Mon, Oct 19" when today's practical is something else.
function nextCodeSignal(day) {
  const isCs = (d) => d.blocks.some((b) => b.slot === 'Practical' && b.items.some((i) => i.type === 'codesignal'));
  if (isCs(day)) return '';
  const next = plan.days.find((d) => d.day > day.day && isCs(d));
  if (!next) return '';
  const when = plan.state.startedAt ? dateOfDay(plan.state.startedAt, next.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : `day ${next.day}`;
  return `<a href="#today/${next.day}" class="next-cs">Next CodeSignal: ${when}</a> · `;
}

// Shows a practice-kit task's instructions in a dialog.
async function readKit(name) {
  const { text } = await api(`practice/kit/${name}`);
  const md = (t) => esc(t)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, code) => `<pre>${code}</pre>`)
    .replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h3>$1</h3>').replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^(\s*)[-*] (.*)$/gm, '$1<li>$2</li>').replace(/^\d+\. (.*)$/gm, '<li>$1</li>')
    .replace(/\n{2,}/g, '<br><br>');
  const d = document.createElement('dialog');
  d.className = 'modal kit-dialog';
  d.innerHTML = `<form method="dialog"><div class="kit-body">${md(text)}</div>
    <p class="hint">Write your answer in <code>exercises/${esc(name)}/solution.ts</code>, then run <code>npm test ${esc(name)}</code>.</p>
    <div class="row"><button class="btn btn-primary" value="close">Got it</button></div></form>`;
  document.body.appendChild(d);
  d.showModal();
  d.addEventListener('close', () => d.remove());
}

const keyOf = (d) => d.toLocaleDateString('en-CA');
const hrs = (m) => (m >= 60 ? `${Math.round(m / 6) / 10}` : m ? `${Math.round(m / 6) / 10}` : '0');

// Days with anything done (a task, a re-solve, logged time or an application).
function activeDays() {
  const map = {};
  for (const d of history?.days || []) map[d.day] = d;
  return map;
}
const workOf = (d) => (d ? d.problems.length + Object.values(d.tasks).reduce((a, b) => a + b, 0) - d.tasks.Problems + d.resolves + d.applied.length : 0);

function currentStreak(map) {
  const d = new Date();
  if (!map[keyOf(d)]) d.setDate(d.getDate() - 1);
  let n = 0;
  while (map[keyOf(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// The summary row: streak, problems, applications and the week, for the day you're viewing.
function summary(s, st, shownDate, weekNo, isToday) {
  const map = activeDays();
  const todayKey = keyOf(new Date());
  const shownKey = shownDate ? keyOf(shownDate) : todayKey;
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return d; });
  const lvl = (n) => (!n ? 0 : n < 3 ? 1 : n < 6 ? 2 : n < 10 ? 3 : 4);
  const streak = currentStreak(map);
  const best = Math.max(history?.bestStreak || 0, streak);
  const goal = st.dailyTarget || st.settings.dailyGoal || 1;
  const pctOf = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const shown = map[shownKey];
  const appliedThatDay = shown?.applied.length || 0;
  const dayLabel = isToday ? 'today' : shownDate ? `on ${shownDate.toLocaleDateString(undefined, { weekday: 'short' })}` : 'today';
  // The plan week of the day you're viewing.
  const planKeys = plan.state.startedAt ? plan.days.filter((d) => d.week === weekNo).map((d) => keyOf(dateOfDay(plan.state.startedAt, d.day))) : [];
  const weekDays = planKeys.length ? [...planKeys, ...(cal?.rest || []).filter((k) => k >= planKeys[0] && k <= addKey(planKeys.at(-1), 1))] : [];
  const wk = weekDays.map((k) => map[k]).filter(Boolean);
  const wkMin = wk.reduce((a, d) => a + d.minutes, 0);
  const wkEst = wk.some((d) => d.estimated);
  const wkProblems = wk.reduce((a, d) => a + d.problems.length, 0);
  const wkApplied = wk.reduce((a, d) => a + d.applied.length, 0);
  const thisWeek = weekDays.includes(todayKey);
  return `
    <section class="tsum">
      <div class="card tsum-streak ${streak ? 'lit' : ''}">
        <div class="ts-top">
          <div class="flame" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2c1.2 3.6 4.8 5.4 4.8 10.2A4.8 4.8 0 0 1 7.2 14.6c0-1.8.7-3.1 1.7-4.1.2 1.9 1.2 2.9 2.4 2.9 0-3.6.7-7.2.7-11.4z"/></svg></div>
          <div><div class="big">${streak}<small> day${streak === 1 ? '' : 's'}</small></div><div class="muted">${streak ? (map[todayKey] ? 'Streak going. Nice.' : 'Do one thing today to keep it') : 'Do one task to start a streak'}</div></div>
          <a class="ts-best" href="#stats"><b>${best}</b><span>best</span></a>
        </div>
        <div class="ts-days" aria-label="Last 14 days">${days.map((d) => { const k = keyOf(d); const n = workOf(map[k]); return `<i class="heat-cell l${lvl(n)} ${k === todayKey ? 'is-today' : ''} ${k === shownKey && k !== todayKey ? 'is-shown' : ''}" title="${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${n} done"></i>`; }).join('')}</div>
        <div class="ts-axis"><span>2 weeks ago</span><a href="#stats">Full history →</a><span>Today</span></div>
      </div>

      <a class="card tsum-tile tile-solved" href="#stats">
        <div class="k">Problems solved</div>
        <div class="v">${s.solved}<small> / ${s.total}</small></div>
        <div class="ts-levels">${['Easy', 'Medium', 'Hard'].map((l) => `<div class="ts-lv"><span class="lvl lvl-${l}">${l[0]}</span><span class="bar"><i class="bar-${l}" style="width:${pctOf(s.byLevel[l].done, s.byLevel[l].total)}%"></i></span><b>${s.byLevel[l].done}</b></div>`).join('')}</div>
      </a>

      <a class="card tsum-tile tile-apps" href="#applications">
        <div class="k">Applied ${dayLabel}</div>
        <div class="v">${isToday ? st.today : appliedThatDay}<small> / ${goal}</small></div>
        <span class="bar"><i style="width:${pctOf(isToday ? st.today : appliedThatDay, goal)}%"></i></span>
        <div class="s">${(!isToday && shown?.applied.length) ? esc(shown.applied.slice(0, 3).map((a) => a.company).join(', ')) + (shown.applied.length > 3 ? '…' : '') : `${st.applied?.week ?? 0} this week · ${st.applied?.total ?? 0} total`}</div>
      </a>

      <a class="card tsum-tile tile-week" href="#stats">
        <div class="k">${thisWeek ? 'This week' : `Week ${weekNo}`}</div>
        <div class="v">${wkEst ? '≈' : ''}${hrs(wkMin)}<small> h</small></div>
        <div class="s">${wkProblems} problem${wkProblems === 1 ? '' : 's'} · ${wkApplied} application${wkApplied === 1 ? '' : 's'}${wkEst ? ' · time estimated from what you did' : ''}</div>
      </a>
    </section>`;
}

function draw(view, picks) {
  const st = ctx.state();
  const day = restKey ? restDay(restKey) : plan.days[shownDay - 1];
  const started = !!plan.state.startedAt;
  const date = restKey ? new Date(`${restKey}T12:00:00`) : started ? dateOfDay(plan.state.startedAt, shownDay) : null;
  const week = plan.weeks[day.week - 1];
  const total = itemsOf(day).length;
  const done = doneCount(day);
  const nb = neighbours();
  const isToday = started && (restKey ? restKey === new Date().toLocaleDateString('en-CA') : plan.today === shownDay && !plan.todayRest);
  const notYet = started && plan.today === 0;
  const s = plan.stats;
  const appliedToday = st.today;

  view.innerHTML = `
    ${!started ? `<div class="banner"><div class="grow"><b>Pick a start day for your 12-week plan.</b> Day 1 is shown below.</div>
      <input class="input" type="date" id="startDate" style="width:150px" value="${new Date(Date.now() + 864e5).toLocaleDateString('en-CA')}" aria-label="Start date">
      <button class="btn btn-primary" id="startBtn">Start</button></div>` : ''}
    ${notYet ? `<div class="banner"><div class="grow">Your plan starts <b>${fmtDate(dateOfDay(plan.state.startedAt, 1))}</b>. Here's day 1.</div></div>` : ''}

    <section class="hero ${done === total && total ? 'complete' : ''}">
      <div class="hero-main">
        <div class="hero-eyebrow">${day.rest ? `Rest day · Week ${day.week}` : `Day ${day.day} of ${plan.days.length} · Week ${day.week}`}</div>
        <h1>${date ? fmtDate(date) : `Day ${day.day}`}</h1>
        <div class="hero-theme">${day.rest ? 'Recharge. Applying is the only must today.' : `${esc(week.theme)}${day.review ? ' · Review day' : ''}`}</div>
        <div class="hero-chips">
          <span class="hchip"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 3 4 4.5 4 8.5A4 4 0 0 1 8 13c0-1.5.6-2.6 1.4-3.4.2 1.6 1 2.4 2 2.4 0-3 .6-6 .6-9z"/></svg>${s.streak}-day streak</span>
          ${started ? `<span class="hchip"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>Ends ${shortDate(dateOfDay(plan.state.startedAt, plan.days.length))} · ${Math.max(0, plan.days.length - Math.max(plan.today, 1) + (plan.today && !plan.todayRest ? 0 : 1))} study days left</span>` : ''}
          <span class="hchip"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-4 3 4 3M16 9l4 3-4 3"/></svg>${s.solved} solved</span>
        </div>
      </div>
      <div class="hero-side">
        ${ring(done, total)}
        <div class="day-nav">
          <button class="btn btn-sm hero-btn btn-icon" data-day="${nb.prev ?? ''}" ${nb.prev ? '' : 'disabled'} aria-label="Previous day">${icons.back}</button>
          ${!isToday && plan.today ? `<button class="btn btn-sm hero-btn" data-day="">Today</button>` : ''}
          <button class="btn btn-sm hero-btn btn-icon" data-day="${nb.next ?? ''}" ${nb.next ? '' : 'disabled'} aria-label="Next day" style="transform:scaleX(-1)">${icons.back}</button>
        </div>
      </div>
    </section>

    ${summary(s, st, date, day.week, isToday || !started)}

    <div class="today-grid">
      <div>
            ${isToday && plan.resolvesDue.length ? `
          <section class="slot">
            <div class="slot-head"><h2><i class="slot-dot slot-resolve"></i>Re-solve</h2><span class="time">${plan.resolvesDue.length > 6 ? `6 of ${plan.resolvesDue.length} due` : `${plan.resolvesDue.length} due`} · ~20 min each${day.rest ? ' · optional today' : ''}</span></div>
            <div class="card">${plan.resolvesDue.slice(0, 6).map((r) => `
              <div class="task" data-resolve="${esc(r.id)}" data-round="${r.round}">
                <input type="checkbox" class="task-check" aria-label="Re-solved: ${esc(r.title)}">
                <div class="task-main">
                  <a class="task-title" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
                  <div class="task-meta"><span class="lvl lvl-${r.level}">${r.level}</span><span>·</span>${r.round === 1 ? '3-day re-solve' : '10-day re-solve'}${r.struggled ? '<span>·</span><span style="color:var(--hard)">marked hard</span>' : ''}</div>
                </div>
              </div>`).join('')}</div>
          </section>` : ''}
        ${day.blocks.map((b) => `
          <section class="slot ${b.optional ? 'is-optional' : ''}">
            <div class="slot-head"><h2><i class="slot-dot slot-${esc(b.slot.toLowerCase())}"></i>${esc(b.slot)}</h2><span class="time">${b.slot === 'Practical' ? nextCodeSignal(day) : ''}${esc(b.time)}</span></div>
            <div class="card">${b.items.map(taskRow).join('')}</div>
          </section>`).join('')}
      </div>

      <aside>
        <section class="card side-card">
          <div class="h"><h2>Apply today</h2><span class="muted">${appliedToday} of ${st.dailyTarget || st.settings.dailyGoal}</span></div>
          ${st.mix?.label ? `<div class="mix-note side">${esc(st.mix.label)}${picks.some((j) => j.dm) ? ' · DM only the ones marked DM' : ''}</div>` : ''}
          ${picks.length ? `<div>${picks.map((j, i) => `${i === 0 ? '<div class="mini-head">Top picks</div>' : ''}${j.track === 'smaller' && picks[i - 1]?.track !== 'smaller' ? '<div class="mini-head smaller">Smaller &amp; local</div>' : ''}
            <div class="mini-row ${j.track === 'smaller' ? 'smaller' : ''}">
            <a class="mini-job ${j.track === 'smaller' ? 'smaller' : ''} ${['applied', 'interview', 'offer'].includes(j.status) ? 'applied' : ''}" href="#apply/${enc(j.uid)}" data-jd="${esc(j.uid)}" title="${j.why ? esc(`Replacement: ${j.why}`) : 'Read the job description'}">
              ${avatar(j.company, j.logo)}
              <div style="min-width:0;flex:1"><div class="t">${j.dm ? '<span class="dm-dot" title="Send a DM">DM</span>' : ''}${j.why ? '<span class="new-dot" title="Replacement for a job you removed">New</span>' : ''}${esc(j.title)}</div><div class="s">${esc(j.company)}${j.fit?.place === 'atlanta' ? ' · Atlanta' : ''}${j.fit?.salary ? ` · $${Math.round(j.fit.salary.min / 1000)}k–$${Math.round(j.fit.salary.max / 1000)}k` : ''}</div></div>
            </a>
            <button class="mini-x" type="button" data-remove="${esc(j.uid)}" title="Remove and get a better one" aria-label="Remove ${esc(j.title)}">${icons.x}</button>
            </div>`).join('')}</div>` : '<div class="body"><p class="hint">No picks right now. <a href="#jobs">See all jobs</a></p></div>'}
        </section>

        <section class="card side-card">
          <div class="h"><h2>Log time</h2></div>
          <div class="body">
            <form id="logForm" class="row" style="flex-wrap:nowrap">
              <input class="input" name="minutes" type="number" min="0" step="15" placeholder="Min" style="width:70px" aria-label="Minutes">
              <input class="input" name="what" placeholder="What did you do?" aria-label="What you practiced">
              <button class="btn" type="submit">Add</button>
            </form>
            <div style="margin-top:8px">${plan.state.log.slice(0, 3).map((l) => `<div class="p-log-row"><span>${esc(l.what || 'Practice')}</span><span class="muted">${l.minutes ? `${l.minutes}m · ` : ''}${ago(l.at)}</span></div>`).join('')}</div>
          </div>
        </section>

        ${s.redo.length ? `<section class="card side-card">
          <div class="h"><h2>Redo</h2><span class="muted">${s.redo.length}</span></div>
          <div class="body">${s.redo.map((id) => { const it = plan.days.flatMap((d) => d.blocks.flatMap((b) => b.items)).find((x) => x.id === id) || Object.values(plan.weakSpots).flat().find((x) => x.id === id); return it ? `<div class="p-log-row redo-row"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a><span class="row" style="gap:4px;flex-wrap:nowrap"><span class="lvl lvl-${it.level}">${it.level || ''}</span><button class="btn btn-sm btn-ghost btn-icon" data-unhard="${esc(id)}" title="Remove from Redo" aria-label="Remove ${esc(it.title)} from Redo">${icons.x}</button></span></div>` : ''; }).join('')}</div>
        </section>` : ''}
      </aside>
    </div>`;

  $$('[data-day]').forEach((b) => b.onclick = () => { location.hash = b.dataset.day ? `today/${b.dataset.day}` : 'today'; });
  $('#startBtn')?.addEventListener('click', async () => {
    plan = await api('practice/start', { method: 'POST', body: { date: $('#startDate').value } });
    toast('Plan started. See you on day 1.');
    shownDay = plan.today || 1;
    draw(view, picks);
  });
  $$('.task[data-id]').forEach((row) => {
    const id = row.dataset.id;
    $('.task-check', row).onchange = async (e) => {
      const before = doneCount(day);
      plan = await api('practice/done', { method: 'PUT', body: { id, done: e.target.checked } });
      draw(view, picks);
      const after = doneCount(restKey ? restDay(restKey) : plan.days[shownDay - 1]);
      if (after === total && before < total) { celebrate(); toast(day.rest ? 'Applications done. Enjoy the rest of your day off.' : `Day ${day.day} done. Nice work.`); }
    };
    $('[data-struggle]', row)?.addEventListener('click', async () => {
      plan = await api('practice/done', { method: 'PUT', body: { id, struggled: !plan.state.done[id]?.struggled } });
      draw(view, picks);
    });
  });
  $$('[data-resolve]').forEach((row) => {
    $('.task-check', row).onchange = async () => {
      plan = await api('practice/resolve', { method: 'PUT', body: { id: row.dataset.resolve, round: Number(row.dataset.round) } });
      toast('Re-solved. It comes back once more later.' );
      draw(view, picks);
    };
  });
  $$('[data-unhard]').forEach((b) => b.onclick = async () => {
    plan = await api('practice/done', { method: 'PUT', body: { id: b.dataset.unhard, struggled: false } });
    draw(view, picks);
  });
  $$('[data-copy]').forEach((c) => c.onclick = () => copy(c.dataset.copy, `Copied: ${c.dataset.copy}`));
  $$('[data-remove]', view).forEach((b) => b.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const j = picks.find((x) => x.uid === b.dataset.remove);
    if (j) askRemove(j, b, () => renderToday(view, ctx, shownDay === (plan.today || 1) ? undefined : shownDay));
  });
  $$('[data-read-kit]').forEach((b) => b.onclick = () => readKit(b.dataset.readKit).catch(() => toast('Couldn\'t load that task.', { error: true })));
  $$('[data-open-kit]').forEach((b) => b.onclick = async () => {
    try {
      await api('practice/open-kit', { method: 'POST', body: { kit: b.dataset.openKit } });
      toast(`Opening ${b.dataset.openKit} in VS Code. In its terminal: <code>npm test ${esc(b.dataset.openKit)}</code>`, { ms: 7000 });
    } catch { toast('Couldn\'t find the practice kit in ~/Projects/interview-practice.', { error: true }); }
  });
  $('#logForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      plan = await api('practice/log', { method: 'POST', body: { minutes: e.target.minutes.value, what: e.target.what.value } });
      draw(view, picks);
    } catch (err) { toast(esc(err.message), { error: true }); }
  };
}

export { shortDate };
