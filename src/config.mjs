// What this page watches, and the words it uses for each part.
//
// `id` is the key in data/state.json, data/outages.json and an incident's
// `services:` line, so renaming one orphans its history — add a new id instead.
// `name`, `subject` (the name as the subject of a headline) and `description`
// are user-facing copy, held to the monorepo's docs/brand-assets.md: second
// person, present tense, contractions with ’, the serial comma, and about what
// the part DOES, never how reliable we mean it to be. The two Workers carry the
// names that file fixes for them — "our API" with its gloss, and "link-preview
// service" in full — so this page and /privacy name them the same way.
export const SERVICES = [
  {
    id: 'site',
    name: 'Website',
    subject: 'The website',
    host: 'bracemark.com',
    url: 'https://bracemark.com/',
    expect: 'page',
    description: 'What Bracemark is, pricing, and the help pages.',
  },
  {
    id: 'web',
    name: 'Web app',
    subject: 'The web app',
    host: 'app.bracemark.com',
    url: 'https://app.bracemark.com/',
    expect: 'page',
    description: 'Bracemark in your browser.',
  },
  {
    id: 'api',
    name: 'Our API',
    subject: 'Our API',
    host: 'api.bracemark.com',
    url: 'https://api.bracemark.com/health',
    expect: 'health',
    // The second sentence is the local-first claim, and the monorepo's
    // docs/offline-mode.md is what makes it true; if that changes, this does.
    description:
      'The service behind sign-in, sync, and billing. Your library is kept on each of your devices, so one that’s already signed in can still open it while this is down.',
  },
  {
    id: 'extractor',
    name: 'Link-preview service',
    subject: 'The link-preview service',
    host: 'extractor.bracemark.com',
    url: 'https://extractor.bracemark.com/health',
    expect: 'health',
    // Only the web app calls it, and only with its Server previews setting on —
    // the browser extension and the mobile app fetch previews themselves.
    description: 'Fills in a link’s title and preview image in the web app, when Server previews is on.',
  },
];

export const SITE = {
  url: 'https://status.bracemark.com',
  home: 'https://bracemark.com',
  repo: 'https://github.com/stxapps/bracemark-status',
};

// How often the workflow's cron fires. The page states it, and the browser uses
// it to tell a late check from a normal gap — keep it in step with
// .github/workflows/status.yml.
//
// 15, not 5 and not 30. Minutes cost nothing either way — a public repo's
// Actions minutes are free — and a commit happens only on a status change, so
// the interval buys exactly two things: how soon the page admits an outage, and
// how short an outage it can see at all. At 30, an outage can run half an hour
// (an hour, if GitHub drops a run) while this page still says "Everything is
// up", and anything shorter than one interval can slip between two checks
// unrecorded. At 5, the page is a little fresher, at the price of ~290 deploys a
// day. A test pins this to the cron line.
export const INTERVAL_MINUTES = 15;

// GitHub starts scheduled runs late under load, often by 10–20 minutes, so
// "overdue" has to sit well past one interval before the page says so.
export const STALE_AFTER_MINUTES = 45;

export const HISTORY_DAYS = 90;

// One check is up to ATTEMPTS requests, RETRY_DELAY_MS apart, each allowed
// TIMEOUT_MS. A part is marked down only when every attempt fails, so a single
// dropped packet between GitHub's runner and us is not an outage.
export const ATTEMPTS = 3;
export const RETRY_DELAY_MS = 5_000;
export const TIMEOUT_MS = 10_000;

// A day with no more than this much downtime is drawn as minor rather than major.
export const MINOR_DAY_MINUTES = 30;

export const USER_AGENT = `bracemark-status (+${SITE.repo})`;
