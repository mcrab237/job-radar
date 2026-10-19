// How well a job fits you: its level, field, pay, place and skills.
// Everything here runs without AI, from the job's title, location and description.

export const DEFAULT_PREFS = {
  mix: { entry: 25, mid: 70, senior: 5 },   // share of daily picks: entry, mid, stretch (4 years asked) (%)
  maxYears: 4,                                // never show jobs asking for more years than this
  hideUnknownLanguage: false,
  allowSeniorTitles: false,                   // senior-level titles are hidden while you're building up
  smallerPerDay: 3,                           // extra daily picks from smaller / lower-paying companies
  rampUp: true,                               // weeks 1-2: 2 top + 6 smaller; weeks 3-4: 4 + 4; then your numbers
  dreamCompanies: [],                         // e.g. ['Stripe', 'Ramp']: set yours in Settings
  dreamFromWeek: 5,                           // dream companies stay out of picks until this plan week
  smallerMaxPay: 150000,                      // their pay range should start under this                 // hide jobs that don't say which language (they're never in picks)
  frontendShare: 15,                          // at most this % of picks can be frontend roles
  salaryMin: 80000,
  salaryMax: 200000,
  remote: true,                               // US remote
  atlanta: false,                             // the "local" track: Atlanta jobs (change ATL below for your city)
  relocate: [],                               // e.g. ['New York', 'California']: only when the pay is high
  relocateMinPay: 170000,
  excludeCompanies: [],
  perCompanyMax: 5,
  autoPrepare: true,                          // open a job → résumé, letter, people, pay are made for you
};

// ---------- Is it a software role you'd do? ----------

const ROLE = /\b(software|full[- ]?stack|back[- ]?end|front[- ]?end|web|product|platform|api|application|payments?|developer|swe)\b.*\b(engineer|developer)\b|\b(engineer|developer)\b.*\b(software|full[- ]?stack|back[- ]?end|front[- ]?end|web|payments?|platform|product|api)\b|^software (engineer|developer)|^(full[- ]?stack|backend|frontend|web) (engineer|developer)/i;
const NOT_ROLE = /\b(ios|android|embedded|firmware|hardware|asic|fpga|silicon|machine learning|\bml\b|ai research|research (scientist|engineer)|data (engineer|scientist)|analytics engineer|security engineer|site reliability|\bsre\b|devops|network|solutions? engineer|sales engineer|support engineer|forward deployed|field engineer|customer engineer|implementation engineer|test engineer|in test|sdet|\bqa\b|quality|automation engineer|salesforce|servicenow|workday|mainframe|cobol|\.net|c\+\+|kernel|compiler|gpu|cuda|systems? software|performance engineer|robotics|autonomy|perception|game|unity|unreal|intern|internship|co-?op|manager|director|head of|vp\b|vice president|recruit|designer|product manager|program manager|evangelist|advocate|developer relations|devrel|writer|instructor|teacher|tutor)\b/i;

export function isRelevant(title) {
  return ROLE.test(title) && !NOT_ROLE.test(title);
}

// ---------- Level ----------

export function levelOf(title, years) {
  const t = String(title).toLowerCase();
  if (/\b(staff|principal|distinguished|architect|fellow|lead|tech lead|manager|director|head)\b/.test(t)) return 'lead';
  // Numbered levels too: Capital One's "Engineer 4", "Developer III".
  if (/\b(senior|sr\.?|iii|iv|v)\b|\blevel (3|4|5)\b|\b(l5|l6|e5|e6|ic4|ic5)\b|(engineer|developer)\s*(3|4|5|6)\b/.test(t)) return 'senior';
  if (/\b(new grad|graduate|entry|junior|jr\.?|early career|university|apprentice|associate)\b|(engineer|developer)\s+(i|1)\b(?!i)|\blevel 1\b|\b(l3|e3|ic1|ic2)\b/.test(t)) return 'entry';
  if (/\b(ii|2|level 2|mid|intermediate|l4|e4|ic3)\b/.test(t)) return 'mid';
  if (years >= 5) return 'senior';
  if (years >= 2) return 'mid';
  if (years != null && years <= 1) return 'entry';
  return 'mid';
}

// ---------- Field ----------

