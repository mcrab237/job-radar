// Every place Job Radar can watch. Each source type knows how to fetch its
// jobs and turn them into one common shape:
// { id, title, company, location, remote, url, applyUrl, postedAt, department }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36 JobRadar/1.0';

async function getJson(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) throw Object.assign(new Error('Not found'), { notFound: true });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { html: await res.text(), finalUrl: res.url };
}

const isRemoteText = (s) => /\bremote\b|anywhere|worldwide|distributed/i.test(s || '');
const iso = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const titleCase = (slug) => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function parseWorkday(token) {
  const [tenant, wd, site] = String(token).split('|');
  return { tenant, wd, site, host: `https://${tenant}.${wd}.myworkdayjobs.com` };
}
// "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago"
function workdayDate(text = '') {
  const day = 864e5;
  if (/today/i.test(text)) return new Date().toISOString();
  if (/yesterday/i.test(text)) return new Date(Date.now() - day).toISOString();
  const n = Number((text.match(/(\d+)\+?\s+days?/i) || [])[1]);
  return n ? new Date(Date.now() - n * day).toISOString() : null;
}

// ---------- Company applicant-tracking systems (public, official job-board APIs) ----------

export const TYPES = {
  greenhouse: {
    label: 'Greenhouse',
    boardUrl: (t) => `https://job-boards.greenhouse.io/${t}`,
    async fetch(token) {
      const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`);
      return d.jobs.map((j) => ({
        id: String(j.id),
        title: j.title,
        company: j.company_name || titleCase(token),
        location: j.location?.name || '',
        remote: isRemoteText(j.location?.name),
        url: j.absolute_url,
        applyUrl: `https://job-boards.greenhouse.io/${token}/jobs/${j.id}`,
        postedAt: iso(j.first_published || j.updated_at),
        department: '',
      }));
    },
  },

  lever: {
    label: 'Lever',
    boardUrl: (t) => `https://jobs.lever.co/${t}`,
    async fetch(token) {
      const d = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
      if (!Array.isArray(d)) throw Object.assign(new Error('Not found'), { notFound: true });
      return d.map((j) => ({
        id: j.id,
        title: j.text,
        company: titleCase(token),
        location: j.categories?.allLocations?.join(' · ') || j.categories?.location || '',
        remote: j.workplaceType === 'remote' || isRemoteText(j.categories?.location),
        url: j.hostedUrl,
        applyUrl: j.applyUrl || j.hostedUrl,
        postedAt: iso(j.createdAt),
        department: j.categories?.team || j.categories?.department || '',
        salaryPosted: j.salaryRange?.min && j.salaryRange?.currency === 'USD'
          ? { min: j.salaryRange.interval === 'per-hour-wage' ? j.salaryRange.min * 2080 : j.salaryRange.min, max: j.salaryRange.interval === 'per-hour-wage' ? j.salaryRange.max * 2080 : j.salaryRange.max, source: 'posted' }
          : null,
      }));
    },
  },

  ashby: {
    label: 'Ashby',
    boardUrl: (t) => `https://jobs.ashbyhq.com/${t}`,
    async fetch(token) {
      const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`);
      return (d.jobs || []).filter((j) => j.isListed !== false).map((j) => ({
        id: j.id,
        title: j.title,
        company: titleCase(token),
        location: [j.location, ...(j.secondaryLocations || []).map((s) => s.location)].filter(Boolean).join(' · '),
        remote: j.isRemote === true || j.workplaceType === 'Remote' || isRemoteText(j.location),
        url: j.jobUrl,
        applyUrl: j.applyUrl || j.jobUrl,
        postedAt: iso(j.publishedAt),
        department: j.department || j.team || '',
        salaryText: j.compensation?.compensationTierSummary || j.compensation?.scrapeableCompensationSalarySummary || '',
      }));
    },
  },

  workable: {
    label: 'Workable',
    boardUrl: (t) => `https://apply.workable.com/${t}`,
    async fetch(token) {
      const d = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${token}`);
      return (d.jobs || []).map((j) => ({
        id: j.shortcode,
        title: j.title,
        company: d.name || titleCase(token),
        location: [j.city, j.state, j.country].filter(Boolean).join(', '),
        remote: !!j.telecommuting,
        url: j.url,
        applyUrl: j.application_url || j.url,
        postedAt: iso(j.published_on || j.created_at),
        department: j.department || '',
      }));
    },
  },

  smartrecruiters: {
    label: 'SmartRecruiters',
    boardUrl: (t) => `https://jobs.smartrecruiters.com/${t}`,
    async fetch(token) {
      const out = [];
      for (let offset = 0; offset < 1000; offset += 100) {
        const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100&offset=${offset}`);
        if (offset === 0 && !d.totalFound) throw Object.assign(new Error('Not found'), { notFound: true });
        for (const j of d.content || []) {
          out.push({
            id: j.id,
            title: j.name,
            company: j.company?.name || titleCase(token),
            location: j.location?.fullLocation || [j.location?.city, j.location?.country?.toUpperCase()].filter(Boolean).join(', '),
            remote: !!j.location?.remote,
            url: `https://jobs.smartrecruiters.com/${token}/${j.id}`,
            applyUrl: `https://jobs.smartrecruiters.com/${token}/${j.id}`,
            postedAt: iso(j.releasedDate),
            department: j.department?.label || j.function?.label || '',
          });
        }
        if ((d.content || []).length < 100) break;
      }
      return out;
    },
  },

  recruitee: {
    label: 'Recruitee',
    boardUrl: (t) => `https://${t}.recruitee.com`,
    async fetch(token) {
      const d = await getJson(`https://${token}.recruitee.com/api/offers/`);
      return (d.offers || []).map((j) => ({
        id: String(j.id),
        title: j.title,
        company: j.company_name || titleCase(token),
        location: j.location || [j.city, j.country].filter(Boolean).join(', '),
        remote: !!j.remote || isRemoteText(j.location),
        url: j.careers_url,
        applyUrl: j.careers_apply_url || j.careers_url,
        postedAt: iso(j.published_at || j.created_at),
        department: j.department || '',
      }));
    },
  },

  // Big companies (PayPal, Mastercard, Capital One…) run their career sites on
  // Workday. token = "tenant|wdN|site", e.g. "paypal|wd1|jobs".
  workday: {
    label: 'Workday',
    everyMinutes: 30,
    boardUrl: (t) => { const w = parseWorkday(t); return `${w.host}/${w.site}`; },
    async fetch(token) {
      const w = parseWorkday(token);
      const seen = new Map();
      for (const searchText of ['software engineer', 'full stack', 'frontend', 'backend engineer']) {
        for (let offset = 0; offset < 100; offset += 20) {
          const res = await fetch(`${w.host}/wday/cxs/${w.tenant}/${w.site}/jobs`, {
            method: 'POST',
            headers: { 'user-agent': UA, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText }),
            signal: AbortSignal.timeout(20000),
          });
          if (res.status === 404) throw Object.assign(new Error('Not found'), { notFound: true });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const d = await res.json();
          for (const j of d.jobPostings || []) {
            if (!j.externalPath || seen.has(j.externalPath)) continue;
            seen.set(j.externalPath, {
              id: j.externalPath,
              title: j.title,
              company: '',
              location: j.locationsText || '',
              remote: isRemoteText(j.locationsText) || /remote/i.test(j.remoteType || ''),
              url: `${w.host}/${w.site}${j.externalPath}`,
              applyUrl: `${w.host}/${w.site}${j.externalPath}/apply`,
              postedAt: workdayDate(j.postedOn),
              department: '',
            });
          }
          if ((d.jobPostings || []).length < 20) break;
        }
      }
      return [...seen.values()];
    },
  },

  // ---------- Open job boards with public APIs ----------

  remotive: {
    label: 'Remotive',
    board: true,
    boardUrl: () => 'https://remotive.com/remote-jobs',
    async fetch(search) {
      const q = search ? `?search=${encodeURIComponent(search)}` : '?limit=300';
      const d = await getJson(`https://remotive.com/api/remote-jobs${q}`);
      return (d.jobs || []).map((j) => ({
        id: String(j.id),
        title: j.title,
        company: (j.company_name || '').trim(),
        location: j.candidate_required_location || 'Remote',
        remote: true,
        url: j.url,
        applyUrl: j.url,
        postedAt: iso(j.publication_date),
        department: j.category || '',
        salary: j.salary || '',
      }));
    },
  },

  remoteok: {
    label: 'Remote OK',
    board: true,
    boardUrl: () => 'https://remoteok.com',
    async fetch(search) {
      const tag = search ? `?tags=${encodeURIComponent(search.toLowerCase().replace(/\s+/g, '-'))}` : '';
      const d = await getJson(`https://remoteok.com/api${tag}`);
      return d.filter((j) => j && j.id && j.position).map((j) => ({
        id: String(j.id),
        title: j.position,
        company: j.company || '',
        location: j.location || 'Remote',
        remote: true,
        url: j.url,
        applyUrl: j.apply_url || j.url,
        postedAt: iso(j.epoch || j.date),
        department: (j.tags || []).slice(0, 3).join(', '),
      }));
    },
  },

  arbeitnow: {
    label: 'Arbeitnow',
    board: true,
    boardUrl: () => 'https://www.arbeitnow.com',
    async fetch() {
      const d = await getJson('https://www.arbeitnow.com/api/job-board-api');
      return (d.data || []).map((j) => ({
        id: j.slug,
        title: j.title,
        company: j.company_name || '',
        location: j.location || '',
        remote: !!j.remote,
        url: j.url,
        applyUrl: j.url,
        postedAt: iso(j.created_at),
        department: (j.tags || []).slice(0, 3).join(', '),
      }));
    },
  },

  // ---------- Any careers page: watch it for new job links ----------

  page: {
    label: 'Careers page',
    boardUrl: (url) => url,
    async fetch(url) {
      const { html, finalUrl } = await getText(url);
      return extractJobLinks(html, finalUrl);
    },
  },
};

