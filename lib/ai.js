// Everything that talks to OpenAI: tailoring a résumé, writing and editing a
// cover letter, drafting LinkedIn messages, and finding people to contact.
import { load, save } from './store.js';
import { INMAIL_GUIDE, SLOP } from './outreach-style.js';

const BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const keyOf = () => load().settings.openaiKey || process.env.OPENAI_API_KEY || '';

const str = { type: 'string' };
const strArr = { type: 'array', items: str };
const obj = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });

const RESUME = obj({
  name: str,
  headline: str,
  contact: obj({ location: str, phone: str, email: str, website: str, github: str, linkedin: str }),
  summary: str,
  skills: { type: 'array', items: obj({ label: str, items: str }) },
  experience: { type: 'array', items: obj({ company: str, dates: str, role: str, bullets: strArr }) },
  projects: { type: 'array', items: obj({ name: str, dates: str, bullets: strArr }) },
  education: { type: 'array', items: obj({ school: str, dates: str, details: str }) },
});

const STYLE = `Write like a person, not a brochure: plain, specific, active past-tense verbs, American English.
Never use: spearheaded, leveraged, utilized, synergy, passionate, dynamic, cutting-edge, robust, seamless, delve, tapestry, "proven track record", "I am excited to", em dashes (—).`;

const RULES = `Hard rules:
- Keep every employer, job title, location, date, school, degree and GPA exactly as given. Don't add or remove jobs.
- Never invent numbers, metrics, products, employers or responsibilities. Every bullet must describe something already in the résumé, reworded.
- Only list skills that are already in the résumé or in "extraSkills".`;

export function hasKey() { return !!keyOf(); }

function friendly(status, err) {
  const msg = err?.message || `OpenAI error ${status}`;
  if (status === 401) return 'OpenAI didn\'t accept your API key. Check it in Settings.';
  if (status === 429 && /quota|billing|credit/i.test(msg)) return 'Your OpenAI account is out of credits. Add credits at platform.openai.com/settings/organization/billing.';
  if (status === 429) return 'OpenAI is busy (rate limit). Wait a few seconds and try again.';
  if (/model/i.test(msg) && /(not exist|not found|access)/i.test(msg)) return `Your OpenAI account can't use the model "${load().settings.aiModel}". Pick another in Settings.`;
  return msg;
}

// Small jobs (messages, picking a replacement, web lookups) use a cheaper model;
// the résumé and cover letter use your main one. Both are set in Settings.
export const LIGHT_DEFAULT = 'gpt-5.4-mini';
const modelFor = (light) => {
  const st = load().settings;
  return (light ? st.aiModelLight || LIGHT_DEFAULT : st.aiModel) || 'gpt-5-mini';
};

// Tokens used per day, so you can see where the money goes (Settings → OpenAI).
function recordUsage(name, model, data) {
  const u = data.usage || {};
  const db = load();
  const day = new Date().toLocaleDateString('en-CA');
  const all = (db.aiUsage ||= {});
  const d = (all[day] ||= { calls: 0, input: 0, cached: 0, output: 0, reasoning: 0, searches: 0, tasks: {}, models: {} });
  const searches = (data.output || []).filter((o) => o.type === 'web_search_call').length;
  d.calls++;
  d.input += u.input_tokens || 0;
  d.cached += u.input_tokens_details?.cached_tokens || 0;
  d.output += u.output_tokens || 0;
  d.reasoning += u.output_tokens_details?.reasoning_tokens || 0;
  d.searches += searches;
  const t = (d.tasks[name] ||= { calls: 0, input: 0, output: 0, searches: 0 });
  t.calls++; t.input += u.input_tokens || 0; t.output += u.output_tokens || 0; t.searches += searches;
  d.models[model] = (d.models[model] || 0) + 1;
  for (const k of Object.keys(all).sort().slice(0, -30)) delete all[k];
  save();
}

