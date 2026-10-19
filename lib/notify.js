// Alerts: a Mac notification, plus an optional push to your phone through
// ntfy.sh (free app; pick a long random topic name so only you get them).
import { execFile } from 'node:child_process';

const esc = (s) => String(s || '').replace(/["\\]/g, '\\$&').slice(0, 200);
let terminalNotifier = null;
execFile('which', ['terminal-notifier'], (err, out) => { if (!err) terminalNotifier = out.trim(); });

function mac(title, body, url) {
  if (process.platform !== 'darwin') return;
  if (terminalNotifier) {
    // Clicking this one opens the job straight away.
    execFile(terminalNotifier, ['-title', title, '-message', body, '-open', url, '-sound', 'Glass', '-group', 'job-radar'], () => {});
  } else {
    execFile('osascript', ['-e', `display notification "${esc(body)}" with title "${esc(title)}" sound name "Glass"`], () => {});
  }
}

async function ntfy(topic, title, body, url) {
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      body,
      headers: { Title: title.replace(/[^\x20-\x7e]/g, ''), Click: url, Tags: 'briefcase', Priority: 'high' },
      signal: AbortSignal.timeout(10000),
    });
  } catch {}
}

export function notify(jobs, settings, { test = false } = {}) {
  const dashboard = `http://localhost:${process.env.PORT || 4870}`;
  let title, body, url;
  if (test) {
    title = 'Job Radar is working';
    body = 'This is what an alert for a new job will look like.';
    url = dashboard;
  } else if (jobs.length === 1) {
    const j = jobs[0];
    title = `New job: ${j.company}`;
    body = `${j.title}${j.location ? ` · ${j.location}` : ''}`;
    url = j.applyUrl || j.url;
  } else {
    title = `${jobs.length} new jobs match`;
    body = jobs.slice(0, 4).map((j) => `${j.company}: ${j.title}`).join('\n');
    url = dashboard;
  }
  if (settings.macNotifications) mac(title, body, url);
  // On the phone, localhost means nothing: tapping opens the best job's posting instead.
  if (settings.ntfyTopic) ntfy(settings.ntfyTopic, title, body, test || jobs.length === 1 ? url : (jobs[0].applyUrl || jobs[0].url || url));
}
