// Read a job's full description without leaving Job Radar. Anything with
// data-jd="<uid>" opens it; arrows (or ‹ ›) move through the other jobs on the page.
import { $, esc, enc, api, avatar, ago, icons } from '/ui.js';

const money = (n) => `$${Math.round(n / 1000)}k`;
const LEVEL = { entry: 'Entry level', mid: 'Mid level', senior: 'Senior', lead: 'Lead' };
const PLACE = { remote: 'Remote (US)', atlanta: 'Atlanta', relocate: 'Relocate' };
const LANG = { js: ['badge-pay', 'TypeScript/JS'], any: ['badge-status', 'Other languages OK'], unknown: ['badge-pay-domain', 'Language not stated'] };

function chips(job) {
  const f = job.fit || {};
  return [
    f.salary && `<span class="badge badge-pay" title="${f.salary.source === 'posted' ? 'From the job posting' : 'Estimate from the company and level'}">${money(f.salary.min)}–${money(f.salary.max)}${f.salary.source === 'posted' ? '' : ' est.'}</span>`,
    f.level && `<span class="badge badge-status">${LEVEL[f.level]}</span>`,
    f.years != null && `<span class="badge ${{ good: 'badge-pay', stretch: 'badge-pay-domain' }[f.yearsFit] || 'badge-status'}">${f.years}+ yrs${f.yearsFit === 'stretch' ? ' · stretch' : ''}</span>`,
    LANG[f.lang] && `<span class="badge ${LANG[f.lang][0]}">${LANG[f.lang][1]}</span>`,
    f.place && `<span class="badge badge-remote">${PLACE[f.place]}</span>`,
    f.payments && '<span class="badge badge-pay-domain">Payments</span>',
    (job.postedAt || job.firstSeen) && `<span class="jd-when">${job.postedAt ? 'Posted' : 'Seen'} ${ago(job.postedAt || job.firstSeen)}</span>`,
  ].filter(Boolean).join('');
}

// Marks what you scan for first: years asked, your languages, pay.
const highlight = (s) => s
  .replace(/\b\d+(?:\.\d+)?\s*\+?\s*(?:(?:-|–|to)\s*\d+\s*\+?\s*)?(?:years?|yrs)\b/gi, '<mark class="jd-yrs">$&</mark>')
  .replace(/\b(TypeScript|JavaScript|Node(?:\.js)?|React)\b/g, '<b class="jd-lang">$1</b>')
  .replace(/\$\s?\d[\d,.]*\s?[kK]?(?:\s*(?:-|–|to)\s*\$?\s?\d[\d,.]*\s?[kK]?)?/g, '<mark class="jd-pay">$&</mark>');

const BULLET = /^\s*(?:[•·▪◦‣*-]|\d+[.)])\s+/;
// A short line with no sentence ending, followed by a list or ending in ":".
const isHeading = (line, next) => {
  const t = line.trim();
  if (t.length < 4 || t.length > 70 || t.split(/\s+/).length > 9 || /[.,;!?]$/.test(t) || BULLET.test(t)) return false;
  return /:$/.test(t) || BULLET.test(next || '') || /^[A-Z][^a-z]*$/.test(t) || /^(about|what|who|why|how|your|our|the role|responsibilities|requirements|qualifications|benefits|compensation|nice|bonus|preferred|minimum|basic|you)/i.test(t);
};

export function formatJd(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (BULLET.test(line)) {
      (list ||= []).push(`<li>${highlight(esc(line.replace(BULLET, '')))}</li>`);
      return;
    }
    close();
    out.push(isHeading(line, next) ? `<h3>${esc(line.replace(/\s*:$/, ''))}</h3>` : `<p>${highlight(esc(line))}</p>`);
  });
  close();
  return out.join('');
}

const cache = new Map();
async function load(uid) {
  if (!cache.has(uid)) cache.set(uid, api(`jobs/${enc(uid)}`).then((r) => r.job).catch((e) => { cache.delete(uid); throw e; }));
  return cache.get(uid);
}

let dialog = null;