async function call({ instructions, input, schema, name, effort = 'low', tools, light = false }) {
  const key = keyOf();
  if (!key) throw new Error('Add your OpenAI API key in Settings first.');
  let model = modelFor(light);
  const body = {
    model,
    instructions,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    text: { format: { type: 'json_schema', name, schema, strict: true } },
  };
  // Reasoning is billed as output: keep it as low as the task allows.
  if (/^(gpt-[5-9]|o\d)/.test(model)) body.reasoning = { effort };
  if (tools) body.tools = tools;
  const send = () => fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  let res = await send();
  let data = await res.json().catch(() => ({}));
  // A model that doesn't take a setting: drop it and try once more.
  if (res.status === 400 && /reasoning|effort/i.test(data.error?.message || '')) {
    delete body.reasoning;
    res = await send(); data = await res.json().catch(() => ({}));
  }
  if (res.status === 400 && /search_context_size/i.test(data.error?.message || '') && body.tools) {
    body.tools = body.tools.map(({ search_context_size, ...t }) => t);
    res = await send(); data = await res.json().catch(() => ({}));
  }
  // The cheaper model isn't on this account: use the main one.
  if (light && !res.ok && /model/i.test(data.error?.message || '') && model !== load().settings.aiModel) {
    model = body.model = load().settings.aiModel || 'gpt-5-mini';
    res = await send(); data = await res.json().catch(() => ({}));
  }
  if (!res.ok) {
    const e = new Error(friendly(res.status, data.error));
    e.status = res.status;
    e.raw = data.error?.message || '';
    throw e;
  }
  try { recordUsage(name, model, data); } catch {}
  const text = (data.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []).find((c) => c.type === 'output_text')?.text;
  if (!text) throw new Error('OpenAI sent back an empty answer. Try again.');
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('OpenAI sent back something unexpected. Try again.');
  }
}

const trimJd = (jd, max = 8000) => String(jd || '').slice(0, max);

// ---------- Résumé ----------

export function tailorResume({ job, jd, base, extraSkills, focus, teamContext }) {
  return call({
    name: 'tailored_resume',
    effort: 'low',
    schema: obj({
      resume: RESUME,
      changes: strArr,
      suggestions: { type: 'array', items: obj({ skill: str, group: str, why: str }) },
      matched: strArr,
      about: obj({ company: str, team: str, hiringTitles: strArr }),
    }),
    instructions: `You tailor a software engineer's résumé to one job posting so it gets past applicant tracking systems and reads well to a hiring manager.
${RULES}
What to do:
- headline: a role title of at most 5 words that fits the posting (for example "Full Stack Software Engineer" or "Backend Software Engineer").
- summary: 2 or 3 sentences aimed at this job, using only facts from the résumé.
- Reorder bullets inside each job so the most relevant come first. Reword them to use the posting's own words where that is true. You may drop a weak bullet or merge two. Keep each bullet under about 200 characters.
- Reorder skill groups, and the skills inside each group, so what the posting asks for comes first. You may rename a group.
- Keep the total length about the same as the original so it stays on one page.${focus ? `\n- The candidate asked: "${focus}". Do it, within the hard rules (reorder, reword and emphasize; never invent).` : ''}${teamContext ? '\n- "teamContext" is what someone on the hiring team wrote or posted. Treat what they care about as extra signal for what to put first and which words to use.' : ''}
${STYLE}
Also return:
- changes: 3 to 6 short notes, in plain words, about what you changed and why.
- suggestions: up to 8 skills or tools the posting asks for that are NOT in the résumé or extraSkills but are close to something the candidate already uses. In "why", name the related thing they already use (for example "You use PostgreSQL daily; MySQL is very similar"). Do not put these in the résumé. "group" is the skills group it would belong in.
- matched: up to 8 of the posting's main requirements that the résumé covers, a few words each.
- about: company = one sentence on what the company does; team = the team named in the posting or ""; hiringTitles = 2 to 4 likely job titles of the person who would manage this role.`,
    input: { job, posting: trimJd(jd), resume: base, extraSkills, ...(teamContext ? { teamContext: String(teamContext).slice(0, 6000) } : {}) },
  });
}

// Title, company and place from a pasted job description.
export function readPosting({ jd }) {
  return call({
    name: 'posting',
    light: true,
    effort: 'low',
    schema: obj({ title: str, company: str, location: str }),
    instructions: 'Read this job posting. title = the exact job title. company = the hiring company\'s short name (not a recruiting agency or job board if the employer is named). location = city and state, "Remote", or "" if not stated. Use "" for anything you can\'t find.',
    input: trimJd(jd, 8000),
  });
}

export function reviseResume({ job, jd, resume, instruction, extraSkills }) {
  return call({
    name: 'revised_resume',
    effort: 'low',
    schema: obj({ resume: RESUME, changes: strArr }),
    instructions: `You edit a résumé that was already tailored to a job. Make the change the candidate asks for and nothing else.
Keep employers, titles, dates, schools and degrees exactly as they are unless the candidate explicitly asks to change them.
If the candidate asks you to add a skill or detail, add it the way they describe. Don't add other facts on your own.
Keep it about the same length so it stays on one page.
${STYLE}
changes: 1 to 3 short notes on what you changed.`,
    input: { request: instruction, job, posting: trimJd(jd), resume, extraSkills },
  });
}

