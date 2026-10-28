# bracemark-status

The source of [status.bracemark.com](https://status.bracemark.com). It shows
whether each part of Bracemark is answering, checked from outside our own
servers.

- **Checks** run on GitHub Actions every 15 minutes.
- **The page** is served by GitHub Pages.
- **No dependencies**: Node's standard library only, with nothing to install
  and nothing to update.
- **Nothing loaded from elsewhere**: no analytics, no third-party scripts, and
  the fonts are served from here. A `Content-Security-Policy` meta tag of
  `default-src 'none'` plus `'self'` enforces this in the browser, and a test
  checks the generated HTML.

Our servers run on Cloudflare (the API and the link-preview service) and AWS
(the marketing site and the web app). GitHub is neither, so the checks and the
page do not go down with what they watch.

## How it works

```
.github/workflows/status.yml   every 15 min: check → commit if changed → build → deploy
src/check.mjs                  requests each service, folds the results into data/
src/build.mjs                  renders dist/ (index.html, status.json, feed.xml, 404.html)
src/config.mjs                 the services, their copy, the timings
data/state.json                current status per service           (written by the workflow)
data/outages.json              every outage the checks have seen    (written by the workflow)
incidents/*.md                 what a person writes during an incident
site/                          stylesheet, script, fonts, icons — copied into dist/ as is
```

**A check** sends up to three requests, 5 seconds apart, and allows each one
10 seconds. A service is down only when all three fail.
`api.` and `extractor.` must answer `/health` with `{"status":"ok"}`; the two
pages must answer with a 2xx.

**The record changes only when a status changes.** A check that agrees with
`data/state.json` writes nothing, so a quiet day makes no commits, and
`git log data/` is the outage history. Uptime is computed from
`data/outages.json` (downtime over the monitored window), not by counting
checks.

**An outage is timed** from the first check that fails to the first one that
succeeds again. It may have started up to one interval earlier.

**The page is rebuilt and deployed on every run** so that "last checked" stays
current. This needs no commit, because the deploy is an artifact.

**Why every 15 minutes.** Minutes cost nothing: Actions minutes are free in a
public repo. Commits happen only on a status change, so the interval doesn't
add commits either. What the interval decides is how soon the page admits an
outage, and how short an outage it can see at all.

- **At 30 minutes**, an outage can run half an hour (an hour, if GitHub drops a
  run) while the page still says "Everything is up", and anything shorter than
  that can fall between two checks unrecorded.
- **At 5 minutes**, the page is a little fresher, at the cost of about 290
  deploys a day.

The reasoning is also beside `INTERVAL_MINUTES` in `src/config.mjs`. A test
fails if that constant and the cron line disagree.

**Alerts.** The run fails only on the check where a service goes from up to
down. GitHub emails failed scheduled runs to whoever last edited the `cron:`
line, so that is one email per outage, not one every 15 minutes.

**Keeping the schedule alive.** GitHub disables scheduled workflows in a public
repo after 60 days without activity. The first run of each month updates
`keepaliveMonth` in `data/state.json`, which makes one commit a month even in a
quiet stretch.

## Writing an incident

The checks only know whether something answers. When something is wrong in a
way they cannot see (sync is slow, one feature fails), or when there is
something to explain, add a file to `incidents/` and push:

```markdown
---
title: Sync fails with an error
services: api
---

## 2026-10-28 14:05 UTC investigating

Sign-in and sync answer with an error. We are looking into it.
```

- **`services`**: one or more ids from `src/config.mjs` (`site`, `web`, `api`,
  `extractor`), separated by commas.
- **Updates**: each `## <date> <time> UTC <state>` heading starts one. The state
  is one of `investigating`, `identified`, `monitoring` or `resolved`. Times are
  in UTC.
- **Order and state**: updates can be in any order; the page shows the newest
  first. The newest update's state is the incident's state. Until it is
  `resolved`, the incident is shown at the top of the page and in the headline.
- **Formatting**: paragraphs, `- ` lists, `**bold**`, `` `code` `` and
  `[links](https://…)`. Nothing else. Raw HTML is shown as text.
- **Updating**: to post an update, add a new `##` section to the same file and
  push. Name the file `YYYY-MM-DD-short-slug.md`.

The parser is strict. A file it cannot read fails the build, and a failed
build deploys nothing, so the live page keeps its previous version. Check your
change before pushing with `npm run build` (or `npm test`).

Write in the same voice as the rest of Bracemark (`docs/brand-assets.md`,
_the voice_, in the monorepo): say what is happening, in plain words and the
present tense, with contractions and the ’ apostrophe. "We" owns the problem.
Don't reassure. Call the two Workers by the names that file fixes for them:
"our API" (the service behind sign-in, sync, and billing) and "the link-preview
service".

## Local

```sh
npm test           # node --test
npm run check      # real requests; writes data/ — do not commit the result
npm run build      # renders dist/ from data/ and incidents/
npm run preview    # build, then serve dist/ on http://localhost:4173
```

`npm run check` writes into `data/` just as the workflow does. Only the
workflow should commit `data/`, so use `git restore data/` (or delete the
files) afterwards.

## Setup (once)

1. **Pages**: Settings → Pages → Source: **GitHub Actions**.
2. **Custom domain**: Settings → Pages → Custom domain: `status.bracemark.com`.
   Then tick **Enforce HTTPS** once the certificate has been issued. A deploy
   from Actions ignores a `CNAME` file, so the setting is the only place the
   domain lives.
3. **Verify the domain**: GitHub → your account or organisation settings →
   Pages → Add a domain: `bracemark.com`. It gives you a `TXT` record, which
   stops anyone else's Pages site from claiming a `*.bracemark.com` name.
4. **DNS** (Cloudflare, the `bracemark.com` zone): `CNAME status → stxapps.github.io`.
   Set it to **DNS only (grey cloud), not proxied**. Proxying would route the
   page through the Cloudflare network it is meant to be independent of, and it
   stops GitHub from issuing the certificate.
5. **Actions**: Settings → Actions → General → Workflow permissions can stay
   read-only. The workflow asks for exactly what it needs.
6. Push. The first run records every service and sets `monitoringSince`.

## Licence

[AGPL-3.0](LICENSE), like the Bracemark monorepo. The fonts in `site/fonts/`
are under the SIL Open Font License 1.1; see
[`site/fonts/LICENSE.md`](site/fonts/LICENSE.md).