const JOBISH_HREF = /(job|career|position|opening|vacanc|requisition|gh_jid|posting|role|apply)/i;
const NOT_JOB_TEXT = /^(jobs?|careers?|apply|apply now|see all.*|view all.*|all jobs|open (positions|roles|jobs)|search jobs|learn more|read more|home|about.*|blog|login|log in|sign in|sign up|privacy.*|terms.*|cookie.*|benefits|culture|teams?|life at.*|students?|internships?|get (started|a demo|your free trial)|.*free trial|contact( sales| us)?|pricing|request a demo|book a demo|talk to sales|job alerts?)$/i;

function extractJobLinks(html, baseUrl) {
  const seen = new Map();
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const host = new URL(baseUrl).host;
  let m;
  while ((m = re.exec(html))) {
    let href;
    try { href = new URL(m[1].replace(/&amp;/g, '&'), baseUrl).toString(); } catch { continue; }
    if (!/^https?:/.test(href)) continue;
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (text.length < 6 || text.length > 140 || NOT_JOB_TEXT.test(text)) continue;
    if (!JOBISH_HREF.test(href)) continue;
    if (href.replace(/\/$/, '') === baseUrl.replace(/\/$/, '')) continue;
    if (!seen.has(href)) {
      seen.set(href, {
        id: href,
        title: text,
        company: host.replace(/^www\./, '').split('.')[0].replace(/^\w/, (c) => c.toUpperCase()),
        location: '',
        remote: isRemoteText(text),
        url: href,
        applyUrl: href,
        postedAt: null,
        department: '',
      });
    }
  }
  return [...seen.values()];
}