export function parseResume(text) {
  return call({
    name: 'parsed_resume',
    effort: 'low',
    schema: obj({ resume: RESUME }),
    instructions: 'Turn this résumé text into structured data. Copy the wording exactly; don\'t improve or summarize it. Put the part after the company line (title, location, etc.) into "role". Use "" for anything missing.',
    input: text.slice(0, 20000),
  });
}

// ---------- Cover letter ----------

export function writeCover({ job, jd, resume, sample, about }) {
  return call({
    name: 'cover_letter',
    effort: 'low',
    schema: obj({ letter: str }),
    instructions: `Write a cover letter for this job in the candidate's own voice.
- Use "sample" (a letter the candidate wrote before) as the model for tone, length and structure. Don't reuse its company-specific lines.
- Open by naming the role (and team, if there is one) and one specific, true reason this company or product interests them, based on the posting.
- Then 1 or 2 short paragraphs of evidence: the 2 or 3 things from the résumé that best match what the posting asks for. Be concrete.
- End with one or two short sentences. No begging, no "I look forward to hearing from you at your earliest convenience".
- 220 to 320 words. Start with "Dear <Company> Hiring Team," (or the team name). End with "Best,\\n<candidate name>".
- Only use facts from the résumé. Separate paragraphs with a blank line. No header, date or address block.
${STYLE}`,
    input: { job, about, posting: trimJd(jd), resume, sample },
  });
}

export function reviseCover({ job, jd, letter, instruction, resume }) {
  return call({
    name: 'revised_cover_letter',
    light: true,
    effort: 'low',
    schema: obj({ letter: str }),
    instructions: `Edit this cover letter the way the candidate asks. Change only what's needed. Keep the greeting and sign-off. Only use facts from the résumé unless the candidate tells you to add something.
${STYLE}`,
    input: { request: instruction, job, letter, posting: trimJd(jd), resume },
  });
}

// ---------- People to contact on LinkedIn ----------

// InMail in the candidate's own style (lib/outreach-style.js), personalized
// from whatever they pasted from the person's LinkedIn page.
export async function draftOutreach(args) {
  let out = await draftOutreachOnce(args);
  const hits = (text) => SLOP.map((re) => (text.match(re) || [])[0]).filter(Boolean);
  const found = hits(out.message);
  const words = (t) => t.split(/\s+/).filter(Boolean).length;
  if (!found.length && words(out.message) > 175) {
    const shorter = await draftOutreachOnce({ ...args, instruction: 'Cut it to about 140 words. Keep every part of the structure (opener, experience, ask, portfolio line, thanks, sign-off).', current: { subject: out.subjects[0]?.text || '', message: out.message } });
    if (words(shorter.message) < words(out.message)) out = { ...shorter, subjects: out.subjects, hook: out.hook };
  }
  if (found.length) {
    const again = await draftOutreachOnce({
      ...args,
      instruction: `Rewrite it plainer. Remove these phrases and anything like them: ${found.map((x) => `"${x}"`).join(', ')}. Keep the same facts, opener and ask; make every sentence sound like a person talking.`,
      current: { subject: out.subjects[0]?.text || '', message: out.message },
    });
    if (hits(again.message).length < found.length) out = { ...again, subjects: out.subjects, hook: out.hook };
  }
  return out;
}

