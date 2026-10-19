// A 12-week plan to get interview-ready as a mid-level full-stack engineer
// (React, TypeScript, Node.js, Express, PostgreSQL), with payments in mind.
//
// Every week has: interview problems (LeetCode), practical coding like
// fintech screens use (parsing, small systems), backend/database depth, one
// milestone of a portfolio project, and from week 3 design and mock interviews.

const lc = (slug, title, level = 'Medium') => ({ type: 'leetcode', kind: 'dsa', id: `lc:${slug}`, slug, title, level, url: `https://leetcode.com/problems/${slug}/` });
const task = (kind, id, title, note, url) => ({ type: url ? 'link' : 'task', kind, id: `${kind}:${id}`, title, note, url });

export const PROJECT = {
  name: 'Ledgerly',
  pitch: 'A small payments platform: accounts, money transfers on a double-entry ledger, idempotent API, webhooks, a merchant dashboard. React + TypeScript, Node/Express + TypeScript, PostgreSQL (plain SQL with node-postgres, so you really learn SQL), Redis for queues and caching, Docker, GitHub Actions, deployed.',
  why: 'It builds exactly what payments teams ask about (correct money movement, idempotency, concurrency, webhooks) and gives you new things you can honestly put on your résumé.',
};

// The day-by-day plan lives in plan-data.json: 84 days (12 weeks). Each study
// day has 3 problems, 1 practical exercise, 1 build task, 1 reading and
// applications; every 7th day is a review day.
import fs from 'node:fs';
const DATA = JSON.parse(fs.readFileSync(new URL('./plan-data.json', import.meta.url), 'utf8'));
export const DAYS = DATA.days;
export const WEEKS = DATA.themes.map((theme, i) => ({ n: i + 1, theme, goal: DATA.goals[i], items: DAYS.filter((d) => d.week === i + 1).flatMap((d) => d.blocks.flatMap((b) => b.items)) }));

// Extra practice when an interview shows a weak spot.
export const WEAK_SPOTS = {
  'String parsing': [
    lc('string-to-integer-atoi', 'String to Integer (atoi)'),
    lc('decode-string', 'Decode String'),
    lc('basic-calculator-ii', 'Basic Calculator II'),
    lc('multiply-strings', 'Multiply Strings'),
    lc('simplify-path', 'Simplify Path'),
    lc('compare-version-numbers', 'Compare Version Numbers'),
    lc('restore-ip-addresses', 'Restore IP Addresses'),
    lc('text-justification', 'Text Justification', 'Hard'),
    lc('valid-number', 'Valid Number', 'Hard'),
  ],
  'Time pressure': [
    task('practical', 'timer', 'Five timed mediums', '25 minutes each. Write the plan in comments first, then code. Stop at the bell and note where time went.'),
  ],
  'Dynamic programming': [
    lc('climbing-stairs', 'Climbing Stairs', 'Easy'),
    lc('house-robber', 'House Robber'),
    lc('coin-change', 'Coin Change'),
    lc('longest-common-subsequence', 'Longest Common Subsequence'),
    lc('word-break', 'Word Break'),
  ],
  Graphs: [
    lc('number-of-islands', 'Number of Islands'),
    lc('course-schedule', 'Course Schedule'),
    lc('rotting-oranges', 'Rotting Oranges'),
    lc('network-delay-time', 'Network Delay Time'),
  ],
  'System design': [
    task('design', 'extra-design', 'Two extra designs', 'Design a payment system and a rate limiter again, 35 minutes each, recorded. Watch it back.'),
  ],
  SQL: [
    task('sql', 'extra-sql', '15 more SQL problems', 'Window functions and self-joins from Top SQL 50.', 'https://leetcode.com/studyplan/top-sql-50/'),
  ],
  'Explaining my thinking': [
    task('mock', 'talk', 'Talk-out-loud practice', 'Record yourself solving two problems while explaining. Listen back for silent stretches.'),
  ],
};

// How many applications a day for each stage of the plan.
export const PACE = [
  { until: 3, perDay: 5, note: 'Mostly smaller and mid companies. Their interviews are good practice. Save your top companies for later.' },
  { until: 6, perDay: 8, note: 'Add more mid companies. Interviews from your first applications start around now.' },
  { until: 12, perDay: 12, note: 'Now go after your top companies (Stripe, Ramp, Plaid, Coinbase, Block).' },
];

export const allItems = () => DAYS.flatMap((d) => d.blocks.flatMap((b) => b.items.map((i) => ({ ...i, week: d.week, day: d.day, slot: b.slot }))));
