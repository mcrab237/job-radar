// Removing a job: pick a reason (it teaches the picks), the job goes to the
// Removed archive on the Jobs page, and today's slot gets a better job.
import { esc, enc, api, toast } from '/ui.js';

const REASONS = [
  ['stack', 'Not my stack'],
  ['senior', 'Too senior'],
  ['pay', 'Pay too low'],
  ['place', 'Wrong location'],
  ['company', 'Not this company'],
  ['meh', 'Not interested'],
];

let menu = null;
const closeMenu = () => { menu?.remove(); menu = null; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey); };
const outside = (e) => { if (menu && !menu.contains(e.target)) closeMenu(); };
const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };

// Shows the reason menu next to `anchor`. Calls onDone(result) after removing.
export function askRemove(job, anchor, onDone) {
  closeMenu();
  menu = document.createElement('div');
  menu.className = 'rm-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="rm-head">Why remove it?<span>Picks learn from this.</span></div>
    ${REASONS.map(([k, l]) => `<button type="button" role="menuitem" data-reason="${k}">${l}${k === 'company' ? `<small>Hides every ${esc(job.company)} job</small>` : ''}</button>`).join('')}`;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  menu.style.top = `${r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', onKey); });
  menu.querySelector('button').focus();
  menu.querySelectorAll('[data-reason]').forEach((b) => b.onclick = async () => {
    menu.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    b.innerHTML = '<span class="spinner"></span> Finding a better job…';
    try {
      const r = await api(`jobs/${enc(job.uid)}/remove`, { method: 'POST', body: { reason: b.dataset.reason } });
      closeMenu();
      const t = toast(r.replacement
        ? `Removed. In its place: <b>${esc(r.replacement.title)}</b> at ${esc(r.replacement.company)}. <span class="muted">${esc(r.replacement.why)}</span> <a href="#" data-undo>Undo</a>`
        : 'Removed. It\'s in Jobs → Removed. <a href="#" data-undo>Undo</a>', { ms: 9000 });
      t.querySelector('[data-undo]')?.addEventListener('click', async (e) => {
        e.preventDefault();
        t.remove();
        await api(`jobs/${enc(job.uid)}/restore`, { method: 'POST' });
        onDone?.({ restored: true });
      });
      onDone?.(r);
    } catch (e) {
      closeMenu();
      toast(esc(e.message), { error: true });
    }
  });
}
