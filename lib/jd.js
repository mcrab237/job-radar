// Gets the full job description for a job, so the résumé can be tailored to it.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';

const getJson = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export function htmlToText(html) {
  return String(html || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h\d|li|ul|ol|section|tr)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim();
}

// Text of the job plus anything else the page knows (full location list on Workday).
export async function fetchDetails(job, source) {
  if (job.type === 'workday' && source?.token) {
    const { parseWorkday } = await import('./sources.js');
    const w = parseWorkday(source.token);
    const ext = job.extId || job.uid.slice(job.uid.indexOf(':') + 1);
    const d = await getJson(`${w.host}/wday/cxs/${w.tenant}/${w.site}${ext}`);
    const info = d.jobPostingInfo || {};
    const location = [info.location, ...(info.additionalLocations || [])].filter(Boolean).join(' · ');
    return { text: htmlToText(info.jobDescription), location, remote: /remote/i.test(`${info.remoteType || ''} ${location}`) };
  }
  return { text: await fetchDescription(job, source) };
}

export async function fetchDescription(job, source) {
  const ext = job.extId || job.uid.slice(job.uid.indexOf(':') + 1);
  const token = source?.token;
  if (job.type === 'workday') return (await fetchDetails(job, source)).text;
  try {
    if (job.type === 'greenhouse') {
      const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${ext}`);
      return htmlToText(d.content);
    }
    if (job.type === 'lever') {
      const d = await getJson(`https://api.lever.co/v0/postings/${token}/${ext}`);
      const lists = (d.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join('\n\n');
      return [d.descriptionPlain || htmlToText(d.description), lists, d.additionalPlain || ''].filter(Boolean).join('\n\n');
    }
    if (job.type === 'ashby') {
      const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
      const j = (d.jobs || []).find((x) => x.id === ext);
      if (j) return j.descriptionPlain || htmlToText(j.descriptionHtml);
    }
    if (job.type === 'smartrecruiters') {
      const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${token}/postings/${ext}`);
      const s = d.jobAd?.sections || {};
      return ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
        .map((k) => s[k] && `${s[k].title || ''}\n${htmlToText(s[k].text)}`).filter(Boolean).join('\n\n');
    }
    if (job.type === 'remotive') {
      const d = await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(job.title)}`);
      const j = (d.jobs || []).find((x) => String(x.id) === ext);
      if (j) return htmlToText(j.description);
    }
    if (job.type === 'remoteok') {
      const d = await getJson('https://remoteok.com/api');
      const j = d.find((x) => String(x?.id) === ext);
      if (j?.description) return htmlToText(j.description);
    }
  } catch {
    // fall through to reading the page itself
  }
  const r = await fetch(job.url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Couldn't open the job page (HTTP ${r.status}). Paste the description in yourself.`);
  const html = await r.text();
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<body[\s\S]*<\/body>/i)?.[0] || html;
  const text = htmlToText(main);
  if (text.length < 300) throw new Error('That page loads its text with JavaScript, so it couldn\'t be read. Paste the description in yourself.');
  return text.slice(0, 20000);
}
