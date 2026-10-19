# Job Radar

A job-search app that runs on your own computer. It watches company career pages, picks the jobs worth applying to each morning, tailors your résumé and cover letter for each one, helps you message the right person, and keeps you on a 12-week interview prep plan with a streak.

Everything stays on your computer: your data is in `data/db.json`, and the only outside service it talks to (besides the job boards it reads) is OpenAI, with your own key.

## What you need

- **Node.js 20 or newer**: https://nodejs.org (the LTS button)
- **Google Chrome** (the Apply step opens job forms in it and fills in your details)
- **An OpenAI API key**: https://platform.openai.com/api-keys. Typical use costs a few dollars a month.
- A Mac is easiest (double-click to start, Mac notifications), but it runs anywhere Node does.

## Start it

```bash
git clone <this repo's URL> job-radar
cd job-radar
npm install
npm start
```

Your browser opens http://localhost:4870. Keep the Terminal window open while you use it: it checks for new jobs every few minutes.

On a Mac you can instead double-click **Start Job Radar.command** (the first time: right-click → Open, because it's downloaded).

## Set it up (10 minutes, in the app)

1. **Settings → Your details for application forms**: name, email, phone, where you live, links.
2. **Settings → Your résumés**: upload your résumé as a PDF. You can keep a few (frontend, backend…); each job uses the closest one.
3. **Settings → OpenAI**: paste your key. It's stored in `data/db.json` on your computer only.
4. **Settings → Your job filter**: level, pay range, remote or local, dream companies, applications a day. Add **A cover letter you've sent before** too: new letters follow its style.
5. **Settings → Your InMail style**: replace the made-up example messages with messages of yours that got replies. New messages are written the same way.
6. **Companies**: add the companies picked for you (one click), and any others by pasting their job-board link. Job Radar starts reading their jobs right away.
7. **Today → Start** your 12-week plan.

## Use it

- **Today**: the day's problems, practice and frontend prep on the left; today's job picks on the right. Tick things off to keep your streak.
- **Jobs → Apply** opens five steps: résumé (fitted to the job, click any line to edit), cover letter, review (nothing becomes a PDF until you approve it), apply (opens the form with your details filled in: you press Submit), reach out (finds the likely hiring manager and writes a short note).
- **Any job**: found a job somewhere else? Paste it in.
- **Practice**: the 12-week plan, re-solves (every problem comes back after 3 and 10 days) and interviews.
- **Help** in the app explains the rest.

Nothing is ever submitted for you, and LinkedIn, Indeed and Dice are never scraped (they ban accounts for it): the Companies page has one-click "newest first" searches for them instead.

## Make it yours

It was built for a full-stack JavaScript/TypeScript engineer in the US, so a few things lean that way:

- **Scoring** (`lib/fit.js`) favours JS/TS roles and gives payments and fintech jobs a boost. Change `PAYMENTS` scoring or the stack list (`HAVE`) to suit you.
- **Local jobs**: the "local" switch in Settings means Atlanta. For your city, change the `ATL` line in `lib/fit.js`, and the labels in `public/app.js`.
- **Companies**: `lib/companies.json` is the list it watches (Greenhouse, Lever, Ashby, Workday boards…). Add your own in the app under Companies, by pasting a job-board link.
- **The plan**: `lib/plan-data.json` is the 12-week plan: 3 LeetCode problems a day, a practical exercise, an hour of frontend prep, applying, and a review day each week. Edit it freely.
- **Practice-kit tasks** ("npm test log-parser") point to a separate private exercises repo that isn't included: treat them as "build it yourself" exercises, or skip them.

## Good to know

- Mac notifications that open the job when clicked: `brew install terminal-notifier`.
- Start it when you log in: System Settings → General → Login Items → add `Start Job Radar.command`.
- Back up your data: copy the `data/` folder, or run `node scripts/backup.mjs` (it writes to iCloud Drive on a Mac).
- Use it from your laptop or phone: Settings → **Use on your laptop** (an access code, and Tailscale if you set it up).