const PAYMENTS = /\b(payments?|billing|checkout|ledger|money movement|fintech|banking|bank|card(s|holder)?|issuing|acquiring|transactions?|wallet|treasury|lending|loans?|credit|fraud|risk|merchant|payouts?|invoic\w*|financial|money|remittance|stablecoin|crypto|reconciliation|settlement|disbursement|payroll|expense|spend|commerce|subscriptions?)\b/i;
export const isPayments = (text) => PAYMENTS.test(text || '');
// In a description, payments work is talked about more than once.
const STRONG = /\b(payments?|billing|checkout|ledger|money movement|transactions?|merchant|payouts?|issuing|acquiring|settlement|reconciliation|invoic\w*|card networks?|money transfer|remittance)\b/gi;
export const paymentsInText = (text) => (String(text || '').match(STRONG) || []).length >= 3;
export const isFrontend = (title) => /\b(front[- ]?end|ui|web (engineer|developer)|design systems?)\b/i.test(title) && !/full[- ]?stack/i.test(title);

// ---------- Place ----------

const ATL = /\batlanta\b|alpharetta|\bgeorgia\b|,\s*ga\b|\bga,|\bmarietta\b|\bkennesaw\b|\bduluth, ga|\bsandy springs\b/i;
const NYC = /new york|\bnyc\b|brooklyn|manhattan|jersey city|hoboken/i;
const CAL = /california|san francisco|\bsf\b|bay area|los angeles|\bla\b|san jose|palo alto|mountain view|menlo park|sunnyvale|santa clara|oakland|san mateo|redwood city|san diego|irvine|santa monica|cupertino|,\s*ca\b/i;
const NON_US = /canada|toronto|vancouver|montreal|united kingdom|\buk\b|london|ireland|dublin|germany|berlin|france|paris|spain|portugal|netherlands|amsterdam|poland|india|bangalore|bengaluru|hyderabad|pune|singapore|australia|sydney|brazil|são paulo|sao paulo|mexico|argentina|colombia|israel|tel aviv|japan|tokyo|china|philippines|nigeria|lagos|kenya|south africa|emea|apac|latam|europe|romania|lithuania|estonia|sweden|denmark|switzerland|uae|dubai|korea|taiwan|malaysia|indonesia|vietnam|chile|peru|uruguay|costa rica|egypt|turkey|czech|hungary|greece|austria|belgium|italy|finland|norway/i;
const US_REMOTE = /remote[^·|;]*\b(us|usa|u\.s\.|united states|americas|north america|anywhere|nationwide)\b|\b(us|usa|united states)[^·|;]*remote|^remote$|remote\s*-\s*us/i;

