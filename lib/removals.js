// Jobs you removed, and what they teach: when you remove a job with a reason,
// similar jobs rank lower from then on, and today's slot gets a better one.

export const REASONS = {
  stack: 'Not my stack',
  senior: 'Too senior',
  pay: 'Pay too low',
  place: 'Wrong location',
  company: 'Not this company',
  meh: 'Not interested',
};

const LEVEL_RANK = { entry: 0, mid: 1, senior: 2, lead: 3 };
const STOP = new Set(['software', 'engineer', 'engineering', 'senior', 'junior', 'staff', 'the', 'and', 'of', 'for', 'ii', 'iii', 'i', 'iv', 'sr', 'jr', 'remote', 'us', 'team', 'developer', 'full', 'stack', 'fullstack', 'full-stack', 'platform', 'platforms', 'product', 'products', 'systems', 'system', 'services', 'service', 'core', 'projects', 'project', 'strategic', 'general', 'application', 'applications', 'web', 'new', 'grad', 'experience', 'level', 'hq', 'san', 'francisco', 'york']);
const words = (t) => new Set(String(t || '').toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 2 && !STOP.has(w)));
const overlap = (a, b) => [...a].filter((w) => b.has(w)).length;

// What we keep about a removed job, so its lesson survives even after the job is gone.
export function snapshot(job) {
  const f = job.fit || {};
  return {
    title: job.title, company: job.company, location: job.location || '',
    level: f.level || null, years: f.years ?? null, lang: f.lang || null,
    payMax: f.salary?.max || null, place: f.place || null,
  };
}

// How much less a job should rank, given what you've removed (0 to 30).
export function penalty(job, removed) {
  const f = job.fit || {};
  const tw = words(job.title);
  let p = 0;
  for (const r of removed) {
    const s = r.snap || {};
    switch (r.reason) {
      case 'senior':
        if ((LEVEL_RANK[f.level] ?? 1) >= (LEVEL_RANK[s.level] ?? 1) && (f.years ?? 0) >= (s.years ?? 99)) p += 8;
        else if ((f.years ?? 0) >= (s.years ?? 99)) p += 4;
        break;
      case 'stack':
        if (f.lang && f.lang === s.lang && f.lang !== 'js') p += 8;
        if (overlap(tw, words(s.title)) >= 2) p += 6;
        break;
      case 'pay':
        if (f.salary?.max && s.payMax && f.salary.max <= s.payMax) p += 8;
        break;
      case 'place':
        if (s.location && job.location && job.location === s.location) p += 10;
        else if (f.place && f.place === s.place) p += 3;
        break;
      case 'meh':
        if (overlap(tw, words(s.title)) >= 2) p += 5;
        if (job.company === s.company) p += 6;
        break;
      default:
    }
  }
  return Math.min(30, p);
}

// The removals worth learning from: the last 60 days, newest 40.
export function recentRemovals(db) {
  const cutoff = Date.now() - 60 * 864e5;
  return Object.values(db.jobs)
    .filter((j) => j.removed?.at && Date.parse(j.removed.at) > cutoff)
    .sort((a, b) => Date.parse(b.removed.at) - Date.parse(a.removed.at))
    .slice(0, 40)
    .map((j) => ({ reason: j.removed.reason, note: j.removed.note || '', snap: j.removed.snap || snapshot(j) }));
}

// Copies of the jobs with scores lowered by what you've removed. Use the copies
// only to choose; show the originals.
export function adjusted(jobs, removed) {
  if (!removed.length) return jobs;
  return jobs.map((j) => {
    const p = penalty(j, removed);
    return p ? { ...j, fit: { ...j.fit, score: j.fit.score - p } } : j;
  });
}
