// Draws a résumé or cover letter as HTML. The app uses it for the editable
// preview and the server uses the same code to make the PDF, so what you see
// is what gets sent.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// In the app every piece of text can be clicked and edited. data-path says
// where in the résumé data the text belongs, e.g. "experience.0.bullets.2".
function t(value, path, editable, tag = 'span', cls = '') {
  if (!editable) return `<${tag}${cls ? ` class="${cls}"` : ''}>${esc(value)}</${tag}>`;
  return `<${tag} class="${cls} ed" contenteditable="plaintext-only" spellcheck="true" data-path="${path}">${esc(value)}</${tag}>`;
}

const contactLines = (c = {}) => [
  [c.location, c.phone, c.email].filter(Boolean),
  [c.website, c.github, c.linkedin].filter(Boolean),
];

export function renderHeader(r, editable = false) {
  const c = r.contact || {};
  const keys1 = ['location', 'phone', 'email'].filter((k) => c[k]);
  const keys2 = ['website', 'github', 'linkedin'].filter((k) => c[k]);
  const line = (keys) => keys.map((k) => t(c[k], `contact.${k}`, editable)).join('<span class="sep"> | </span>');
  return `
    <header class="r-head">
      ${t(r.name, 'name', editable, 'h1', 'r-name')}
      ${t(r.headline, 'headline', editable, 'div', 'r-headline')}
      ${keys1.length ? `<div class="r-contact">${line(keys1)}</div>` : ''}
      ${keys2.length ? `<div class="r-contact">${line(keys2)}</div>` : ''}
    </header>`;
}

export function renderResume(r, { editable = false } = {}) {
  if (!r) return '';
  const tools = (path, kind) => editable ? `<span class="r-tools" contenteditable="false"><button type="button" data-tool="${kind}" data-path="${path}" title="${kind === 'add' ? 'Add a bullet' : 'Remove'}">${kind === 'add' ? '+' : '×'}</button></span>` : '';
  return `
  <article class="resume">
    ${renderHeader(r, editable)}
    ${r.summary || editable ? `<section><h2>Summary</h2>${t(r.summary, 'summary', editable, 'p', 'r-summary')}</section>` : ''}
    ${(r.skills || []).length ? `<section><h2>Technical Skills</h2>
      ${(r.skills || []).map((s, i) => `<div class="r-skill">${t(s.label, `skills.${i}.label`, editable, 'b')}<b>:</b> ${t(s.items, `skills.${i}.items`, editable)}</div>`).join('')}
    </section>` : ''}
    ${(r.experience || []).length ? `<section><h2>Experience</h2>
      ${(r.experience || []).map((x, i) => `
        <div class="r-job">
          <div class="r-row">${t(x.company, `experience.${i}.company`, editable, 'b', 'r-company')}${t(x.dates, `experience.${i}.dates`, editable, 'span', 'r-dates')}</div>
          ${x.role || editable ? `<div class="r-role">${t(x.role, `experience.${i}.role`, editable)}</div>` : ''}
          <ul>${(x.bullets || []).map((b, j) => `<li>${t(b, `experience.${i}.bullets.${j}`, editable)}${tools(`experience.${i}.bullets.${j}`, 'remove')}</li>`).join('')}</ul>
          ${tools(`experience.${i}.bullets`, 'add')}
        </div>`).join('')}
    </section>` : ''}
    ${(r.projects || []).length ? `<section><h2>Projects</h2>
      ${(r.projects || []).map((x, i) => `
        <div class="r-job">
          <div class="r-row">${t(x.name, `projects.${i}.name`, editable, 'b', 'r-company')}${t(x.dates, `projects.${i}.dates`, editable, 'span', 'r-dates')}</div>
          <ul>${(x.bullets || []).map((b, j) => `<li>${t(b, `projects.${i}.bullets.${j}`, editable)}${tools(`projects.${i}.bullets.${j}`, 'remove')}</li>`).join('')}</ul>
        </div>`).join('')}
    </section>` : ''}
    ${(r.education || []).length ? `<section><h2>Education</h2>
      ${(r.education || []).map((x, i) => `
        <div class="r-job">
          <div class="r-row">${t(x.school, `education.${i}.school`, editable, 'b', 'r-company')}${t(x.dates, `education.${i}.dates`, editable, 'span', 'r-dates')}</div>
          ${x.details || editable ? t(x.details, `education.${i}.details`, editable, 'div', 'r-edu') : ''}
        </div>`).join('')}
    </section>` : ''}
  </article>`;
}

export function renderCover(r, text, date) {
  const paras = String(text || '').split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  return `
  <article class="resume cover">
    ${renderHeader(r)}
    <div class="c-date">${esc(date)}</div>
    <div class="c-body">${paras}</div>
  </article>`;
}

export const plainContact = (r) => contactLines(r.contact).map((l) => l.join(' | ')).join('\n');
