// Turns the résumé / cover letter HTML into a real, text-based PDF (the kind
// applicant tracking systems can read) using Chrome in the background.
import fs from 'node:fs';
import path from 'node:path';
import { renderResume, renderCover } from '../public/resume-render.js';

const CSS = fs.readFileSync(new URL('../public/resume.css', import.meta.url), 'utf8');
let browser = null;

async function getBrowser() {
  if (browser?.isConnected()) return browser;
  const { chromium } = await import('playwright-core');
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0.45in 0.5in; }
  html, body { margin: 0; background: #fff; }
  ${CSS}
</style></head><body>${body}</body></html>`;

// Shrinks the text a little at a time until everything fits on one page.
async function render(html, file, { start = 10.5, min = 8.5, step = 0.25 } = {}) {
  const b = await getBrowser();
  const p = await b.newPage();
  try {
    await p.setViewportSize({ width: 720, height: 1000 }); // 7.5in of usable width at 96px per inch
    await p.setContent(page(html), { waitUntil: 'load' });
    const usable = (11 - 0.9) * 96 - 4;
    let size = start;
    for (; size >= min; size -= step) {
      const h = await p.evaluate((s) => {
        const el = document.querySelector('.resume');
        el.style.setProperty('--r-size', `${s}pt`);
        if (el.classList.contains('cover')) el.style.fontSize = `${s}pt`;
        return el.scrollHeight;
      }, size);
      if (h <= usable) break;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.pdf({ path: file, format: 'Letter', printBackground: true, preferCSSPageSize: true });
    return { file, fontSize: Math.max(size, min), onePage: size >= min };
  } finally {
    await p.close();
  }
}

export const resumePdf = (resume, file) => render(renderResume(resume), file);
export const coverPdf = (resume, text, file) => render(
  renderCover(resume, text, new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })),
  file, { start: 11, min: 9.5 },
);

export async function closePdf() {
  if (browser) await browser.close().catch(() => {});
}
