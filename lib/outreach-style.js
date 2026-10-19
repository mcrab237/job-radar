// Your InMail style: messages that got replies (and interviews), what you can
// say about yourself, and how you sign off. Editable in Settings → Your InMail style.

export const DEFAULT_OUTREACH = {
  // Fill these in under Settings → Your InMail style. The examples below are
  // made up (Alex Morgan is fictional): replace them with real messages of
  // yours that got replies, and the AI writes new ones the same way.
  portfolio: '',
  signoff: '',
  facts: `(Your facts: one per line, only things you can back up. For example:)
Built a React and TypeScript dashboard used by 5,000 people a month.
Moved a Node.js API from callbacks to async/await and cut errors by a third.`,
  examples: `To: an engineer who posted about their team's new checkout (sample, replace with your own)
Subject: Interested in Joining Acme's Payments Team
Hi Sam,

I saw your post about rebuilding Acme's checkout so a failed card retry never charges twice. The way you made every step idempotent stood out to me, because I handled the same problem when I built order payments for a small online store: I added idempotency keys to every write and a daily reconciliation job.

I've applied for the Software Engineer role on the Payments team, and I'd love to hear what the team is focused on next. Here's my portfolio: https://example.com.

Thanks for reading,
Alex Morgan`,
  replies: `Them: Thanks for reaching out. Please apply on our careers page and the recruiter will be in touch. (sample)
Me: Thanks for getting back to me, Sam! I've applied on the careers page. Have a great week!`,
};

// Filler that makes a message sound machine-written. Drafts containing any of
// these get one more pass.
// (The candidate's own proven phrases, like "stood out to me" or "maps closely", are allowed.)
export const SLOP = [/\bdeeply\b/i, /passionate/i, /thrilled/i, /\beager\b/i, /leverag/i, /impactful/i, /seamless/i, /\brobust\b/i, /cutting.edge/i, /journey/i, /finds you well/i, /\bdelve/i, /tapestry/i, /—/];

export const outreachOf = (settings) => ({ ...DEFAULT_OUTREACH, ...(settings.outreach || {}) });

// What these messages have in common. The examples show it; this spells it out.
export const INMAIL_GUIDE = `How the candidate's InMails work (the examples are their messages that got replies):

Subject: simple, straightforward and professional, so it reads clearly in an inbox. The candidate prefers these patterns:
- "Interested in the {Job Title} Opportunity at {Company}"
- "Interested in Bringing My Expertise to the {Team} Team"
- "Interested in Joining {Company}'s {Team} Team"
- "Interested in Building {what the team builds} at {Company}"
Use the real team or product name when the posting or the person's page gives one ("Payments", "Consumer", "Financial Systems"); otherwise use the company. Title Case, at most 60 characters. No clever wordplay, no puns, no questions, no emoji, never "Job Application" or "Quick Question".

Body: write it the way the candidate's proven messages are written (below). Same structure, same kind of sentences, same length: about 100 to 150 words. Don't shorten it into a template and don't get clever.
1. Opener after "Hi {first name},": something real about their WORK from their page, in the candidate's way:
   "I saw your post about {thing}. Your emphasis on {what they cared about} stood out to me." or "I enjoyed reading about {thing they built}. Having run my own startup for two years, I related to {it}." or "Your post about {launch} caught my attention. {one honest sentence connecting it to the candidate}."
   If there's nothing work-related on their page: "I just applied for the {role} role at {company} and wanted to reach out directly."
   Never personal-life details, no questions, no jokes.
2. Experience: "I recently applied for the {exact job title} role{ at company}." Then "I'm a full-stack engineer working with React and TypeScript, and I've built {the 1 or 2 projects that fit this company best, with their numbers}." Then, when it fits, one sentence tying it to the company or role ("{Company}'s emphasis on {X} really resonates with me." / "That maps closely to the systems I've been working on." / "Fintech is an industry I've long wanted to work in.").
3. Ask, in the candidate's words:
   - Not the hiring manager: "Given your work {on their area}, would you be open to connecting me with the hiring manager or pointing me toward the right person?"
   - Someone who posted about openings or could refer: "If my background looks like a potential fit, I'd really appreciate a brief conversation or, if you feel comfortable, a referral."
   - The hiring manager or the recruiter for the role: "I'd love the opportunity to chat and learn more about the team and what you're looking for."
4. "I've attached my resume, and here's my portfolio: {portfolio}" (or "Here's my portfolio: {portfolio}" when nothing is attached).
5. "Thanks for your time!" (add a short callback when it fits, like "and congratulations on the Books launch!"), then the sign-off name on its own line.

Never write: "deeply", "passionate", "thrilled", "eager", "leverage", "impactful", "seamless", "robust", "cutting-edge", "journey", "I hope this message finds you well", "I wanted to reach out to express", em dashes (—). No sentence explaining why your experience matches the role; the facts already show it. One light emoji at most, only for a casual cold opener.`;
