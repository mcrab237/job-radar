// Any job: for openings that aren't in your list (a referral, a LinkedIn post,
// a recruiter's message). Paste the description and, if you have one, someone
// on the team and their post; you get a tailored résumé and an InMail.
import { $, $$, esc, enc, api, toast } from '/ui.js';
import { quickStart } from '/apply.js';

const DRAFT = 'quick-draft';
const readDraft = () => { try { return JSON.parse(sessionStorage.getItem(DRAFT) || '{}'); } catch { return {}; } };
const saveDraft = (d) => { try { sessionStorage.setItem(DRAFT, JSON.stringify(d)); } catch {} };

export function renderQuick(view, { state, refreshState }) {
  const st = state();
  const d = readDraft();
  const v = (k) => esc(d[k] || '');
  view.innerHTML = `
    <div class="page-head"><div class="grow"><h1>Any job</h1><p>For jobs that aren't in your list: a referral, a LinkedIn post, a recruiter's message.</p></div></div>
    <form class="quick-form" id="quickForm" autocomplete="off">
      <section class="card card-pad">
        <h2><span class="qn">1</span>The job</h2>
        <textarea class="textarea" name="description" required placeholder="Paste the whole job description" style="min-height:220px">${v('description')}</textarea>
        <details class="li-page" ${d.title || d.company ? 'open' : ''}>
          <summary>Title, company and link <span class="hint">(optional, read from the description if blank)</span></summary>
          <div class="grid-2">
            <label class="field"><span>Job title</span><input class="input" name="title" value="${v('title')}"></label>
            <label class="field"><span>Company</span><input class="input" name="company" value="${v('company')}"></label>
            <label class="field"><span>Location</span><input class="input" name="location" value="${v('location')}" placeholder="Remote, or Atlanta, GA"></label>
            <label class="field"><span>Link to the job</span><input class="input" name="url" value="${v('url')}" placeholder="https://…"></label>
          </div>
        </details>
      </section>

      <section class="card card-pad">
        <h2><span class="qn">2</span>Someone on the team <span class="hint">optional</span></h2>
        <p class="hint">You get an InMail in your style, and the résumé leans toward what they care about.</p>
        <div class="grid-3">
          <label class="field"><span>Their name</span><input class="input" name="pname" value="${v('pname')}"></label>
          <label class="field"><span>Their title</span><input class="input" name="ptitle" value="${v('ptitle')}" placeholder="Engineering Manager"></label>
          <label class="field"><span>LinkedIn link</span><input class="input" name="plinkedin" value="${v('plinkedin')}" placeholder="linkedin.com/in/…"></label>
        </div>
        <label class="field"><span>About them and their post</span>
          <textarea class="textarea" name="pinfo" placeholder="Paste their About section and the post they made (for example, the post announcing the role)." style="min-height:150px">${v('pinfo')}</textarea></label>
      </section>

      <section class="card card-pad">
        <h2><span class="qn">3</span>Your résumé</h2>
        ${st.resumes.length ? `<div class="base-picks">
          <label class="base-pick"><input type="radio" name="resumeId" value="" ${!d.resumeId ? 'checked' : ''}><span><b>Pick the closest for me</b><small>Compares the job with each of your résumés</small></span></label>
          ${st.resumes.map((r) => `<label class="base-pick"><input type="radio" name="resumeId" value="${esc(r.id)}" ${d.resumeId === r.id ? 'checked' : ''}><span><b>${esc(r.name)}</b><small><a href="#resume/${esc(r.id)}">Edit this résumé</a></small></span></label>`).join('')}
        </div>` : '<p class="hint">Add a résumé in <a href="#settings">Settings</a> first.</p>'}
        <label class="field" style="margin-top:12px"><span>Anything to change or emphasize? <span class="hint">optional</span></span>
          <input class="input" name="focus" value="${v('focus')}" placeholder="Lead with payments work, put React Native first, keep it frontend-heavy…"></label>
      </section>

      <div class="row quick-go">
        <button class="btn btn-primary" type="submit" id="go">${d.pname ? 'Make my résumé and InMail' : 'Make my résumé'}</button>
        <span class="hint">About a minute. You review everything before anything is sent.</span>
      </div>
    </form>`;

  const form = $('#quickForm');
  const draft = () => {
    const f = Object.fromEntries(new FormData(form));
    saveDraft(f);
    $('#go').textContent = f.pname.trim() ? 'Make my résumé and InMail' : 'Make my résumé';
    return f;
  };
  form.addEventListener('input', draft);
  form.addEventListener('change', draft);
  form.plinkedin.addEventListener('input', () => {
    const m = form.plinkedin.value.match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (m && !form.pname.value) {
      form.pname.value = decodeURIComponent(m[1]).replace(/-[a-z0-9]*\d[a-z0-9]*$/i, '').split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
      draft();
    }
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!st.ai.hasKey) return toast('Add your OpenAI API key in <a href="#settings">Settings</a> first.', { ms: 8000 });
    if (!st.resumes.length) return toast('Add a résumé in <a href="#settings">Settings</a> first.');
    const f = draft();
    if (f.pinfo.trim() && !f.pname.trim()) return toast('Add their name so the message can greet them.');
    const go = $('#go');
    go.disabled = true;
    go.innerHTML = `<span class="spinner"></span> ${f.title && f.company ? 'Saving the job…' : 'Reading the job…'}`;
    try {
      const { job, contactId } = await api('quick', {
        method: 'POST',
        body: {
          description: f.description, title: f.title.trim(), company: f.company.trim(), location: f.location.trim(), url: f.url.trim(), focus: f.focus,
          person: f.pname.trim() ? { name: f.pname, title: f.ptitle, linkedin: f.plinkedin, info: f.pinfo } : null,
        },
      });
      quickStart.set(job.uid, { resumeId: f.resumeId || '', contactId });
      try { sessionStorage.removeItem(DRAFT); } catch {}
      await refreshState();
      location.hash = `apply/${enc(job.uid)}`;
    } catch (err) {
      toast(esc(err.message), { error: true, ms: 9000 });
      go.disabled = false;
      draft();
    }
  };
  $$('textarea', form)[0].focus();
}
