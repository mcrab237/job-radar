// Help: short and practical.

export function renderHelp(view) {
  view.innerHTML = `
  <div class="help">
    <div class="page-head"><div class="grow"><h1>Help</h1></div></div>

    <section class="card card-pad">
      <h2>Your day</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${[
          ['9:00–9:30', 'Re-solve', 'Problems from 3 and 10 days ago come back automatically'],
          ['9:30–11:30', 'Problems', '3 new LeetCode problems, about 30 minutes each, timed'],
          ['11:45–12:45', 'Practical', 'A practice-kit exercise, CodeSignal Learn, or SQL'],
          ['1:45–2:45', 'Frontend prep', 'JavaScript, React, CSS, accessibility, testing and frontend system design, one hour a day'],
          ['3:00–3:45', 'Apply', 'Today\'s picks; DM only the ones marked DM'],
          ['optional', 'Learn', '30 minutes of reading. One day a week this is a 2-hour backend drill instead'],
        ].map(([t, a, b]) => `<tr style="border-top:1px solid var(--line)"><td style="padding:7px 10px 7px 0;color:var(--muted);white-space:nowrap">${t}</td><td style="padding:7px 10px;font-weight:500">${a}</td><td style="padding:7px 0">${b}</td></tr>`).join('')}
      </table>
      <p class="hint" style="margin-top:8px">About 5 hours. Every 7th day is a review day: redo what was hard, a second mock interview, rest.</p>
    </section>

    <section class="card card-pad">
      <h2>Where you solve things</h2>
      <ul>
        <li><b>LeetCode problems:</b> on leetcode.com (click the title). Pick TypeScript or JavaScript in their editor.</li>
        <li><b>CodeSignal Learn:</b> on codesignal.com, in their editor. Same setup many companies use for online assessments.</li>
        <li><b>Practice kit:</b> in VS Code. Press <i>Open in VS Code</i>, write <code>solution.ts</code>, run <code>npm test &lt;name&gt;</code> in its terminal. Green means done. Lives in <code>~/Projects/interview-practice</code>.</li>
        <li><b>Backend drills:</b> small experiments in your own folder (Postgres in Docker, a tiny Express app). They give you exact answers for "how would you prevent double-spending?"</li>
      </ul>
      <p class="hint" style="margin-top:6px">Tick each task when done. Press <i>Mark hard</i> if you needed help. Every solved problem also comes back automatically after 3 and 10 days.</p>
    </section>

    <section class="card card-pad">
      <h2>Why this gets you hired</h2>
      <ul>
        <li><b>Coding rounds:</b> 216 problems in the order skills build on each other: about 50 easy, 150 medium, 15 hard. Mid-level rounds are mostly mediums.</li>
        <li><b>Online assessments:</b> fintechs often use CodeSignal-style tests: a system built in levels (bank, database) under a timer. The kit drills exactly that, plus lots of string parsing.</li>
        <li><b>Frontend prep:</b> an hour each study day, from JavaScript fundamentals to React, CSS, accessibility, testing and frontend system design.</li>
        <li><b>Backend depth:</b> weekly drills on Postgres locking, isolation, indexes, idempotency and webhooks: what payments teams ask about.</li>
        <li><b>Memory:</b> every problem comes back after 3 and 10 days, so patterns stick.</li>
        <li><b>System design:</b> one timed design a week from week 2, out loud.</li>
        <li><b>Feedback:</b> two mock interviews a week and an interview log that turns each miss into targeted practice.</li>
      </ul>
    </section>

    <section class="card card-pad">
      <h2>Applying while you study</h2>
      <ul>
        <li><b>Weeks 1–2:</b> 8 a day: 2 top picks + 6 smaller companies. Their interviews are practice.</li>
        <li><b>Weeks 3–4:</b> 4 + 4.</li>
        <li><b>Week 5 on:</b> 5 top + 3 smaller, and your dream companies (Stripe, Ramp, Plaid, Coinbase…) join the picks.</li>
        <li><b>DMs:</b> only the 2–3 strongest matches a day, marked <i>Send a DM</i>.</li>
      </ul>
      <p class="hint" style="margin-top:6px">Click a job title (or the page icon) to read the full description right here; ← and → move to the next job. On a job: <i>Apply</i> → fit résumé → cover letter → approve PDFs → <i>Fill in the application</i> → <i>I applied</i> → message someone there.</p>
    </section>
  </div>`;
}
