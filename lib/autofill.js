// "Fast apply": opens the application form in a real Chrome window and fills in
// your details and résumé. It never presses Submit. You check the answers,
// fill anything it couldn't, and submit yourself.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './store.js';

let context = null;
let cdp = null; // our connection to the Job Radar Chrome window

// The Job Radar Chrome: a normal Chrome window with its own profile (your
// application-site logins are saved there). It runs on its own, so it stays
// open when Job Radar restarts, and each application opens as a new tab in it.
const PORT = 9333;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const endpoint = `http://127.0.0.1:${PORT}`;
const up = () => fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok).catch(() => false);

async function browser() {
  if (context && cdp?.isConnected()) return context;
  let pw;
  try {
    pw = await import('playwright-core');
  } catch {
    throw new Error('Autofill needs one extra package. In the job-radar folder run: npm install');
  }
  const userDataDir = path.join(dataDir, 'browser');
  if (fs.existsSync(CHROME) && process.env.JOB_RADAR_HEADLESS !== '1') {
    if (!(await up())) {
      const { spawn } = await import('node:child_process');
      spawn(CHROME, [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', '--start-maximized', 'about:blank'], { detached: true, stdio: 'ignore' }).unref();
      for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
    }
    if (await up()) {
      cdp = await pw.chromium.connectOverCDP(endpoint);
      context = cdp.contexts()[0] || await cdp.newContext();
      cdp.on('disconnected', () => { context = null; cdp = null; });
      return context;
    }
  }
  // Fallback (no Chrome app, or it wouldn't start): a Chrome that Job Radar runs itself.
  const opts = { headless: process.env.JOB_RADAR_HEADLESS === '1', viewport: null, args: ['--start-maximized'] };
  try {
    context = await pw.chromium.launchPersistentContext(userDataDir, { ...opts, channel: 'chrome' });
  } catch {
    context = await pw.chromium.launchPersistentContext(userDataDir, opts);
  }
  context.on('close', () => { context = null; });
  return context;
}

// Runs inside the application page.
function fillPage(p) {
  const rules = [
    [/preferred (first )?name|nickname|goes by/, p.preferredName || p.firstName],
    [/first.?name|given.?name|fname/, p.firstName],
    [/last.?name|family.?name|surname|lname/, p.lastName],
    [/^(full.?)?name$|your name|full name|candidate name|_systemfield_name/, `${p.firstName} ${p.lastName}`.trim()],
    [/\be-?mail/, p.email],
    [/\bphone|\bmobile\b|\btel\b|telephone/, p.phone],
    [/linkedin/, p.linkedin],
    [/github/, p.github],
    [/website|portfolio|personal site|blog|other url|urls\[other\]/, p.website || p.github],
    [/^location|current location|\bcity\b|where are you (based|located)|\baddress\b/, p.location],
    [/salary|compensation|pay expectation/, p.salary],
    [/end.?(date.?)?year|graduation year|year of graduation/, p.gradYear],
    [/sponsor/, p.needsSponsorship],
    [/authori[sz]ed|legally (eligible|able)|right to work/, p.workAuthorized],
    [/cover.?letter|why (are you|do you want)|additional information|anything else/, p.coverLetter],
  ];

  // The question a field asks: its own label first; a surrounding box's label
  // only when that box holds just this one field.
  const labelFor = (el) => {
    const bits = [el.getAttribute('aria-label')];
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) bits.push(l.textContent); }
    const by = el.getAttribute('aria-labelledby');
    if (by) by.split(/\s+/).forEach((id) => bits.push(document.getElementById(id)?.textContent));
    const parentLabel = el.closest('label');
    if (parentLabel) bits.push(parentLabel.textContent);
    if (!bits.some(Boolean)) {
      const wrap = el.closest('.field, .application-question, .form-field, [class*="field"], [class*="question"]');
      if (wrap && wrap.querySelectorAll('input:not([type=hidden]), textarea, select').length === 1) {
        const l = wrap.querySelector('label, legend, .application-label, [class*="label"]');
        if (l) bits.push(l.textContent);
      }
    }
    bits.push(el.name, el.id, el.placeholder, el.getAttribute('autocomplete'));
    return bits.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
  };

  const setValue = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.style.outline = '2px solid #22c55e';
    el.style.outlineOffset = '1px';
  };

  const filled = [];
  const fields = [...document.querySelectorAll('input, textarea')].filter((el) => {
    const t = (el.type || 'text').toLowerCase();
    // Drop-downs you type into (country, city pickers) need a real choice, so leave them to you.
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete')) return false;
    return !el.disabled && !el.readOnly && el.offsetParent !== null && ['text', 'email', 'tel', 'url', 'search', 'number', 'textarea'].includes(el.tagName === 'TEXTAREA' ? 'textarea' : t);
  });
  for (const el of fields) {
    if (el.value) continue;
    const label = labelFor(el);
    if (!label || /captcha|search/.test(label)) continue;
    for (const [re, value] of rules) {
      if (value && re.test(label)) {
        if (/sponsor|authori/.test(label) && el.tagName !== 'INPUT') break;
        setValue(el, value);
        filled.push(label.slice(0, 40));
        break;
      }
    }
  }

  // Mark the résumé upload box so Playwright can attach the file.
  const files = [...document.querySelectorAll('input[type=file]')];
  const cover = files.find((el) => /cover/i.test(labelFor(el)));
  const resume = files.find((el) => el !== cover && /resume|cv|r[ée]sum[ée]/i.test(labelFor(el))) || files.find((el) => el !== cover);
  if (resume) resume.setAttribute('data-job-radar-resume', '1');
  if (cover) cover.setAttribute('data-job-radar-cover', '1');

  return { filled, hasResumeField: !!resume, hasCoverField: !!cover };
}

