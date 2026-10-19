// The résumé shown as a real page. Click any text to change it; hover a bullet
// to remove it, or add one under a job.
import { renderResume } from '/resume-render.js';
import { $, $$, setPath, getPath } from '/ui.js';

const PAGE_PX = (11 - 0.9) * 96; // usable height of one Letter page

export function mountPaper(wrap, resume, onChange) {
  wrap.innerHTML = '<div class="paper-wrap"><div class="paper"></div></div><p class="paper-note" hidden></p>';
  const paper = $('.paper', wrap);
  const note = $('.paper-note', wrap);

  let scale = 1;
  const fit = () => {
    const room = $('.paper-wrap', wrap).clientWidth - 36;
    scale = Math.min(1, room / 816);
    paper.style.zoom = scale < 1 ? String(scale) : '';
  };
  const checkLength = () => {
    const h = ($('.resume', paper)?.getBoundingClientRect().height || 0) / scale;
    // The PDF shrinks text a little to fit one page; warn only when it would get hard to read.
    const over = h * 0.9 > PAGE_PX;
    note.hidden = !over;
    if (over) note.textContent = 'This is running long. To fit one page the PDF text will be small. Removing a bullet or two keeps it easy to read.';
  };

  const draw = () => {
    paper.innerHTML = renderResume(resume, { editable: true });
    $$('.ed', paper).forEach((el) => {
      el.addEventListener('input', () => {
        setPath(resume, el.dataset.path, el.textContent.replace(/\s*\n\s*/g, ' '));
        onChange(resume);
        checkLength();
      });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
    });
    $$('[data-tool]', paper).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.tool === 'add') {
        getPath(resume, b.dataset.path).push('');
        draw();
        const items = $$(`[data-path^="${b.dataset.path}."]`, paper);
        items.at(-1)?.focus();
      } else {
        const parts = b.dataset.path.split('.');
        const i = Number(parts.pop());
        getPath(resume, parts.join('.')).splice(i, 1);
        draw();
      }
      onChange(resume);
    }));
    checkLength();
  };

  fit();
  draw();
  const ro = new ResizeObserver(fit);
  ro.observe($('.paper-wrap', wrap));
  return { redraw: draw };
}