export async function openJob(uid, { list = [] } = {}) {
  dialog?.close();
  const d = document.createElement('dialog');
  d.className = 'modal jd-dialog';
  dialog = d;
  document.body.appendChild(d);
  d.showModal();
  let at = Math.max(0, list.indexOf(uid));
  if (!list.length) list = [uid];

  const show = async () => {
    const id = list[at];
    d.innerHTML = '<div class="jd-loading"><span class="spinner"></span>Loading the job…</div>';
    let job;
    try { job = await load(id); } catch (e) {
      d.innerHTML = `<div class="jd-loading">${esc(e.message)} <button class="btn btn-sm" data-close>Close</button></div>`;
      $('[data-close]', d).onclick = () => d.close();
      return;
    }
    if (dialog !== d || list[at] !== id) return;
    const onThisJob = location.hash === `#apply/${enc(id)}`;
    const applied = ['applied', 'interview', 'offer'].includes(job.status);
    d.innerHTML = `
      <header class="jd-head">
        ${avatar(job.company, job.logo)}
        <div class="grow">
          <h2>${esc(job.title)}</h2>
          <div class="sub">${esc(job.company)}${job.location ? ` · ${esc(job.location)}` : ''}</div>
        </div>
        <button class="btn btn-ghost btn-icon" data-close title="Close (Esc)" aria-label="Close">${icons.x}</button>
      </header>
      <div class="jd-chips">${chips(job)}</div>
      <article class="jd-text" tabindex="0">${job.app?.jd ? formatJd(job.app.jd) : '<div class="jd-loading"><span class="spinner"></span>Getting the description from the posting…</div>'}</article>
      <footer class="jd-foot">
        ${list.length > 1 ? `<div class="jd-nav">
          <button class="btn btn-ghost btn-icon" data-step="-1" ${at === 0 ? 'disabled' : ''} title="Previous job (←)" aria-label="Previous job">‹</button>
          <span>${at + 1} of ${list.length}</span>
          <button class="btn btn-ghost btn-icon" data-step="1" ${at === list.length - 1 ? 'disabled' : ''} title="Next job (→)" aria-label="Next job">›</button>
        </div>` : ''}
        <div class="grow"></div>
        ${job.url ? `<a class="btn" href="${esc(job.url)}" target="_blank" rel="noopener">View posting ${icons.ext}</a>` : ''}
        ${onThisJob ? '<button class="btn btn-primary" data-close>Back to applying</button>'
          : `<a class="btn btn-primary" href="#apply/${enc(id)}" data-go>${applied ? 'Open application' : 'Start applying'}</a>`}
      </footer>`;
    d.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => d.close());
    d.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => go(+b.dataset.step));
    $('[data-go]', d)?.addEventListener('click', () => d.close());
    $('.jd-text', d).focus({ preventScroll: true });
    if (list[at + 1]) load(list[at + 1]).catch(() => {});

    if (!job.app?.jd) {
      try {
        const r = await api(`jobs/${enc(id)}/jd`, { method: 'POST' });
        job.app = { ...(job.app || {}), jd: r.job.app?.jd || '' };
      } catch {}
      if (dialog !== d || list[at] !== id) return;
      $('.jd-text', d).innerHTML = job.app?.jd ? formatJd(job.app.jd)
        : `<p class="hint">Couldn't get the description from this posting.${job.url ? ` <a href="${esc(job.url)}" target="_blank" rel="noopener">Read it on their site</a>, or paste it in step 1 of the job page.` : ''}</p>`;
    }
  };
  const go = (step) => {
    const n = at + step;
    if (n < 0 || n >= list.length) return;
    at = n;
    show();
  };

  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // click outside
  d.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  });
  d.addEventListener('close', () => { d.remove(); if (dialog === d) dialog = null; });
  show();
}

// One listener for the whole app. Cmd/Ctrl-click still opens the link normally.
export function wireJobPreviews() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-jd]');
    if (!el || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || el.closest('dialog')) return;
    e.preventDefault();
    const list = [...new Set([...document.querySelectorAll('#view [data-jd]')].map((x) => x.dataset.jd))];
    openJob(el.dataset.jd, { list });
  });
}