function draftOutreachOnce({ job, jd, about, resume, person, style, applied, attachResume, instruction, current }) {
  return call({
    name: 'outreach',
    effort: 'medium', // the main model: noticeably better hooks for about a cent per message
    schema: obj({ subjects: { type: 'array', items: obj({ text: str, angle: { type: 'string', enum: ['the role', 'the team', 'the work'] } }) }, message: str, note: str, hook: str }),
    instructions: `You write LinkedIn InMails for a job candidate to someone at a company about a specific job. The candidate's real messages below got replies, and two led to interviews. Write a new one that could sit right next to them: same structure, same voice, same length. No shortcuts, no cleverness, nothing from the person's personal life.

${INMAIL_GUIDE}

The candidate's real messages (follow these closely):
${style.examples}

Output:
- subjects: exactly 3 simple, straightforward subject lines, best first, one of each kind:
  "the role": "Interested in the {Job Title} Opportunity at {Company}" (shorten a very long title to its core, e.g. "Full Stack Engineer");
  "the team": "Interested in Bringing My Expertise to the {Team} Team" or "Interested in Joining {Company}'s {Team} Team";
  "the work": "Interested in Building {what the team builds} at {Company}".
  Use the real team or product name from the posting or their page when there is one. Each at most 60 characters.
- message: the InMail body, from "Hi {first name}," through the sign-off "${style.signoff}". Use the portfolio link ${style.portfolio}.${attachResume ? ' The résumé is attached: write "I\'ve attached my resume, and here\'s my portfolio: ..." on that line.' : ' Don\'t mention an attached résumé; write "Here\'s my portfolio: ...".'} about 100 to 150 words, written like the real messages.
- note: a connection-request version, at most 200 characters, same three parts in one or two sentences: their thing or the role, one fact, a light ask. No link.
- hook: a few words naming what from their page you opened with (for example "their post on Mercury Books"), or "nothing personal found" if their page gave you nothing usable.

Facts:
- About the candidate, use only the résumé and "thingsICanSay". Pick what fits this job and this person best; numbers exactly as given.
- About the person, use only what's in "theirLinkedInPage" and "foundOnPublicWeb" (and their name and title). Prefer something recent and personal: a post they wrote, a launch, a talk. Never invent a post, launch, team, or shared interest. If neither has anything personal, use the plain opener.
- First name: from their name. Exact job title as given.${applied ? '' : '\n- The candidate is about to apply; still write "I recently applied", since they send it right after applying.'}
${instruction ? `\nThe candidate wants this change to the current draft: "${instruction}". Keep everything else close to the current draft.` : ''}`,
    input: {
      job: { ...job, team: about?.team || '' },
      jobDescription: trimJd(jd || '', 1500),
      person: { name: person.name, title: person.title, kind: person.kind },
      theirLinkedInPage: String(person.profile || '').slice(0, 5000),
      foundOnPublicWeb: person.research || [],
      thingsICanSay: style.facts,
      resume: { headline: resume.headline, experience: resume.experience.map((x) => ({ company: x.company, role: x.role, bullets: x.bullets.slice(0, 3) })) },
      ...(current ? { currentDraft: current } : {}),
    },
  });
}

// A short reply when they answer, in the candidate's voice.
export function draftReply({ job, person, sent, theirReply, style, applied, update }) {
  return call({
    name: 'outreach_reply',
    light: true,
    effort: 'low',
    schema: obj({ reply: str }),
    instructions: `Write the candidate's reply to someone who answered their LinkedIn InMail about a job. Match the candidate's voice in these real replies:

${style.replies}

Rules: 1 to 3 short sentences. Start with "Thanks for the reply, {first name}!" or similar, or "Hey {first name}, thank you so much..." when they did something helpful. Answer what they actually said. If they said to apply: say ${applied ? 'you\'ve already applied' : 'you\'ve applied'} and you're looking forward to any updates. If they passed it along or offered help: thank them warmly and, if "update" says something happened (a call booked, someone reached out), share it. If they asked a question, answer it from the original message's facts only. If it's something only the candidate can decide or know (location or office days, relocation, start date, pay, visa, availability), write the sentence with a [bracketed placeholder] for them to fill in, for example "I'm [open to / not able to do] a few days a week in SF." Never decide it for them. A friendly closing wish is fine ("Hope you have a great week!"). Light ":)" is fine, no other emoji. No sign-off name. No em dashes.`,
    input: { job, person: { name: person.name, title: person.title }, mySentMessage: sent || '', theirReply, update: update || '' },
  });
}

// What's publicly known about a person (posts Google can see, talks, articles,
// company blog posts), so an InMail can open with something real about them.
export async function researchPerson({ person, company, role }) {
  const args = {
    name: 'person_research',
    light: true,
    effort: 'low',
    schema: obj({
      found: { type: 'array', items: obj({ what: str, when: str, url: str }) },
      best: str,
    }),
    instructions: `Search the public web for things this specific person said, wrote, built or launched, so a job candidate can open a message with something real about them.
Look for: their posts or articles (including LinkedIn posts that show up in search results), blog posts on the company's engineering blog, talks, podcasts, interviews, product launches they announced, customer stories quoting them, open-source work, a company they founded before.
Make sure it is the same person: same name AND the company or role matches. Skip anything you're not sure about.
found = up to 5 items, most recent and most personal first. what = one concrete sentence (what they said, wrote or launched, with the specific name of the thing). when = month and year if known, else "". url = the page.
best = which item would make the best opener and why, in one short line; "" if nothing found.
Never guess or invent. An empty list is fine.`,
    input: { name: person.name, title: person.title, company, roleTheCandidateAppliedFor: role, sourceWeAlreadyHave: person.source || '' },
  };
  try {
    return await call({ ...args, tools: [{ type: 'web_search', search_context_size: 'low' }] });
  } catch (e) {
    if (e.status === 400 && /web_search/i.test(e.raw)) return call({ ...args, tools: [{ type: 'web_search_preview', search_context_size: 'low' }] });
    throw e;
  }
}