const US_PLACE = /united states|\busa?\b|u\.s\.|americas|north america|anywhere|nationwide|\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b|,\s*(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b|\b(nyc|san francisco|bay area|seattle|austin|boston|chicago|denver|atlanta|los angeles|miami|dallas|houston|portland|phoenix|salt lake|raleigh|nashville|pittsburgh|philadelphia|minneapolis|san diego|san jose|palo alto|mountain view|menlo park|sunnyvale|oakland|brooklyn|charlotte|columbus|detroit|st\.? louis|kansas city|tampa|orlando|richmond|baltimore|plano|irvine|santa monica|boulder|alpharetta|lehi|provo)\b/i;
const FOREIGN_TAG = /\b(emea|apac|latam|europe|uk|canada|india|mexico|brazil|international)\b/i;

// Returns 'remote' | 'atlanta' | 'relocate' | null.
export function placeOf(job, payMax, prefs) {
  const loc = String(job.location || '');
  const parts = loc.split(/\s*[·|;]\s*|\s+or\s+/i).filter(Boolean);
  const usPart = (p) => !NON_US.test(p) && (US_PLACE.test(p) || /^\s*remote\s*$/i.test(p));
  const anyUS = parts.some(usPart);
  const foreignTitle = FOREIGN_TAG.test(job.title || '') && !/\b(us|usa|united states|americas|north america)\b/i.test(job.title || '');
  // A remote job counts when it says remote somewhere in the US (or just "Remote"),
  // or the site marks it remote and it's based in a US place.
  const remoteUS = !foreignTitle && (
    US_REMOTE.test(loc)
    || parts.some((p) => /remote/i.test(p) && !NON_US.test(p) && (US_PLACE.test(p) || /^\s*(fully\s+)?remote\s*$/i.test(p) || /remote\s*[-–(]\s*(us|usa|united states)/i.test(p)))
    || (job.remote && anyUS)
    || (job.remote && !loc.trim()));
  if (prefs.remote && remoteUS) return 'remote';
  if (prefs.atlanta && ATL.test(loc)) return 'atlanta';
  const wantsNY = prefs.relocate.some((r) => /new york/i.test(r));
  const wantsCA = prefs.relocate.some((r) => /california/i.test(r));
  if (((wantsNY && NYC.test(loc)) || (wantsCA && CAL.test(loc))) && anyUS && payMax >= prefs.relocateMinPay) return 'relocate';
  return null;
}

// ---------- Pay ----------

// Finds pay ranges like "$120,000 - $150,000", "$120K–$150K", "USD 120,000 to 150,000", "$55 - $70 per hour".
export function parseSalary(text) {
  const t = String(text || '').replace(/ /g, ' ');
  const num = (s, k) => {
    let n = Number(String(s).replace(/[,\s]/g, ''));
    if (/k/i.test(k || '')) n *= 1000;
    return n;
  };
  const re = /(?:\$|USD\s?)\s?(\d{2,3}(?:[,\s]\d{3})*(?:\.\d+)?)\s*([kK])?\s*(?:-|–|—|to)\s*(?:\$|USD\s?)?\s?(\d{2,3}(?:[,\s]\d{3})*(?:\.\d+)?)\s*([kK])?(\s*(?:per|\/|an?)\s*(?:hour|hr))?/g;
  let m;
  const ranges = [];
  while ((m = re.exec(t))) {
    let lo = num(m[1], m[2] || m[4]);
    let hi = num(m[3], m[4]);
    if (m[5] || (hi < 300 && lo < 300)) { lo *= 2080; hi *= 2080; }
    if (lo >= 40000 && hi <= 900000 && hi >= lo) ranges.push([lo, hi]);
  }
  if (!ranges.length) return null;
  // Several ranges usually means different cities; show the whole spread.
  return { min: Math.min(...ranges.map((r) => r[0])), max: Math.max(...ranges.map((r) => r[1])), source: 'posted', zones: ranges.length };
}

// When a posting has no pay, a rough range by company pay level and job level.
const BANDS = {
  top: { entry: [140000, 175000], mid: [165000, 215000], senior: [210000, 270000] },
  high: { entry: [115000, 145000], mid: [135000, 180000], senior: [175000, 230000] },
  good: { entry: [95000, 125000], mid: [115000, 155000], senior: [150000, 195000] },
  mid: { entry: [80000, 110000], mid: [100000, 140000], senior: [130000, 170000] },
};
export function estimateSalary(tier, level) {
  const b = (BANDS[tier] || BANDS.good)[level === 'lead' ? 'senior' : level] || BANDS.good.mid;
  return { min: b[0], max: b[1], source: 'estimate' };
}

// ---------- Skills ----------

const HAVE = ['typescript', 'javascript', 'react', 'next.js', 'nextjs', 'react native', 'expo', 'node', 'node.js', 'express', 'rest', 'graphql', 'sql', 'postgres', 'postgresql', 'prisma', 'supabase', 'firebase', 'firestore', 'stripe', 'webhooks', 'idempotenc', 'ledger', 'reconciliation', 'aws', 's3', 'tailwind', 'html', 'css', 'jest', 'vitest', 'playwright', 'github actions', 'ci/cd', 'payments', 'api', 'full stack', 'full-stack', 'mobile', 'web'];
const OTHER = ['java', 'kotlin', 'scala', 'golang', ' go ', 'c#', '.net', 'ruby', 'rails', 'python', 'django', 'php', 'elixir', 'rust', 'c++', 'kubernetes', 'kafka', 'spark', 'hadoop', 'terraform', 'swift', 'objective-c', 'angular', 'vue', 'spring', 'cobol', 'mainframe'];

export function skillsFit(jd, extra = []) {
  const t = ` ${String(jd || '').toLowerCase()} `;
  const have = [...new Set([...HAVE, ...extra.map((s) => s.toLowerCase())])].filter((w) => t.includes(w));
  const missing = OTHER.filter((w) => t.includes(w) && !extra.some((e) => e.toLowerCase() === w.trim()));
  const score = have.length / Math.max(1, have.length + missing.length * 1.5);
  return { score: Math.round(score * 100) / 100, have: have.slice(0, 12), missing: missing.map((s) => s.trim()).slice(0, 8) };
}

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const PREF_HEAD = /(preferred|nice[- ]to[- ]haves?|bonus|desired|pluses|good to have|a plus|we'?d love|extra credit|ideally|even better)/gi;
const REQ_HEAD = /(required|requirements|minimum|basic qualifications|must[- ]haves?|what you'?ll need|you (have|bring|are|will need)|qualifications|who you are|about you|looking for|what we'?re looking)/gi;
const lastIndex = (re, text) => { let i = -1; for (const m of text.matchAll(re)) i = m.index; return i; };

// How many years of experience the job asks for. Reads every mention
// ("5+ years of backend…", "two years' experience", "3-5 years"), skips the
// "nice to have" ones, and returns the highest required number (null if none).
export function yearsRequired(jd) {
  const t = String(jd || '');
  const re = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:\+|plus)?\s*(?:(?:-|–|—|to)\s*\d{1,2}\s*\+?\s*)?(?:or more\s+)?(?:years?|yrs?)\b(?:['’]s?)?([^.\n•;]{0,90})/gi;
  const required = [];
  const preferred = [];
  for (const m of t.matchAll(re)) {
    const n = Number(m[1]) || WORDS[m[1].toLowerCase()];
    const after = m[2] || '';
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    if (!n || n > 15) continue;
    if (!/^\s*(of|in|with|using|working|building|developing|writing|shipping|designing|as|at|experience|professional|industry|hands-on|relevant|full[- ]time)\b/i.test(after)) continue;
    if (/degree|bachelor|college|university|school|\bold\b|\bago\b|founded|warranty|\bage\b/i.test(after.slice(0, 40))) continue;
    if (/\b(for|past|last|nearly|almost|over the)\s*$/i.test(before)) continue;
    // Is this mention under a "preferred / nice to have" heading, or marked as a plus?
    const head = t.slice(Math.max(0, m.index - 1500), m.index);
    const p = lastIndex(PREF_HEAD, head);
    const q = lastIndex(REQ_HEAD, head);
    const isPref = /\b(a plus|preferred|bonus|nice to have|ideally)\b/i.test(after) || (p >= 0 && (q < p || q - p < 25));
    (isPref ? preferred : required).push(n);
  }
  if (required.length) return Math.max(...required);
  if (preferred.length) return Math.min(...preferred);
  return null;
}

// ---------- Languages ----------

const JS_FAMILY = /\b(type ?script|java ?script|node\.?js|nodejs|node js|next\.?js|vue(\.js)?|angular|svelte|express\.?js|deno|react native)\b|\bReact\b|\bJS\b|\bTS\b|\bts\/js\b|\bjs\/ts\b/i;
const OTHER_LANGS = [
  ['Java', /\bjava\b(?!\s*script)/i],
  ['Python', /\bpython\b/i],
  ['Go', /\bgolang\b|(?:in|with|using|like|e\.g\.,?|such as|,|\/|\(|or|and)\s+Go\b(?![-\s]?to\b)/],
  ['Kotlin', /\bkotlin\b/i],
  ['Scala', /\bscala\b/i],
  ['Ruby', /\bruby\b|\brails\b/i],
  ['C#/.NET', /c#|\.net\b|\bdotnet\b/i],
  ['C++', /c\+\+/i],
  ['Rust', /\brust\b/i],
  ['PHP', /\bphp\b/i],
  ['Elixir', /\belixir\b/i],
  ['Clojure', /\bclojure\b/i],
];
// Phrases that say any language is fine, or that a comparable one will do
// ("Python or a comparable backend language").
const ANY_LANGUAGE = /\bor (a |an |any |another )?(comparable|similar|equivalent|other)\b[^.\n]{0,30}\blanguages?\b|\bany (modern |mainstream )?(programming |coding )?language|language[- ]agnostic|regardless of (the )?(programming )?language|(new|other) languages can be learned|learn new languages|don.?t (need|expect you) to (already )?know (our|the) (stack|language)|no specific (programming )?language|at least one (modern |general[- ]purpose |object[- ]oriented |high[- ]level )?(programming )?language|(one or more|a) (modern |general[- ]purpose |object[- ]oriented |high[- ]level )?programming languages?\b(?!\s*(such as|like|e\.g|including)[^.]*\b(only)\b)|programming language\s*\(e\.g\.?|(a|any) (modern|general[- ]purpose|object[- ]oriented|high[- ]level) (programming )?language/i;

// Splits a description into "required" and "nice to have" text, by its headings.
function requiredText(text) {
  let mode = 'req';
  const req = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    const heading = line.length < 80 && !/[.;]$/.test(line) && !/^[•\-*]/.test(line);
    if (heading && /(preferred|nice[- ]to[- ]haves?|bonus|desired|pluses|good to have|extra credit|even better)/i.test(line)) { mode = 'pref'; continue; }
    if (heading && /(required|requirements|minimum|basic qualifications|must[- ]haves?|what you.?ll need|you (have|bring|are)|qualifications|who you are|about you|looking for|what you.?ll do|responsibilities)/i.test(line)) { mode = 'req'; continue; }
    if (heading && /^(benefits|perks|compensation|pay|salary|about (us|the company)|our (values|culture)|equal opportunity|eeo)/i.test(line)) { mode = 'other'; continue; }
    if (mode === 'req' && !/\b(a plus|is a bonus|preferred|nice to have)\b/i.test(line)) req.push(line);
  }
  return req.join('\n');
}

// Does the job accept JavaScript/TypeScript, any language, or is it built on another one?
// Returns { fit: 'js' | 'any' | 'other' | 'unknown', other: [...] }.
export function languageFit(text, title = '') {
  const all = String(text || '');
  const req = requiredText(all) || all;
  const others = OTHER_LANGS.filter(([, re]) => re.test(req)).map(([n]) => n);
  const titleOther = OTHER_LANGS.filter(([, re]) => re.test(title)).map(([n]) => n);
  const jsInTitle = JS_FAMILY.test(title) || /full[- ]?stack|front[- ]?end|web/i.test(title);
  if (titleOther.length && !jsInTitle) return { fit: 'other', other: titleOther };
  if (JS_FAMILY.test(req) || jsInTitle) return { fit: 'js', other: others };
  if (ANY_LANGUAGE.test(all)) return { fit: 'any', other: others };
  // Another language is required and yours only shows up as a nice-to-have.
  if (others.length) return { fit: 'other', other: others };
  return { fit: JS_FAMILY.test(all) ? 'js' : 'unknown', other: [] };
}

// ---------- Putting it together ----------

// meta = the company's details from the catalog (tier, focus, group).
// How the years asked compare to what you want: 2 or less is good, 3 okay, 4 a stretch.
const NEW_GRAD = /\b(new grad(uate)?s?|university grad(uate)?|recent grad(uate)?|grad(uate)? (program|scheme)|class of 20\d\d|20\d\d (start|grads?|graduates?)|campus|residency program)\b|\(20\d\d\)|\b20(2[6-9]|3\d)\b/i;

export function yearsFit(years, prefs = DEFAULT_PREFS) {
  if (years == null) return 'unknown';
  if (years > prefs.maxYears) return 'too many';
  if (years <= 2) return 'good';
  if (years <= 3) return 'okay';
  return 'stretch';
}

export function assess(job, meta = {}, prefs = DEFAULT_PREFS, extraSkills = []) {
  const why = [];
  const relevant = isRelevant(job.title);
  const e = job.enrich || {};
  const years = e.years ?? null;
  const level = levelOf(job.title, years);
  const posted = e.salary || job.salaryPosted || null;
  const salary = posted || estimateSalary(meta.tier || 'good', level);
  const place = placeOf(job, salary.max, prefs);
  const payments = isPayments(`${job.title} ${job.department || ''}`) || paymentsInText(e.jdHead);
  const frontend = isFrontend(job.title);
  const skills = e.skills || null;
  const yf = yearsFit(years, prefs);
  // Daily-mix group: entry, mid, or stretch (4 years asked, or a senior title that asks 4 or less).
  const band = yf === 'stretch' || level === 'senior' ? 'senior' : level === 'entry' || (years != null && years <= 1) ? 'entry' : 'mid';

  let ok = relevant && level !== 'lead' && !!place;
  if (ok && yf === 'too many') { ok = false; why.push(`asks for ${years}+ years`); }
  // Built on a language you don't use, with no "any language is fine".
  const lang = e.lang || null;
  if (ok && lang?.fit === 'other') { ok = false; why.push(`built on ${lang.other.join('/') || 'another language'}`); }
  if (ok && lang?.fit === 'unknown' && prefs.hideUnknownLanguage) { ok = false; why.push('language not stated'); }
  // New-grad programs are for people finishing school about now.
  if (ok && NEW_GRAD.test(job.title)) { ok = false; why.push('new-grad program'); }
  // Senior titles nearly always want 5+ years; only keep one that says 4 or less.
  if (ok && level === 'senior' && (!prefs.allowSeniorTitles || years == null || years > prefs.maxYears)) { ok = false; why.push('senior-level role'); }
  if (ok && salary.max < prefs.salaryMin) { ok = false; why.push('pay below your range'); }
  if (ok && salary.min > prefs.salaryMax * 1.15 && level !== 'senior') { ok = false; why.push('pay far above your range'); }

  let score = 0;
  if (relevant) {
    score += { entry: 30, mid: 32, senior: 18, lead: 0 }[level];
    score += { good: 10, okay: 4, stretch: -8, unknown: -2, 'too many': -30 }[yf];
    score += { js: 6, any: 3, unknown: -6, other: -30 }[lang?.fit] ?? 0;
    if (payments) score += 25;
    else if (meta.focus === 'payments') score += 10;
    if (frontend) score -= 4;
    // A title built around a language you don't use ("Java/Spring Boot Engineer").
    if (/\b(java|spring|golang|go engineer|\.net|c#|python|ruby|rails|scala|kotlin|php|elixir|rust)\b/i.test(job.title) && !/typescript|node|javascript|react|full[- ]?stack/i.test(job.title)) score -= 12;
    score += Math.round((skills ? skills.score : 0.5) * 30);
    score += { top: 8, high: 6, good: 3, mid: 2 }[meta.tier] || 2;
    // Fresher postings get read by fewer people; very old ones are often filled.
    const days = job.postedAt ? (Date.now() - Date.parse(job.postedAt)) / 864e5 : null;
    if (days != null) score += days <= 7 ? 8 : days <= 30 ? 4 : days <= 90 ? 0 : -10;
    if (place === 'atlanta') score += 3;
    if (place === 'relocate') score -= 2;
  }

  if (lang?.fit === 'js') why.push(lang.other.length ? `JavaScript/TypeScript accepted (also lists ${lang.other.join(', ')})` : 'JavaScript/TypeScript');
  if (lang?.fit === 'any') why.push(`any language accepted${lang.other.length ? ` (mentions ${lang.other.join(', ')})` : ''}`);
  if (lang?.fit === 'unknown') why.push('language not stated');
  if (years != null) why.push(`${years}+ years asked${yf === 'stretch' ? ' (a stretch)' : ''}`);
  if (payments) why.push('payments');
  if (skills?.have?.length) why.push(`uses ${skills.have.slice(0, 4).join(', ')}`);
  if (skills?.missing?.length) why.push(`also wants ${skills.missing.slice(0, 3).join(', ')}`);

  return { ok, score: Math.max(0, Math.min(100, score)), level, band, years, yearsFit: yf, lang: lang?.fit || null, place, payments, frontend, salary, why };
}

// Today's picks: the right mix of levels, mostly payments, a little frontend,
// and never more than a couple from one company.
export function pickForToday(jobs, prefs, count) {
  // Only jobs that clearly take JavaScript/TypeScript or any language.
  const ranked = [...jobs].filter((j) => j.fit.lang !== 'unknown').sort((a, b) => b.fit.score - a.fit.score);
  const quota = {
    entry: Math.round((count * prefs.mix.entry) / 100),
    senior: Math.max(0, Math.round((count * prefs.mix.senior) / 100)),
  };
  quota.mid = count - quota.entry - quota.senior;
  const maxFrontend = Math.round((count * prefs.frontendShare) / 100);
  const perCompany = {};
  const picked = [];
  const take = (j) => {
    picked.push(j);
    perCompany[j.company] = (perCompany[j.company] || 0) + 1;
  };
  const canTake = (j, strict) => !picked.includes(j)
    && (perCompany[j.company] || 0) < (strict ? 2 : 3)
    && (!j.fit.frontend || picked.filter((p) => p.fit.frontend).length < maxFrontend);
  const band = (j) => j.fit.band || j.fit.level;
  for (const level of ['mid', 'entry', 'senior']) {
    for (const j of ranked) {
      if (picked.filter((p) => band(p) === level).length >= quota[level]) break;
      if (band(j) === level && canTake(j, true)) take(j);
    }
  }
  // Not enough of a level? Fill with the best of the rest.
  for (const j of ranked) {
    if (picked.length >= count) break;
    if (band(j) !== 'senior' && canTake(j, false)) take(j);
  }
  return picked.sort((a, b) => b.fit.score - a.fit.score);
}

// At most N per company, keeping each company's best.
export function capPerCompany(jobs, n) {
  const count = {};
  return jobs.filter((j) => (count[j.company] = (count[j.company] || 0) + 1) <= n);
}

// The "smaller & local" track: smaller or lower-paying companies (any industry),
// pay starting under smallerMaxPay, Atlanta first then remote, one per company.
export function pickSmaller(jobs, metaOf, prefs, count, skip = new Set()) {
  const isSmaller = (j) => {
    const m = metaOf(j) || {};
    return m.group === 'smaller' || m.tier === 'mid' || m.tier === 'good';
  };
  const pool = jobs.filter((j) => !skip.has(j.uid) && isSmaller(j)
    && (j.fit.place === 'atlanta' || j.fit.place === 'remote') && j.fit.salary.min < prefs.smallerMaxPay);
  // Mostly local: about two thirds from Atlanta, the rest from genuinely smaller
  // companies (remote). Within each, smaller companies first, then best match.
  const small = (j) => (metaOf(j)?.group === 'smaller' ? 1 : 0);
  // Jobs that name your language first (small companies often don't say).
  const known = (j) => (j.fit.lang === 'unknown' ? 0 : 1);
  const order = (a, b) => known(b) - known(a) || small(b) - small(a) || b.fit.score - a.fit.score;
  const local = pool.filter((j) => j.fit.place === 'atlanta').sort(order);
  const remote = pool.filter((j) => j.fit.place === 'remote').sort(order);
  const used = new Set();
  const out = [];
  const take = (list, n) => {
    for (const j of list) {
      if (out.length >= count || n <= 0) break;
      if (used.has(j.company) || out.includes(j)) continue;
      used.add(j.company);
      out.push(j);
      n--;
    }
  };
  take(local, Math.ceil((count * 2) / 3));
  take(remote.filter((j) => small(j)), count - out.length);
  take([...local, ...remote], count - out.length); // fill any gap
  return out;
}

// Worth a LinkedIn DM? Only strong matches: they're the ones where a note to
// the hiring manager changes the outcome. Smaller companies get a slightly lower bar.
export const dmWorthy = (job, smallCo = false) => (job.fit?.score ?? 0) >= (smallCo ? 75 : 80);

// How many top vs smaller picks today, by plan week.
export function mixFor(prefs, week, dailyGoal) {
  if (prefs.rampUp && week <= 2) return { top: 2, smaller: 6, label: 'Ramp-up: mostly smaller companies' };
  if (prefs.rampUp && week <= 4) return { top: 4, smaller: 4, label: 'Ramp-up: half and half' };
  return { top: dailyGoal, smaller: prefs.smallerPerDay || 0, label: '' };
}

export function isDream(company, prefs) {
  const c = String(company || '').toLowerCase();
  return (prefs.dreamCompanies || []).some((d) => { const x = String(d).toLowerCase().trim(); return x && (c === x || c.startsWith(`${x} `)); });
}
