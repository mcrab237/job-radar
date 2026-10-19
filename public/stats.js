// Stats: your overall numbers, the last 30 days, week by week, and a
// day-by-day history of what you solved and where you applied.
import { esc, enc, api } from '/ui.js';

const keyOf = (d) => d.toLocaleDateString('en-CA');
const addDay = (k) => { const d = new Date(`${k}T12:00:00`); d.setDate(d.getDate() + 1); return keyOf(d); };
const h1 = (m) => Math.round(m / 6) / 10; // minutes -> hours, one decimal
const fmtDay = (k) => new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export async function renderStats(view) {
  view.innerHTML = '<div class="bd-loading"><span class="spinner"></span></div>';
  const [hist, plan] = await Promise.all([api('practice/history'), api('practice')]);
  const days = hist.days;
  const map = Object.fromEntries(days.map((d) => [d.day, d]));
  const s = plan.stats;

  // Streaks over days with any activity.
  const now = new Date();
  const c = new Date(now);
  if (!map[keyOf(c)]) c.setDate(c.getDate() - 1);
  let streak = 0;
  while (map[keyOf(c)]) { streak++; c.setDate(c.getDate() - 1); }
  const best = Math.max(hist.bestStreak, streak);

  const start = plan.state.startedAt ? new Date(plan.state.startedAt) : (days[0] ? new Date(`${days[0].day}T12:00:00`) : now);
  const sinceDays = Math.max(1, Math.floor((now - new Date(start.toDateString())) / 864e5) + 1);
  const totalMin = days.reduce((a, d) => a + d.minutes, 0);
  const anyEst = days.some((d) => d.estimated);
  const applied = hist.pipeline.applied;
  const rate = applied ? Math.round((hist.pipeline.interviews / applied) * 100) : 0;
  const struggled = days.reduce((a, d) => a + d.problems.filter((p) => p.struggled).length, 0);
  const weekAgo = keyOf(new Date(Date.now() - 6 * 864e5));
  const appliedWeek = days.filter((d) => d.day >= weekAgo).reduce((a, d) => a + d.applied.length, 0);

  // Last 30 days, oldest first.
  const last = Array.from({ length: 30 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (29 - i)); return { k: keyOf(d), d, r: map[keyOf(d)] }; });
  const tasksOf = (r) => (r ? Object.values(r.tasks).reduce((a, b) => a + b, 0) - r.tasks.Problems - r.tasks.Apply + r.resolves : 0);
  const max = Math.max(4, ...last.map(({ r }) => (r ? r.problems.length + tasksOf(r) + r.applied.length : 0)));

  // Week by week (plan weeks).
  const weekRows = plan.state.startedAt ? plan.weeks.filter((w) => w.n <= Math.max(1, plan.week)).map((w) => {
    // The week's plan days plus any rest days in between.
    const pk = plan.days.filter((d) => d.week === w.n).map((d) => plan.calendar.dates[d.day - 1]).filter(Boolean);
    const keys = [...pk, ...plan.calendar.rest.filter((k) => k >= pk[0] && k <= addDay(pk.at(-1)))];
    const rs = keys.map((k) => map[k]).filter(Boolean);
    return { n: w.n, theme: w.theme, span: keys.length, active: rs.length, problems: rs.reduce((a, r) => a + r.problems.length, 0), tasks: rs.reduce((a, r) => a + tasksOf(r), 0), applied: rs.reduce((a, r) => a + r.applied.length, 0), min: rs.reduce((a, r) => a + r.minutes, 0), est: rs.some((r) => r.estimated) };
  }).reverse() : [];

  view.innerHTML = `
    <div class="st">
      <div class="page-head"><div class="grow"><h1>Stats</h1><p>${plan.today ? `Day ${plan.today} of ${plan.days.length}` : 'Plan not started'} · since ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p></div><a class="btn" href="#today">Back to today</a></div>

      <div class="st-tiles">
        <div class="card st-tile t-streak ${streak ? 'lit' : ''}"><div class="k">Streak</div><div class="v">${streak}<small> day${streak === 1 ? '' : 's'}</small></div><div class="s">Best: ${best} · ${days.length} of ${sinceDays} days active</div></div>
        <div class="card st-tile t-solved"><div class="k">Problems solved</div><div class="v">${s.solved}<small> / ${s.total}</small></div><div class="s"><span class="lvl lvl-Easy">${s.byLevel.Easy.done} easy</span> · <span class="lvl lvl-Medium">${s.byLevel.Medium.done} medium</span> · <span class="lvl lvl-Hard">${s.byLevel.Hard.done} hard</span>${struggled ? ` · ${struggled} hard for you` : ''}</div></div>
        <div class="card st-tile t-apps"><div class="k">Applications</div><div class="v">${applied}</div><div class="s">${appliedWeek} in the last 7 days · ${hist.pipeline.waiting} waiting</div></div>
        <div class="card st-tile t-rate"><div class="k">Interviews</div><div class="v">${hist.pipeline.interviews}<small> · ${rate}%</small></div><div class="s">${hist.pipeline.offers} offer${hist.pipeline.offers === 1 ? '' : 's'} · ${hist.pipeline.closed} closed</div></div>
        <div class="card st-tile t-time"><div class="k">Time</div><div class="v">${anyEst ? '≈' : ''}${h1(totalMin)}<small> h</small></div><div class="s">${days.length ? `${h1(totalMin / days.length)} h per active day` : 'Nothing yet'}${anyEst ? ' · estimated where not logged' : ''}</div></div>
        <div class="card st-tile t-more"><div class="k">Other work</div><div class="v">${s.resolved}<small> re-solves</small></div><div class="s">${s.practical.done} practicals · ${s.frontend.done + s.prep.done} prep · ${s.drill.done} drills</div></div>
      </div>

      <section class="card st-chart">
        <div class="st-chart-head"><h2>Last 30 days</h2><div class="st-legend"><span><i class="c-prob"></i>Problems</span><span><i class="c-task"></i>Other tasks</span><span><i class="c-app"></i>Applications</span></div></div>
        <div class="st-bars">${last.map(({ k, d, r }) => {
          const p = r?.problems.length || 0, t = tasksOf(r), a = r?.applied.length || 0;
          const tip = `${fmtDay(k)}: ${p} problems, ${t} other tasks, ${a} applications${r ? `, ${r.estimated ? '≈' : ''}${h1(r.minutes)} h` : ''}`;
          return `<a class="st-bar ${k === keyOf(now) ? 'today' : ''}" ${r?.planDay ? `href="#today/${r.planDay}"` : r?.rest ? `href="#today/r-${k}"` : ''} title="${esc(tip)}">
            <span class="stack"><i class="c-app" style="flex:0 0 ${(a / max) * 100}%"></i><i class="c-task" style="flex:0 0 ${(t / max) * 100}%"></i><i class="c-prob" style="flex:0 0 ${(p / max) * 100}%"></i></span>
            <span class="lab">${d.getDate() === 1 || d.getDay() === 1 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span>
          </a>`;
        }).join('')}</div>
      </section>

      ${weekRows.length ? `<section class="card st-weeks">
        <h2>Week by week</h2>
        <table><thead><tr><th>Week</th><th>Days active</th><th>Problems</th><th>Other tasks</th><th>Applications</th><th>Hours</th></tr></thead>
        <tbody>${weekRows.map((w) => `<tr><td><b>Week ${w.n}</b><span>${esc(w.theme)}</span></td><td>${w.active} / ${w.span}</td><td>${w.problems}</td><td>${w.tasks}</td><td>${w.applied}</td><td>${w.est ? '≈' : ''}${h1(w.min)}</td></tr>`).join('')}</tbody></table>
      </section>` : ''}

      <section class="st-history">
        <h2>Day by day</h2>
        ${days.length ? [...days].reverse().map((r) => `
          <details class="card st-day" ${r.day === keyOf(now) || r === days.at(-1) ? 'open' : ''}>
            <summary>
              <span class="when"><b>${fmtDay(r.day)}</b>${r.planDay ? `<span>Day ${r.planDay}</span>` : r.rest ? '<span>Rest day</span>' : ''}</span>
              <span class="chips">
                ${r.problems.length ? `<span class="c c-prob">${r.problems.length} problem${r.problems.length === 1 ? '' : 's'}</span>` : ''}
                ${tasksOf(r) ? `<span class="c c-task">${tasksOf(r)} other task${tasksOf(r) === 1 ? '' : 's'}</span>` : ''}
                ${r.applied.length ? `<span class="c c-app">${r.applied.length} applied</span>` : ''}
                <span class="c">${r.estimated ? '≈' : ''}${h1(r.minutes)} h</span>
              </span>
            </summary>
            <div class="st-day-body">
              ${r.problems.length ? `<div><h3>Solved</h3><ul>${r.problems.map((p) => `<li><span class="lvl lvl-${p.level}">${p.level || ''}</span> ${esc(p.title)}${p.struggled ? ' <span class="hard-tag">hard for you</span>' : ''}</li>`).join('')}</ul></div>` : ''}
              ${r.applied.length ? `<div><h3>Applied</h3><ul>${r.applied.map((a) => `<li><a href="#apply/${enc(a.uid)}">${esc(a.company)}</a> · ${esc(a.title)}${a.status !== 'applied' ? ` <span class="st-status st-${a.status}">${esc({ interview: 'Interviewing', offer: 'Offer', rejected: 'Closed', saved: 'Saved' }[a.status] || a.status)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
              ${r.resolves || tasksOf(r) - r.resolves ? `<div><h3>Also</h3><p>${[r.resolves && `${r.resolves} re-solve${r.resolves === 1 ? '' : 's'}`, r.tasks.Practical && `${r.tasks.Practical} practical`, r.tasks['Interview prep'] && `${r.tasks['Interview prep']} interview prep`, r.tasks['Frontend prep'] && `${r.tasks['Frontend prep']} frontend prep`, r.tasks['Backend drill'] && `${r.tasks['Backend drill']} backend drill`, r.tasks.Learn && `${r.tasks.Learn} learn`].filter(Boolean).join(' · ')}</p></div>` : ''}
              <div class="st-day-foot">${r.estimated ? 'Time is estimated from the tasks and applications. Log time on Today for exact hours.' : `${h1(r.logged)} h logged`}${r.planDay ? ` · <a href="#today/${r.planDay}">Open this day</a>` : r.rest ? ` · <a href="#today/r-${r.day}">Open this day</a>` : ''}</div>
            </div>
          </details>`).join('') : '<div class="card empty"><h3>Nothing yet</h3><p>Tick a task or apply to a job and it shows up here.</p></div>'}
      </section>
    </div>`;
}