const PEOPLE = obj({
  people: {
    type: 'array',
    items: obj({ name: str, title: str, currentCompany: str, linkedin: str, source: str, kind: { type: 'string', enum: ['hiring manager', 'recruiter', 'engineering leader', 'engineer'] }, why: str, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } }),
  },
});

export async function findPeople({ job, about }) {
  const args = {
    name: 'people',
    light: true,
    effort: 'low',
    schema: PEOPLE,
    instructions: `Search the web to find up to 6 people who CURRENTLY work at the company and would be good to contact about this job: the likely hiring manager (engineering manager or director for that team), a technical recruiter or talent partner, and senior engineering leaders (head of engineering, VP engineering, CTO at a small company).
Look for their LinkedIn profiles (site:linkedin.com/in), the company's team or about pages, and recent articles or talks.
Only include people you actually found who work at THIS company right now (currentCompany = where they work today, as shown on their profile or a recent page). Never include someone from another company, a former employee, or a recruiter at a staffing agency. Never guess a name. linkedin = their profile URL starting with https://www.linkedin.com/in/ if you found it, otherwise "". source = the page where you found them. why = one short line on why they're a good person to contact. Order best first.`,
    input: { company: job.company, role: job.title, location: job.location, team: about?.team || '', likelyManagerTitles: about?.hiringTitles || [] },
  };
  try {
    return await call({ ...args, tools: [{ type: 'web_search', search_context_size: 'low' }] });
  } catch (e) {
    if (e.status === 400 && /web_search/i.test(e.raw)) return call({ ...args, tools: [{ type: 'web_search_preview', search_context_size: 'low' }] });
    throw e;
  }
}

// ---------- A better replacement when you remove a pick ----------

export function chooseReplacement({ removed, history, candidates }) {
  return call({
    name: 'replacement',
    light: true,
    effort: 'low',
    schema: obj({ uid: str, why: str }),
    instructions: `A job seeker removed a job from today's list. Pick the ONE candidate that best avoids the reason they removed it (and the patterns in their earlier removals) while still being a strong match.
The candidate's preferences show in which jobs they removed and why; the candidates are already filtered to their settings.
Return uid exactly as given, and why = one short plain sentence (under 15 words) saying why this one fits better, e.g. "Mid level, TypeScript, and pays more than the one you removed."`,
    input: { removed, earlierRemovals: history, candidates },
  });
}

// ---------- Pay ----------

export async function lookupSalary({ job, level }) {
  const args = {
    name: 'salary',
    light: true,
    effort: 'low',
    schema: obj({
      low: { type: 'number' },
      high: { type: 'number' },
      sources: { type: 'array', items: obj({ site: str, url: str, figure: str }) },
      note: str,
    }),
    instructions: `Find what this company pays software engineers at this level, in US dollars per year (base salary).
Search levels.fyi, Glassdoor, Built In, Indeed, the company's own pay-transparency postings for similar roles, and H-1B salary data.
low/high = a realistic base salary range for this role and level at this company. Use 0 for both if you truly can't find anything.
sources = up to 4 pages you used, each with the figure you saw there. note = one short line (for example "Total pay with stock is about $X").`,
    input: { company: job.company, title: job.title, level, location: job.location },
  };
  try {
    return await call({ ...args, tools: [{ type: 'web_search', search_context_size: 'low' }] });
  } catch (e) {
    if (e.status === 400 && /web_search/i.test(e.raw)) return call({ ...args, tools: [{ type: 'web_search_preview', search_context_size: 'low' }] });
    throw e;
  }
}

// ---------- Models ----------

export async function listModels(key = keyOf()) {
  if (!key) return [];
  const res = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(friendly(res.status, (await res.json().catch(() => ({}))).error));
  const { data = [] } = await res.json();
  const ver = (id) => parseFloat((id.match(/^gpt-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  return data.map((m) => m.id)
    .filter((id) => /^gpt-\d/.test(id) && !/(audio|realtime|transcribe|tts|image|search|codex|nano|instruct|chat-latest|\d{4}-\d{2}-\d{2}|preview)/.test(id))
    .sort((a, b) => ver(b) - ver(a) || (a.includes('mini') - b.includes('mini')) || a.localeCompare(b));
}