// ---------- Working out what the person pasted ----------

const URL_PATTERNS = [
  [/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/i, 'greenhouse'],
  [/boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/i, 'greenhouse'],
  [/greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([\w-]+)/i, 'greenhouse'],
  [/jobs(?:\.eu)?\.lever\.co\/([\w.-]+)/i, 'lever'],
  [/jobs\.ashbyhq\.com\/([\w.-]+)/i, 'ashby'],
  [/apply\.workable\.com\/(?!api|j\/)([\w-]+)/i, 'workable'],
  [/(?:jobs|careers)\.smartrecruiters\.com\/([\w-]+)/i, 'smartrecruiters'],
  [/\/\/([\w-]+)\.recruitee\.com/i, 'recruitee'],
  [/([\w-]+\.wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)/i, 'workday'],
];

function matchAts(text) {
  const found = [];
  for (const [re, type] of URL_PATTERNS) {
    const g = new RegExp(re.source, 'gi');
    let m;
    while ((m = g.exec(text))) {
      const token = type === 'workday' ? `${m[1].split('.')[0]}|${m[1].split('.')[1]}|${m[2]}` : m[1].replace(/\.$/, '');
      if (!found.some((f) => f.type === type && f.token.toLowerCase() === token.toLowerCase())) found.push({ type, token });
    }
  }
  return found;
}

async function tryBoard(type, token) {
  try {
    const jobs = await TYPES[type].fetch(token);
    if (!jobs.length && type !== 'greenhouse' && type !== 'lever' && type !== 'ashby') return null;
    return {
      type, token,
      name: jobs[0]?.company && type !== 'lever' && type !== 'ashby' ? jobs[0].company : titleCase(token),
      url: TYPES[type].boardUrl(token),
      jobCount: jobs.length,
      sample: jobs.slice(0, 3).map((j) => j.title),
    };
  } catch {
    return null;
  }
}

