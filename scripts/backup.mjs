// Nightly backup to iCloud Drive: your data (without the OpenAI key) and your
// application PDFs. Keeps the last 14 days. Runs at 3:15 am (com.jobradar.backup);
// run it yourself any time with: node scripts/backup.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const DATA = new URL('../data/', import.meta.url).pathname;
const DEST = path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Job Radar Backups');
const KEEP = 14;
const day = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

fs.mkdirSync(DEST, { recursive: true });
const db = JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'));
if (db.settings) delete db.settings.openaiKey;
fs.writeFileSync(path.join(DEST, `job-radar-${day}.json.gz`), zlib.gzipSync(JSON.stringify(db)));

// PDFs: one mirrored folder (they're small and only ever added).
if (fs.existsSync(path.join(DATA, 'applications'))) {
  fs.cpSync(path.join(DATA, 'applications'), path.join(DEST, 'applications'), { recursive: true });
}

const old = fs.readdirSync(DEST).filter((f) => /^job-radar-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).sort().slice(0, -KEEP);
for (const f of old) fs.rmSync(path.join(DEST, f));

fs.writeFileSync(path.join(DEST, 'HOW TO RESTORE.txt'), `Job Radar backups (one per night, last ${KEEP} days).

To restore:
1. Stop Job Radar:  launchctl bootout gui/$(id -u)/com.jobradar.server
2. Unzip the newest file:  gunzip -k "job-radar-YYYY-MM-DD.json.gz"
3. Copy it over:  cp "job-radar-YYYY-MM-DD.json" ~/Projects/job-radar/data/db.json
4. Copy the applications folder back to ~/Projects/job-radar/data/applications
5. Start it again:  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jobradar.server.plist
6. Paste your OpenAI key in Settings again (it isn't stored in backups).
`);
console.log(`${new Date().toISOString()} backed up to ${DEST} (${old.length} old removed)`);
