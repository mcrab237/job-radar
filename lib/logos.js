// Company logos: downloaded once into data/logos and served from there, so
// pages load fast and don't call out to other sites. Companies without a clear
// website (or with a tiny, blurry icon) keep their letter tile.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './store.js';

const DIR = path.join(dataDir, 'logos');
const DOMAINS = JSON.parse(fs.readFileSync(new URL('./domains.json', import.meta.url), 'utf8'));
// Job Radar shows short names ("Block", not "Block (Square / Cash App)").
const short = (n) => String(n || '').replace(/ \(.*\)$/, '').trim().toLowerCase();
const BY_NAME = Object.fromEntries(Object.entries(DOMAINS).map(([n, d]) => [short(n), d]));
const have = new Set();

export function logoFor(company) {
  const d = BY_NAME[short(company)];
  return d && have.has(d) ? `/logos/${d}.png` : null;
}

export const logoFile = (name) => {
  const f = path.join(DIR, path.basename(name));
  return f.startsWith(DIR) && fs.existsSync(f) ? f : null;
};

// PNG width from its header (bytes 16–19), so tiny icons can be skipped.
const pngWidth = (buf) => (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG' ? buf.readUInt32BE(16) : 0);

async function getPng(url, minWidth) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36' } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return pngWidth(buf) >= minWidth ? buf : null;
  } catch {
    return null;
  }
}

// Best first: Google's 128px icon, then the site's own Apple touch icon (usually
// 180px), then a 64px icon that's at least 32px (the size tiles are shown at).
async function fetchOne(domain) {
  const g = (size) => `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=${size}`;
  const buf = await getPng(g(128), 48)
    || await getPng(`https://${domain}/apple-touch-icon.png`, 48)
    || await getPng(`https://www.${domain}/apple-touch-icon.png`, 48)
    || await getPng(g(64), 32);
  if (!buf) return false;
  fs.writeFileSync(path.join(DIR, `${domain}.png`), buf);
  return true;
}

// Downloads any logos we don't have yet (a few at a time). Safe to call on every start.
export async function syncLogos() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR)) if (f.endsWith('.png')) have.add(f.slice(0, -4));
  const todo = [...new Set(Object.values(DOMAINS))].filter((d) => !have.has(d));
  let got = 0;
  const worker = async () => {
    while (todo.length) {
      const d = todo.shift();
      if (await fetchOne(d)) { have.add(d); got++; }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return { total: have.size, new: got };
}
