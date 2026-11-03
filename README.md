# bracemark-status

The source of [status.bracemark.com](https://status.bracemark.com). It shows
whether each part of Bracemark is answering, checked from outside our own
servers.

- **Checks** run on GitHub Actions every 15 minutes. Google Cloud Scheduler
  starts them.
- **The page** is served by GitHub Pages.
- **No dependencies**: Node's standard library only, with nothing to install
  and nothing to update.
- **Nothing loaded from elsewhere**: no analytics, no third-party scripts, and
  the fonts are served from here. A `Content-Security-Policy` meta tag of
  `default-src 'none'` plus `'self'` enforces this in the browser, and a test
  checks the generated HTML.

Our servers run on Cloudflare (the API and the link-preview service) and AWS
(the marketing site and the web app). GitHub and Google are neither, so the
checks, what starts them, and the page don't go down with what they watch.

## How it works

```
Cloud Scheduler job            every 15 min: POST to the workflow's dispatch endpoint
.github/workflows/status.yml   each run: check → commit if changed → build → deploy
src/check.mjs                  requests each service, folds the results into data/
src/build.mjs                  renders dist/ (index.html, status.json, feed.xml, 404.html)
src/config.mjs                 the services, their copy, the timings
data/state.json                current status per service           (written by the workflow)
data/outages.json              every outage the checks have seen    (written by the workflow)
incidents/*.md                 what a person writes during an incident
site/                          stylesheet, script, fonts, icons — copied into dist/ as is
```

**What starts a run.** A Google Cloud Scheduler job sends a `POST` to the
workflow's `workflow_dispatch` endpoint every 15 minutes, at the same minutes as
the cron line. The workflow does all the work, on GitHub, and only what starts
it lives on Google. GitHub's own `schedule` trigger can't be relied on for this.
Over its first four days it started 20 of the roughly 375 runs it was asked
for, a median of 4.9 hours apart, the longest gap 7.3 hours. Every run it did
start reached a runner within seconds and passed, so the runs were being
skipped before they existed, and no change to the cron line could help. Over
the first 12 hours of dispatches, every tick produced exactly one run, and the
longest gap was 15.2 minutes.

- **The cron line stays, as the fallback.** If the dispatches stop, the page
  drops back to a few checks a day instead of none, and the scheduled runs
  notice (see _The watchdog_). A run started twice is just one extra check,
  and `concurrency` runs them one at a time.
- ⚠ **The trigger must never move to Cloudflare or AWS**, however convenient a
  Worker cron would be. It would stop along with what it watches, which is
  the one time it's needed. Google is neither. cron-job.org was the other
  candidate: it would work, but its terms name no operator and promise no
  uptime, and the token would sit with it.
- **Tests run on a push only.** A run that exists to check the services skips
  `node --test`, so a failing test can't freeze the page.

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

**Alerts.** A failed run is the alert, and GitHub emails it. A run fails on
purpose in two cases: on the check where a service goes from up to down, which
is one email per outage, not one every 15 minutes; and in a scheduled run that
finds the dispatches have stopped. Who gets the email depends on how the run
started:

| run        | email goes to | why                                                  |
| ---------- | ------------- | ---------------------------------------------------- |
| dispatched | `stxapps`     | it owns the Scheduler job's token, so it's the actor |
| scheduled  | `0xc22b`      | it last edited the `cron:` line                      |

Both were tested by making a run fail on purpose: a dispatched run on
2026-11-01, a scheduled one on 2026-11-03. Dispatches see nearly every outage
first, so most outage emails go to `stxapps`. Both accounts need email for
failed Actions runs turned on in their notification settings, and editing the
cron line moves the scheduled-run email to whoever edits it.

**The watchdog.** Cloud Scheduler doesn't email us when it stops, and a dead
trigger looks fine: the page still updates a few times a day through the
fallback. So the last step of each scheduled run counts the dispatched runs
created in the last hour, and fails if there are fewer than 2. Four are
expected, and 2 allows for a missed one without crying wolf.

- It runs even after an outage has failed the run (`!cancelled()`), and it's
  last so it can't hold up a deploy.
- If it can't count, it warns and passes. A failed look must never read as a
  dead trigger.
- It reads the API with the run's own `GITHUB_TOKEN`, hence `actions: read`.
  That token lasts one job and has nothing to do with the Scheduler job's.
- Until the trigger is fixed, it sends an email on every scheduled run, about
  five a day.
- **What it can't see** is anything that stops the workflow itself: the cron
  trigger dying too, a GitHub Actions outage, or someone disabling the
  workflow. Then nothing emails, and the page's "later than it should be"
  note is the signal.

**Keeping the schedule alive.** GitHub disables scheduled workflows in a public
repo after 60 days without activity, and a disabled workflow can't be
dispatched either. The first run of each month updates `keepaliveMonth` in
`data/state.json`, which makes one commit a month even in a quiet stretch.

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
7. **The token.** Create a fine-grained personal access token at GitHub →
   Settings → Developer settings → Fine-grained tokens, signed in as `stxapps`,
   which owns this repo. Fine-grained tokens don't work for a repo you only
   collaborate on.

   | setting           | value                                                  |
   | ----------------- | ------------------------------------------------------ |
   | resource owner    | `stxapps`                                              |
   | repository access | Only select repositories → `bracemark-status`          |
   | permissions       | Repository → **Actions: Read and write**, nothing else |
   | expiration        | **No expiration**                                      |
   - **No expiration, on purpose.** An expiry fails silently: dispatches start
     getting a 401, the fallback quietly takes over, and the page drifts back
     to a few checks a day. GitHub revokes a token unused for a year, which
     won't happen at one use every 15 minutes.
   - **What a leak costs.** Actions write lets someone spam, cancel, delete or
     disable runs. There's no Contents access, so it can't change code,
     `data/` or `incidents/`, or publish anything to the page. At worst the page
     freezes, and revoking the token and re-enabling the workflow undoes that.
     It never goes in this repo, a commit, an issue or a log.
   - **Never a classic token.** Its `repo` scope covers every repository the
     account can reach, private ones included.

8. **The Scheduler job**, in a Google Cloud project of its own. Google's docs
   don't say how header values are stored, so assume anyone who can read the
   job can read the token, and keep the project free of anyone who doesn't
   need to be in it. The project needs billing enabled. Scheduler's first 3
   jobs per billing account (not per project) are free, paused jobs included,
   then $0.10 per job per 31 days. Count the jobs on the billing account
   first.

   ```sh
   gcloud projects create <project-id> --name='bracemark-status'
   gcloud billing projects link <project-id> --billing-account=<billing-account-id>
   gcloud services enable cloudscheduler.googleapis.com --project <project-id>

   read -rs GH_TOKEN   # paste at the prompt, so it stays out of shell history

   CLOUDSDK_CORE_DISABLE_FILE_LOGGING=True \
   gcloud scheduler jobs create http status-dispatch \
     --project <project-id> \
     --location us-central1 \
     --schedule '7-59/15 * * * *' \
     --time-zone Etc/UTC \
     --uri https://api.github.com/repos/stxapps/bracemark-status/actions/workflows/status.yml/dispatches \
     --http-method post \
     --headers "Authorization=Bearer $GH_TOKEN,Accept=application/vnd.github+json,Content-Type=application/json" \
     --message-body '{"ref":"main"}' \
     --format='value(state)'

   unset GH_TOKEN
   ```

   - **Pass `--project` every time.** Never rely on `gcloud`'s default project.
   - **File logging stays off** for any command that carries the token. By
     default gcloud writes the request, header included, to
     `~/.config/gcloud/logs` in plain text and keeps it for 30 days.
   - **Never print the whole job.** Assume `describe`, or what `create` prints
     back, shows the token. Name the fields you want with `--format`.
   - **The schedule matches the cron line**, and no test checks the job. If
     `INTERVAL_MINUTES` changes, change the job by hand.
   - No retries (the next attempt is 15 minutes away), and any 2xx is success.
     GitHub answers a dispatch with a 204. `Content-Type` has to be set by
     hand.
   - **Test it** by running the job once by hand, and confirm a
     `workflow_dispatch` run appears. A 401, or a success with no run, means
     the `Authorization` header isn't getting through.
   - **To test the watchdog**, `pause` the job, wait for a scheduled run that
     starts at least an hour later (they can be hours apart), confirm it
     deploys and then fails at _Fail if dispatches have stopped_, then
     `resume` the job.

   ```sh
   gcloud scheduler jobs run status-dispatch --project <project-id> --location us-central1

   # To replace the token, with GH_TOKEN read the same way as above:
   CLOUDSDK_CORE_DISABLE_FILE_LOGGING=True \
   gcloud scheduler jobs update http status-dispatch \
     --project <project-id> \
     --location us-central1 \
     --update-headers "Authorization=Bearer $GH_TOKEN" \
     --format='value(state)'
   ```

## Licence

[AGPL-3.0](LICENSE), like the Bracemark monorepo. The fonts in `site/fonts/`
are under the SIL Open Font License 1.1; see
[`site/fonts/LICENSE.md`](site/fonts/LICENSE.md).