// A dark note at the bottom of the page telling you what happened.
function showBanner(text) {
  document.getElementById('job-radar-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'job-radar-banner';
  banner.textContent = text;
  Object.assign(banner.style, {
    position: 'fixed', left: '50%', bottom: '20px', transform: 'translateX(-50%)', zIndex: 2147483647,
    background: '#111827', color: '#fff', padding: '12px 18px', borderRadius: '12px', font: '14px/1.4 -apple-system, system-ui, sans-serif',
    boxShadow: '0 10px 30px rgba(0,0,0,.3)', maxWidth: '90vw', cursor: 'pointer',
  });
  banner.onclick = () => banner.remove();
  document.body.appendChild(banner);
}

const FORM_SIGNS = 'input[type=email], input[name*="email" i], input[id*="email" i], input[autocomplete=email], input[type=file]';

// The form can be on the page itself or inside an embedded frame (common on
// company sites that use Greenhouse, Lever, etc.). Returns the frame that has it.
async function findFormFrame(page, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    for (const f of page.frames()) {
      if (await f.locator(FORM_SIGNS).count().catch(() => 0)) return f;
    }
    await page.waitForTimeout(400);
  }
  return null;
}

// Clicks "Apply" on job pages where the form is one step further. Follows a new tab if one opens.
// Button names can carry arrows or invisible characters ("Apply now ⁠"), so only letters are compared.
async function clickApply(page) {
  const apply = page.getByRole('link', { name: /^[^a-z]*(apply( now| for this (job|role|position))?|submit application|i'?m interested)[^a-z]*$/i })
    .or(page.getByRole('button', { name: /^[^a-z]*(apply( now| for this (job|role|position))?|i'?m interested)[^a-z]*$/i }))
    .first();
  if (!(await apply.count().catch(() => 0))) return page;
  // A plain link: just go there (a cookie banner can block clicks).
  const href = await apply.getAttribute('href').catch(() => null);
  if (href && !/^(#|javascript:)/i.test(href)) {
    await page.goto(new URL(href, page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    return page;
  }
  const [popup] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 4000 }).catch(() => null),
    apply.click({ timeout: 5000 }).catch(() => {}),
  ]);
  const target = popup || page;
  await target.waitForLoadState('domcontentloaded').catch(() => {});
  return target;
}

// ---------- Drop-downs ----------
// Country, school, degree and yes/no questions are picked from a list, not typed.

const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Lists name some places differently ("US", "USA", "UK").
const ALIASES = {
  'united states': ['united states of america', 'usa', 'us', 'u s', 'u s a', 'america'],
  'united kingdom': ['uk', 'u k', 'great britain', 'england'],
  "bachelor's degree": ["bachelor's", 'bachelors', 'bachelor of science', 'bs', 'b s', 'undergraduate degree'],
};

function bestOption(options, value) {
  const v = norm(value);
  const aliases = ALIASES[v] || [];
  let best = null;
  let top = 0;
  for (const o of options) {
    const t = norm(o);
    if (!t) continue;
    let score = 0;
    if (t === v) score = 100;
    else if (aliases.includes(t)) score = 95;
    else if (/^(yes|no)$/.test(v)) score = t.startsWith(`${v} `) || t.startsWith(`${v},`) ? 70 : 0;
    else if (t.startsWith(v)) score = 80 - t.length / 100;
    else if (t.includes(v)) score = 60 - t.length / 100;
    else {
      const words = v.split(' ').filter((w) => w.length > 2);
      const hits = words.filter((w) => t.includes(w)).length;
      if (words.length && hits === words.length) score = 50 - t.length / 100;
      else if (hits) score = (hits / words.length) * 30;
    }
    if (score > top) { top = score; best = o; }
  }
  return top >= 25 ? best : null;
}

// What to type in a searchable list to make the right option appear.
const searchTerm = (value) => String(value).replace(/'s degree$/i, '').replace(/\bdegree\b/i, '').split(',')[0].trim();

// Yes/No questions are often worded as sentences ("I am authorized to work…"),
// so match the meaning as well as a plain Yes/No.
const YES_AUTH = /^yes\b|\bi am (legally )?(authori[sz]ed|eligible)|\bauthori[sz]ed to work\b(?!.*\bnot\b)/i;
const NO_SPONSOR = /^no\b|\b(do|will) not (now or in the future )?require|\bdon'?t (need|require)|\bno sponsorship\b/i;
const YES_SPONSOR = /^yes\b|\bi (will|do) (now or in the future )?require|\bneed sponsorship\b/i;
const NO_AUTH = /^no\b|\bnot (legally )?(authori[sz]ed|eligible)/i;
const yesNo = (answer, yes, no) => (opts) => opts.find((o) => (/^y/i.test(answer) ? yes : no).test(o.trim())) || null;

// Most specific questions first: a long question can mention "school" or "country" in passing.
function choiceRules(p) {
  return [
    [/how many years|years of (professional |full[- ]?time |industry |relevant )?experience/, p.yearsExperience],
    [/sponsor/, p.needsSponsorship, yesNo(p.needsSponsorship, YES_SPONSOR, NO_SPONSOR)],
    [/authori[sz]ed|authori[sz]ation to work|legally (eligible|able|permitted)|right to work|eligible to work/, p.workAuthorized, yesNo(p.workAuthorized, YES_AUTH, NO_AUTH)],
    [/(ever|previously) (been )?(employed|worked)|former employee|worked (here|for us) before/, 'No', yesNo('No', /^yes\b/i, /^no\b/i)],
    [/country where you (currently )?(reside|live)|country of residence|^country\b|\bcountry\*?$/, p.country],
    [/location \(city\)|^city\b|current city|which city/, p.location],
    [/^school|\bschool\*?$|university|college|institution/, p.school],
    [/^degree|\bdegree\*?$/, p.degree],
    [/discipline|major|field of study|area of study/, p.discipline],
  ];
}

async function visibleOptions(frame, ms) {
  const options = frame.locator('[role=option]:visible'); // phone widgets keep hidden country lists around
  const ok = await options.first().waitFor({ timeout: ms }).then(() => true).catch(() => false);
  if (!ok) return { options, texts: [] };
  await frame.waitForTimeout(350); // let searched lists settle
  return { options, texts: await options.allTextContents() };
}

async function fillChoices(frame, p) {
  const rules = choiceRules(p);
  const fields = await frame.evaluate(() => {
    const labelOf = (el) => {
      const bits = [el.getAttribute('aria-label')];
      if (el.id) bits.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent);
      const by = el.getAttribute('aria-labelledby');
      if (by) by.split(/\s+/).forEach((id) => bits.push(document.getElementById(id)?.textContent));
      bits.push(el.closest('label')?.textContent);
      return bits.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
    };
    const els = [...document.querySelectorAll('select, input[role=combobox], input[aria-autocomplete]')]
      .filter((el) => !el.disabled && !/search/i.test(el.className) && (el.offsetParent !== null || el.tagName === 'SELECT'));
    return els.map((el, i) => {
      el.setAttribute('data-jr-choice', String(i));
      const control = el.closest('[class*="control"], [class*="select__"]')?.parentElement || el.parentElement;
      const filled = el.tagName === 'SELECT' ? el.selectedIndex > 0 && !!el.value : !!control?.querySelector('[class*="single-value"], [class*="multi-value"]');
      return { i, kind: el.tagName === 'SELECT' ? 'select' : 'combo', label: labelOf(el), filled, options: el.tagName === 'SELECT' ? [...el.options].map((o) => o.text) : [] };
    });
  });
  const done = [];
  for (const f of fields) {
    if (f.filled || !f.label) continue;
    const rule = rules.find(([re]) => re.test(f.label));
    const [, value, chooser] = rule || [];
    if (!value) continue;
    const choose = (texts) => (chooser && chooser(texts)) || bestOption(texts, value);
    const loc = frame.locator(`[data-jr-choice="${f.i}"]`);
    try {
      if (f.kind === 'select') {
        const pick = choose(f.options);
        if (!pick) continue;
        await loc.selectOption({ label: pick });
      } else {
        await loc.scrollIntoViewIfNeeded();
        await loc.click({ timeout: 3000 });
        // Short lists (Yes/No): just open and pick. Long lists: search for it.
        let { options, texts } = await visibleOptions(frame, 1500);
        let pick = texts.length && texts.length < 40 ? choose(texts) : null;
        for (const term of pick ? [] : [searchTerm(value), searchTerm(value).split(' ')[0]]) {
          await loc.fill(term);
          ({ options, texts } = await visibleOptions(frame, 5000));
          pick = choose(texts);
          if (pick) break;
        }
        if (!pick) {
          if (process.env.JOB_RADAR_DEBUG) console.log('no match:', f.label.slice(0, 50), '| wanted', value, '| got', texts.slice(0, 6));
          await loc.fill('').catch(() => {});
          await loc.press('Escape').catch(() => {});
          continue;
        }
        await options.nth(texts.indexOf(pick)).click({ timeout: 3000 });
      }
      await loc.evaluate((el) => {
        const box = el.closest('[class*="control"]') || el;
        box.style.outline = '2px solid #22c55e';
        box.style.outlineOffset = '1px';
      }).catch(() => {});
      done.push(f.label.slice(0, 40));
    } catch (e) {
      if (process.env.JOB_RADAR_DEBUG) console.log('choice failed:', f.label.slice(0, 50), '|', e.message.split('\n')[0]);
      await loc.press('Escape').catch(() => {});
    }
  }
  return done;
}

// files: { resume, cover } are the approved PDFs for this job; coverText is the
// approved letter for forms that want it typed into a box.
// Attaches a PDF to an upload box. Some sites (Workday, for one) run their own
// code when a file is set on the box and crash when it isn't picked by hand
// ("Cannot read properties of undefined (reading 'uploadFile')"). Then the
// file is dropped on the upload area instead, like dragging it from Finder.
export async function attachFile(frame, selector, file) {
  const name = path.basename(file);
  const shows = () => frame.evaluate((n) => document.body.innerText.includes(n), name).catch(() => false);
  let failed = null;
  try {
    await frame.setInputFiles(selector, file, { timeout: 15000 });
    await frame.waitForTimeout(1200);
    if (await shows()) return 'attached';
  } catch (e) { failed = e.message.split('\n')[0]; }
  const dropped = await frame.evaluate(dropFile, { selector, name, b64: fs.readFileSync(file).toString('base64') }).catch(() => false);
  if (dropped) {
    await frame.waitForTimeout(2000);
    if (await shows()) return 'attached';
  }
  if (!failed) return 'attached'; // the site doesn't show file names; it took the file without complaint
  return `couldn't attach it. Drag ${name} onto the upload box yourself (Show PDFs in Finder)`;
}

// Runs in the page: drop the file on the upload area around the input.
function dropFile({ selector, name, b64 }) {
  const input = document.querySelector(selector);
  if (!input) return false;
  let zone = input.parentElement;
  for (let el = input.parentElement, i = 0; el && i < 6; el = el.parentElement, i++) {
    const tag = `${el.getAttribute('data-automation-id') || ''} ${el.className || ''} ${el.id || ''}`;
    if (/drop|upload|attach|dropzone/i.test(tag)) { zone = el; break; }
  }
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], name, { type: 'application/pdf' }));
  for (const type of ['dragenter', 'dragover', 'drop']) {
    zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }
  return true;
}

export async function autofill(url, profile, files = {}) {
  const ctx = await browser();
  let page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.bringToFront();

  let frame = await findFormFrame(page, 8000);
  if (!frame) {
    page = await clickApply(page);
    await page.bringToFront();
    frame = await findFormFrame(page, 15000);
  }
  if (!frame) {
    await page.evaluate(showBanner, 'Job Radar couldn\'t find the application form on this page. Click the site\'s Apply button, then use "Copy cover letter text" and your PDFs from Job Radar.').catch(() => {});
    return { filled: 0, fields: [], noForm: true, resume: 'not attached', cover: null };
  }

  const result = await frame.evaluate(fillPage, { ...profile, coverLetter: files.coverText || profile.coverLetter });
  const attach = async (selector, file, has, label) => {
    if (!file) return `no ${label} yet`;
    if (!fs.existsSync(file)) return `${label} file not found`;
    if (!has) return 'no upload box on this page';
    return attachFile(frame, selector, file);
  };
  const resume = await attach('[data-job-radar-resume]', files.resume || profile.resumePath, result.hasResumeField, 'résumé');
  const cover = files.cover && result.hasCoverField ? await attach('[data-job-radar-cover]', files.cover, true, 'cover letter') : null;
  const picked = await fillChoices(frame, profile).catch(() => []);
  result.filled.push(...picked);
  const n = result.filled.length;
  await page.evaluate(showBanner, n
    ? `Job Radar filled ${n} field${n === 1 ? '' : 's'} (outlined in green)${resume === 'attached' ? ' and attached your résumé' : ''}. Answer the questions left, check everything, then press Submit yourself.`
    : 'Job Radar found the form but couldn\'t match any fields. Fill it in by hand; your PDFs and cover letter are in Job Radar.').catch(() => {});
  const first = frame.locator('[style*="outline: 2px solid"]').first();
  if (await first.count()) await first.scrollIntoViewIfNeeded().catch(() => {});
  return { filled: n, fields: result.filled, resume, cover };
}

// On shutdown: leave the Job Radar Chrome open (just let go of it). Only a
// Chrome that Job Radar runs itself (the fallback) is closed.
export async function closeBrowser() {
  if (cdp) return;
  if (context) await context.close().catch(() => {});
}
