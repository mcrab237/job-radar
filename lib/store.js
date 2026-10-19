// Everything lives in one JSON file in ./data so it is easy to back up or reset.
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.env.JOB_RADAR_DATA || new URL('../data', import.meta.url).pathname);
const FILE = path.join(DIR, 'db.json');

export const DEFAULT_SETTINGS = {
  keywords: ['frontend', 'react', 'software engineer'],
  exclude: ['senior staff', 'principal', 'director', 'intern'],
  locations: ['Remote', 'United States'],
  remoteOnly: false,
  intervalMinutes: 5,
  macNotifications: true,
  ntfyTopic: '',
  openaiKey: '',
  aiModel: '',
  aiModelLight: '',
  skillsBank: [],
  dailyGoal: 12,
  profile: {
    firstName: '', lastName: '', email: '', phone: '', location: '',
    linkedin: '', github: '', website: '', resumePath: '',
    workAuthorized: 'Yes', needsSponsorship: 'No', salary: '', coverLetter: '',
    preferredName: '', country: 'United States', school: '', degree: '', discipline: '', gradYear: '', yearsExperience: '',
  },
};

let db = null;
let saveTimer = null;

export function load() {
  if (db) return db;
  fs.mkdirSync(DIR, { recursive: true });
  try {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    db = { sources: [], jobs: {} };
  }
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}), profile: { ...DEFAULT_SETTINGS.profile, ...(db.settings?.profile || {}) } };
  db.sources ||= [];
  db.resumes ||= [];
  db.coverSample ||= '';
  db.jobs ||= {};
  return db;
}

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

export function flush() {
  clearTimeout(saveTimer);
  if (!db) return;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

export const dataDir = DIR;