// Turns "stripe", "https://jobs.lever.co/netflix" or "https://acme.com/careers"
// into one or more sources the person can add.
export async function detect(input) {
  input = (input || '').trim();
  if (!input) return [];

  if (/^https?:\/\//i.test(input) || /\.[a-z]{2,}(\/|$)/i.test(input)) {
    const url = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const direct = matchAts(url);
    if (direct.length) return (await Promise.all(direct.map((d) => tryBoard(d.type, d.token)))).filter(Boolean);

    // A company's own careers page: look inside it for the hiring system it uses.
    let page;
    try { page = await getText(url); } catch (e) { throw new Error(`Couldn't open that page (${e.message}).`); }
    const embedded = matchAts(page.html + ' ' + page.finalUrl);
    if (embedded.length) {
      const boards = (await Promise.all(embedded.slice(0, 4).map((d) => tryBoard(d.type, d.token)))).filter(Boolean);
      if (boards.length) return boards;
    }
    // No hiring system in the page itself (it may load jobs with JavaScript),
    // so try the company's name from the web address, e.g. about.gitlab.com → gitlab.
    const host = new URL(page.finalUrl).host.replace(/^www\./, '');
    const parts = host.split('.');
    const guess = parts.length > 2 && parts.at(-2).length <= 3 ? parts.at(-3) : parts.at(-2);
    const byName = (await detectByName(guess)).filter((b) => b.jobCount > 0);
    if (byName.length) return byName;

    const links = extractJobLinks(page.html, page.finalUrl);
    return [{
      type: 'page', token: url, name: host, url, jobCount: links.length,
      sample: links.slice(0, 3).map((j) => j.title),
      note: links.length
        ? 'Watching this page for new job links.'
        : 'No job links found yet. This page may load jobs with JavaScript. It will still be watched, but try to find the company\'s Greenhouse/Lever/Ashby link for better results.',
    }];
  }

  return detectByName(input);
}

// A company name: try the common hiring systems in parallel.
async function detectByName(input) {
  const base = input.toLowerCase();
  const slugs = [...new Set([base.replace(/[^a-z0-9]/g, ''), base.replace(/[^a-z0-9]+/g, '-'), base.replace(/[^a-z0-9]+/g, '')])].filter(Boolean);
  const tries = [];
  for (const s of slugs) for (const t of ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee']) tries.push([t, s]);
  tries.push(['smartrecruiters', input.replace(/[^A-Za-z0-9]/g, '')]);
  const results = (await Promise.all(tries.map(([t, s]) => tryBoard(t, s)))).filter(Boolean);
  const unique = [];
  for (const r of results) if (!unique.some((u) => u.type === r.type)) unique.push(r);
  // An empty board next to a busy one is usually an old account the company stopped using.
  const withJobs = unique.filter((r) => r.jobCount > 0);
  return (withJobs.length ? withJobs : unique).sort((a, b) => b.jobCount - a.jobCount);
}

// ---------- Big job sites: no official API, so we build "newest first" searches ----------

export function quickSearches({ keywords = [], locations = [], remoteOnly = false }) {
  const q = encodeURIComponent(keywords[0] || 'software engineer');
  const loc = encodeURIComponent(remoteOnly ? 'Remote' : (locations[0] || 'United States'));
  return [
    { site: 'LinkedIn', hint: 'Posted in the last hour, newest first', url: `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${loc}&f_TPR=r3600&sortBy=DD${remoteOnly ? '&f_WT=2' : ''}` },
    { site: 'LinkedIn Easy Apply', hint: 'Last 24 hours, Easy Apply only', url: `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${loc}&f_TPR=r86400&f_AL=true&sortBy=DD${remoteOnly ? '&f_WT=2' : ''}` },
    { site: 'Indeed', hint: 'Last 24 hours, newest first', url: `https://www.indeed.com/jobs?q=${q}&l=${loc}&fromage=1&sort=date${remoteOnly ? '&remotejob=032b3046-06a3-4876-8dfd-474eb5e7ed11' : ''}` },
    { site: 'Dice', hint: 'Posted today', url: `https://www.dice.com/jobs?q=${q}&location=${loc}&filters.postedDate=ONE${remoteOnly ? '&filters.workplaceTypes=Remote' : ''}` },
    { site: 'Glassdoor', hint: 'Last day', url: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${q}&fromAge=1${remoteOnly ? '&remoteWorkType=1' : ''}` },
    { site: 'ZipRecruiter', hint: 'Last day', url: `https://www.ziprecruiter.com/jobs-search?search=${q}&location=${loc}&days=1` },
    { site: 'Wellfound', hint: 'Startup jobs', url: `https://wellfound.com/jobs?keywords=${q}` },
    { site: 'Hacker News', hint: 'Monthly "Who is hiring?" thread', url: `https://hn.algolia.com/?dateRange=pastMonth&page=0&prefix=false&query=${q}&sort=byDate&type=comment` },
  ];
}
