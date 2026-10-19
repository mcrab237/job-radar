// Practice: the whole 12-week plan at a glance, plus interviews and weak spots.
import { $, $$, esc, api, toast, icons } from '/ui.js';
import { dateOfDay, shortDate, setCalendar } from '/today.js';

let data = null;
let openWeek = null;

const STAGES = ['Recruiter call', 'Online assessment', 'Coding', 'Practical / take-home', 'System design', 'Behavioral', 'Onsite / final'];
const RESULTS = ['Waiting', 'Passed', 'Didn\'t pass', 'Offer'];

export async function renderPractice(view) {
  data = await api('practice');
  setCalendar(data.calendar);
  if (openWeek == null) openWeek = data.week;
  draw(view);
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const bar = (a, b) => `<span class="bar"><i style="width:${pct(a, b)}%"></i></span>`;
const itemsOf = (d) => d.blocks.filter((b) => !b.optional).flatMap((b) => b.items);
const doneOf = (items) => items.filter((i) => data.state.done[i.id]).length;

function weekRows() {
  const started = !!data.state.startedAt;
  return data.weeks.map((w) => {
    const days = data.days.filter((d) => d.week === w.n);
    const items = days.flatMap(itemsOf);
    const done = doneOf(items);
    const first = started ? shortDate(dateOfDay(data.state.startedAt, days[0].day)) : '';
    const last = started ? shortDate(dateOfDay(data.state.startedAt, days.at(-1).day)) : '';
    const open = openWeek === w.n;
    return `
      <div class="week-row ${data.today && data.week === w.n ? 'current' : ''}" data-week="${w.n}">
        <span class="wk">Week ${w.n}</span>
        <span class="th">${esc(w.theme)}</span>
        <span class="dt">${started ? `${first} – ${last}` : ''}</span>
        <span class="pr">${bar(done, items.length)}${done}/${items.length}</span>
        <span class="muted" style="transform:rotate(${open ? 90 : 180}deg);display:inline-flex">${icons.back}</span>
      </div>
      ${open ? `<div class="week-days">
        <p class="hint" style="margin:6px 8px 4px">${esc(w.goal)}</p>
        ${days.map((d) => {
          const it = itemsOf(d);
          const dn = doneOf(it);
          const label = d.review ? 'Review day' : it.filter((i) => i.type === 'leetcode').map((i) => i.title).join(', ');
          return `<a class="day-link" href="#today/${d.day}">
            <span class="d">Day ${d.day}</span>
            <span class="muted">${started ? dateOfDay(data.state.startedAt, d.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : ''}</span>
            <span class="m">${esc(label)}</span>
            ${bar(dn, it.length)}
          </a>`;
        }).join('')}
      </div>` : ''}`;
  }).join('');
}

function draw(view) {
  const s = data.stats;
  const weakItems = data.weak.flatMap((k) => (data.weakSpots[k] || []).map((i) => ({ ...i, spot: k })));

  view.innerHTML = `
    <div class="page-head">
      <div class="grow"><h1>Practice</h1><p>${data.state.startedAt ? (data.todayRest ? `Rest day today · day ${data.today} of ${data.days.length} is next` : data.today ? `Day ${data.today} of ${data.days.length}` : `Starts ${shortDate(dateOfDay(data.state.startedAt, 1))}`) : 'Not started'} · ${data.pace.perDay} applications a day this stage</p></div>
      <a class="btn btn-primary" href="#today">Open today</a>
    </div>

    <section class="card solved">
      <div><div class="big">${s.solved}<small> / ${s.total}</small></div><div class="muted" style="margin-top:4px">problems solved</div></div>
      <div class="lvl-bars">${['Easy', 'Medium', 'Hard'].map((l) => `
        <div class="lvl-bar ${l}"><span class="lvl lvl-${l}">${l}</span>${bar(s.byLevel[l].done, s.byLevel[l].total)}<span class="n">${s.byLevel[l].done}/${s.byLevel[l].total}</span></div>`).join('')}
      </div>
    </section>

    <section class="card heat-card">
      <div class="heat-head"><h2>Consistency</h2><span class="muted">${data.state.startedAt ? 'Each square is a day. Click one to open it.' : ''}</span></div>
      <div class="heat-wrap">
        <div class="heat-days"><span>Day 1</span><span></span><span></span><span>Day 4</span><span></span><span></span><span>Review</span></div>
        <div class="heat">${data.weeks.map((w) => `<div class="heat-col"><span class="heat-wk">W${w.n}</span>${data.days.filter((d) => d.week === w.n).map((d) => {
          const it = itemsOf(d);
          const f = it.length ? doneOf(it) / it.length : 0;
          const lvl = f === 0 ? 0 : f < 0.34 ? 1 : f < 0.67 ? 2 : f < 1 ? 3 : 4;
          const date = data.state.startedAt ? dateOfDay(data.state.startedAt, d.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : `Day ${d.day}`;
          return `<a class="heat-cell l${lvl} ${data.today === d.day ? 'is-today' : ''}" href="#today/${d.day}" title="${date}: ${doneOf(it)}/${it.length} done"></a>`;
        }).join('')}</div>`).join('')}</div>
        <div class="heat-legend"><span>Less</span><i class="heat-cell l0"></i><i class="heat-cell l1"></i><i class="heat-cell l2"></i><i class="heat-cell l3"></i><i class="heat-cell l4"></i><span>More</span></div>
      </div>
    </section>

    <div class="kpis">
      <div class="card kpi"><div class="v">${s.practical.done}<small> / ${s.practical.total}</small></div><div class="l">Practical exercises</div></div>
      <div class="card kpi"><div class="v">${s.frontend.done}<small> / ${s.frontend.total}</small></div><div class="l">Frontend prep</div></div>
      <div class="card kpi"><div class="v">${s.drill.done}<small> / ${s.drill.total}</small></div><div class="l">Backend drills · ${s.resolved} re-solves</div></div>
      <div class="card kpi"><div class="v">${s.streak}<small> day${s.streak === 1 ? '' : 's'}</small></div><div class="l">Streak · ${s.hoursThisWeek} h this week</div></div>
    </div>

    <section>
      <div class="slot-head"><h2>12 weeks</h2></div>
      <div class="card weeks">${weekRows()}</div>
    </section>

    <div class="two">
      <section class="card side-card">
        <div class="h"><h2>Interviews</h2><button class="btn btn-sm" id="addIv">${icons.plus} Add</button></div>
        <div class="body">
          <form id="ivForm" class="stack" style="gap:8px;margin-bottom:10px" hidden>
            <div class="row"><input class="input" name="company" placeholder="Company" style="flex:1"><input class="input" name="date" type="date" style="width:150px" aria-label="Date"></div>
            <div class="row"><select class="input" name="stage" style="flex:1" aria-label="Stage">${STAGES.map((x) => `<option>${x}</option>`).join('')}</select><select class="input" name="result" style="flex:1" aria-label="Result">${RESULTS.map((x) => `<option>${x}</option>`).join('')}</select></div>
            <textarea class="textarea" name="notes" placeholder="What tripped you up?" style="min-height:56px"></textarea>
            <div class="weak-pick">${Object.keys(data.weakSpots).map((k) => `<label class="chip-check"><input type="checkbox" value="${esc(k)}"> ${esc(k)}</label>`).join('')}</div>
            <div><button class="btn btn-primary btn-sm" type="submit">Save</button></div>
          </form>
          ${data.state.interviews.map((i) => `
            <div class="iv" data-iv="${i.id}">
              <div class="row" style="justify-content:space-between"><b>${esc(i.company)}</b><span class="muted">${esc(i.date || '')}</span></div>
              <div class="muted">${esc(i.stage)} · ${esc(i.result)}${i.weak?.length ? ` · ${i.weak.map(esc).join(', ')}` : ''}</div>
              ${i.notes ? `<div style="margin-top:3px">${esc(i.notes)}</div>` : ''}
              <button class="btn btn-sm btn-ghost" data-del style="margin-top:4px;margin-left:-8px">Remove</button>
            </div>`).join('') || '<p class="hint">No interviews logged yet.</p>'}
        </div>
      </section>

      <section class="card side-card">
        <div class="h"><h2>Extra practice for weak spots</h2><span class="muted">${weakItems.length}</span></div>
        <div class="body">${weakItems.length ? weakItems.map((i) => `
          <div class="task" data-id="${esc(i.id)}" style="padding:8px 0">
            <input type="checkbox" class="task-check" ${data.state.done[i.id] ? 'checked' : ''} aria-label="Done: ${esc(i.title)}">
            <div class="task-main">${i.url ? `<a class="task-title" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>` : `<span class="task-title">${esc(i.title)}</span>`}
              <div class="task-meta">${i.level ? `<span class="lvl lvl-${i.level}">${i.level}</span><span>·</span>` : ''}${esc(i.spot)}</div></div>
          </div>`).join('') : '<p class="hint">Log an interview and tick what tripped you up. Matching practice shows up here.</p>'}</div>
      </section>
    </div>`;

  $$('[data-week]').forEach((r) => r.onclick = () => { openWeek = openWeek === Number(r.dataset.week) ? null : Number(r.dataset.week); draw(view); });
  $('#addIv').onclick = () => { $('#ivForm').hidden = !$('#ivForm').hidden; };
  $('#ivForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      data = await api('practice/interviews', { method: 'POST', body: { company: f.company.value, date: f.date.value, stage: f.stage.value, result: f.result.value, notes: f.notes.value, weak: $$('.weak-pick input:checked', f).map((c) => c.value) } });
      draw(view);
    } catch (err) { toast(esc(err.message), { error: true }); }
  };
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    await api(`practice/interviews/${b.closest('[data-iv]').dataset.iv}`, { method: 'DELETE' });
    data = await api('practice');
    setCalendar(data.calendar);
    draw(view);
  });
  $$('.task[data-id] .task-check').forEach((c) => c.onchange = async (e) => {
    data = await api('practice/done', { method: 'PUT', body: { id: c.closest('[data-id]').dataset.id, done: e.target.checked } });
    draw(view);
  });
}
