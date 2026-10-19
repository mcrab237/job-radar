// Opening Job Radar from another device (your laptop). Off by default. When on,
// other devices must enter an access code once; this Mac never needs it.
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { load, save } from './store.js';

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// Local means: from this Mac AND addressed to localhost. Tailscale can forward
// laptop traffic so it arrives from 127.0.0.1, but it keeps the laptop's Host.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
export const isLocal = (req) => LOCAL.has(req.socket.remoteAddress) && LOCAL_HOST.test(req.headers.host || '');

const newCode = () => `${crypto.randomInt(1000, 9999)}-${crypto.randomInt(1000, 9999)}`;
const tokenOf = (code) => crypto.createHash('sha256').update(`job-radar:${code}`).digest('hex');

export function access() {
  const db = load();
  if (!db.settings.remote?.code) {
    db.settings.remote = { enabled: false, ...(db.settings.remote || {}), code: newCode() };
    save();
  }
  return db.settings.remote;
}

export function setAccess({ enabled, newCode: fresh }) {
  const a = access();
  if (typeof enabled === 'boolean') a.enabled = enabled;
  if (fresh) a.code = newCode(); // signs out every other device
  save();
  return a;
}

// ---------- Tailscale (runs in the background as com.jobradar.tailscaled) ----------
const TS_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'tailscale-jobradar');
const TS_BIN = '/opt/homebrew/bin/tailscale';
const ts = (args) => new Promise((resolve) => {
  execFile(TS_BIN, [`--socket=${path.join(TS_DIR, 'tailscaled.sock')}`, ...args], { timeout: 8000 }, (err, out) => resolve(err ? null : out));
});

// { installed, state: 'Running' | 'NeedsLogin' | ..., ip, name }
export async function tailscaleStatus() {
  const out = await ts(['status', '--json']);
  if (!out) return { installed: false };
  try {
    const d = JSON.parse(out);
    return {
      installed: true,
      state: d.BackendState,
      ip: d.Self?.TailscaleIPs?.find((x) => x.includes('.')) || null,
      name: (d.Self?.DNSName || '').replace(/\.$/, '') || null,
      loginUrl: d.AuthURL || null,
    };
  } catch { return { installed: true, state: 'Unknown' }; }
}

// Starts sign-in and returns the link to open (on any device).
export function tailscaleLoginLink() {
  return new Promise((resolve) => {
    const p = spawn(TS_BIN, [`--socket=${path.join(TS_DIR, 'tailscaled.sock')}`, 'up', `--hostname=job-radar-${os.hostname().split('.')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-')}`, '--force-reauth'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const done = (v) => { resolve(v); p.stdout.removeAllListeners(); p.stderr.removeAllListeners(); p.unref(); };
    const look = (c) => { buf += c; const m = buf.match(/https:\/\/login\.tailscale\.com\/\S+/); if (m) done(m[0]); };
    p.stdout.on('data', look);
    p.stderr.on('data', look);
    setTimeout(() => done(null), 10000);
  });
}

// Addresses your laptop can use: the Mac's name on your Wi-Fi, its IP, and a
// Tailscale address (100.x.x.x) if Tailscale is running.
export function addresses(port) {
  const host = os.hostname().replace(/\.local$/, '');
  const urls = [{ label: 'On your home Wi-Fi', url: `http://${host}.local:${port}` }];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      if (n.address.startsWith('100.')) urls.push({ label: 'From anywhere (Tailscale)', url: `http://${n.address}:${port}` });
      else urls.push({ label: 'On your home Wi-Fi (IP)', url: `http://${n.address}:${port}` });
    }
  }
  return urls;
}

function hasCookie(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)jr_access=([a-f0-9]{64})/);
  if (!m) return false;
  const want = Buffer.from(tokenOf(access().code));
  const got = Buffer.from(m[1]);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const tries = new Map(); // ip -> [timestamps], to slow down guessing

const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Job Radar</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 15px/1.5 -apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif;
    background: radial-gradient(700px 400px at 80% -10%, rgba(45,212,191,.18), transparent 60%), radial-gradient(600px 400px at 10% 110%, rgba(129,140,248,.22), transparent 60%), #0b1120; color: #e8ecf4; }
  form { width: min(340px, calc(100vw - 32px)); padding: 28px; border-radius: 16px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(10px); }
  h1 { margin: 0 0 4px; font-size: 20px; } p { margin: 0 0 18px; color: #9aa4bb; font-size: 13.5px; }
  input { width: 100%; box-sizing: border-box; height: 44px; border-radius: 10px; border: 1px solid rgba(255,255,255,.18); background: rgba(0,0,0,.25); color: #fff; font-size: 18px; letter-spacing: .15em; text-align: center; outline: none; }
  input:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,.3); }
  button { margin-top: 12px; width: 100%; height: 42px; border: 0; border-radius: 10px; font-weight: 600; font-size: 14px; color: #fff; cursor: pointer; background: linear-gradient(135deg, #6d78f0, #4f5bc4); }
  .err { color: #fda4af; font-size: 13px; margin-top: 10px; }
</style></head><body>${body}</body></html>`;

function loginPage(res, error = '') {
  res.writeHead(error ? 401 : 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(page(`<form method="post" action="/__login">
    <h1>Job Radar</h1><p>Enter the access code shown in Settings on your Mac mini.</p>
    <input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="1234-5678" autofocus aria-label="Access code">
    <button type="submit">Open</button>${error ? `<div class="err">${error}</div>` : ''}
  </form>`));
}

const readForm = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 2000) req.destroy(); });
  req.on('end', () => resolve(new URLSearchParams(s)));
});

// Returns true when it answered the request itself (blocked, or the login page).
export async function gate(req, res, url) {
  if (isLocal(req)) return false;
  const a = access();
  if (!a.enabled) {
    res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page('<form><h1>Job Radar</h1><p>Opening Job Radar from other devices is turned off. Turn it on in Settings on your Mac mini.</p></form>'));
    return true;
  }
  if (url.pathname === '/__login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress;
    const recent = (tries.get(ip) || []).filter((t) => Date.now() - t < 60_000);
    if (recent.length >= 8) { loginPage(res, 'Too many tries. Wait a minute.'); return true; }
    const code = ((await readForm(req)).get('code') || '').replace(/\s/g, '');
    if (code !== a.code && code !== a.code.replace('-', '')) {
      tries.set(ip, [...recent, Date.now()]);
      loginPage(res, 'That code isn\'t right.');
      return true;
    }
    res.writeHead(302, { location: '/', 'set-cookie': `jr_access=${tokenOf(a.code)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` });
    res.end();
    return true;
  }
  if (hasCookie(req)) return false;
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Enter the access code first.' }));
    return true;
  }
  loginPage(res);
  return true;
}

// Things that act on this Mac itself (opening Chrome or VS Code here).
export const MAC_ONLY = /\/(autofill|reveal|open-kit|reveal-data)$/;
