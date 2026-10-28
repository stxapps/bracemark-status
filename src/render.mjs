// Everything the visitor sees, as strings. No client-side rendering: the page is
// complete without site/page.js, which only re-states the times in the reader's
// own zone and reloads the page when a newer check has been published.

import { createHash } from 'node:crypto';

import {
  ATTEMPTS,
  HISTORY_DAYS,
  INTERVAL_MINUTES,
  MINOR_DAY_MINUTES,
  SITE,
  STALE_AFTER_MINUTES,
  TIMEOUT_MS,
} from './config.mjs';
import { html, raw } from './html.mjs';
import { dailyHistory, downtimeMinutes, formatMinutes, formatPercent, uptimeRatio } from './state.mjs';

const DAY = 24 * 60 * 60_000;
const WORDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const fmtDate = (iso) => dateFormat.format(new Date(iso));
export const fmtDateTime = (iso) => `${fmtDate(iso)}, ${timeFormat.format(new Date(iso))} UTC`;

// `data-format` tells page.js how to re-state the time in the reader's zone; the
// text inside is the UTC version every reader gets without script.
const time = (iso, format, text) => html`<time datetime="${iso}" data-format="${format}">${text}</time>`;

const STATE_LABELS = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};

const INCIDENT_HEADLINES = {
  investigating: 'We’re looking into a problem.',
  identified: 'We’ve found the problem and are fixing it.',
  monitoring: 'We’ve made a fix and are watching it.',
};

export function describeReason(reason) {
  if (!reason) return 'couldn’t be reached';
  if (reason === 'timeout') return `didn’t answer within ${TIMEOUT_MS / 1000} seconds`;
  if (reason === 'unexpected response') return 'answered, but not with its health check';
  const http = /^HTTP (\d+)$/.exec(reason);
  if (http) return `answered with an error (HTTP ${http[1]})`;
  return `couldn’t be reached (${reason})`;
}

/** Everything both the page and status.json are built from. */
export function buildModel({ services, state, outages, incidents, lastRun, now }) {
  const statusOf = (id) => state?.services?.[id]?.status ?? 'unknown';
  const down = services.filter((s) => statusOf(s.id) === 'down');
  const active = incidents.filter((i) => i.state !== 'resolved');
  const anyKnown = services.some((s) => statusOf(s.id) !== 'unknown');

  let level;
  let headline;
  if (!anyKnown) {
    level = 'unknown';
    headline = 'The checks haven’t run yet.';
  } else if (down.length === services.length) {
    level = 'down';
    headline = 'Every part of Bracemark is down.';
  } else if (down.length === 1) {
    level = 'down';
    headline = `${down[0].subject} is down.`;
  } else if (down.length > 1) {
    level = 'down';
    headline = 'Some parts of Bracemark are down.';
  } else if (active.length) {
    level = 'incident';
    headline = INCIDENT_HEADLINES[active[0].state];
  } else {
    level = 'up';
    headline = 'Everything is up.';
  }

  const monitoringSince = state?.monitoringSince ?? null;
  const rows = services.map((s) => {
    const record = state?.services?.[s.id];
    const open = outages.find((o) => o.service === s.id && o.end === null);
    const ratio = uptimeRatio(outages, s.id, monitoringSince, now, HISTORY_DAYS);
    return {
      ...s,
      status: record?.status ?? 'unknown',
      since: record?.since ?? null,
      reason: open?.reason ?? null,
      uptime: ratio === null ? null : formatPercent(ratio),
      days: dailyHistory(outages, s.id, monitoringSince, now, HISTORY_DAYS, MINOR_DAY_MINUTES),
    };
  });

  // The past: written incidents that have been resolved, plus every outage the
  // checks recorded, newest first, inside the history window.
  const horizon = now - HISTORY_DAYS * DAY;
  const past = [
    ...incidents
      .filter((i) => i.state === 'resolved' && Date.parse(i.end) >= horizon)
      .map((i) => ({ kind: 'incident', at: i.start, incident: i })),
    ...outages
      .filter((o) => o.end !== null && Date.parse(o.end) >= horizon)
      .map((o) => ({
        kind: 'outage',
        at: o.start,
        outage: o,
        service: services.find((s) => s.id === o.service),
        minutes: downtimeMinutes([o], o.service, -Infinity, Infinity, now),
      }))
      .filter((e) => e.service),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return {
    level,
    headline,
    rows,
    active,
    past,
    monitoringSince,
    checkedAt: lastRun?.checkedAt ?? null,
    generatedAt: new Date(now).toISOString(),
  };
}

/**
 * `version` changes when anything on the page would, and not when only the
 * check time moves — page.js reloads on the first and quietly updates the
 * second.
 */
export function renderStatusJson(model) {
  const content = statusContent(model);
  return {
    version: createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 12),
    generatedAt: model.generatedAt,
    checkedAt: model.checkedAt,
    ...content,
  };
}

function statusContent(model) {
  return {
    status: model.level,
    headline: model.headline,
    services: model.rows.map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      status: r.status,
      since: r.since,
      uptime90d: r.uptime,
    })),
    incidents: model.active.map((i) => ({
      title: i.title,
      state: i.state,
      services: i.services,
      start: i.start,
      updatedAt: i.updates[0].at,
    })),
  };
}

const ICON = raw(
  `<svg class="mark" viewBox="0 0 428 512" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M254.101 0L382.101 128C385.101 168 360.1 223.5 324.101 241C458.6 248.001 466.6 502.499 324.101 512H48C21.4903 512 0 490.51 0 464V48C0 21.4903 21.4903 0 48 0H254.101ZM103.101 443H286.101C328.074 443 362.101 408.973 362.101 367C362.101 325.027 328.074 291 286.101 291H103.101V443ZM103.101 198H245.101C280.447 198 309.101 169.346 309.101 134C309.101 98.6539 280.447 70.0003 245.101 70H103.101V198Z"/></svg>`,
);

function layout({ title, description, assets, body, bodyAttrs = raw('') }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#ffffff">
<meta name="color-scheme" content="light">
<link rel="canonical" href="${SITE.url}/">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/icon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/icon-16.png" type="image/png" sizes="16x16">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" type="application/atom+xml" title="Bracemark status" href="/feed.xml">
<link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/bricolage-grotesque-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css?v=${assets.css}">
<script src="/page.js?v=${assets.js}" defer></script>
</head>
<body${bodyAttrs}>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/">${ICON}<span class="wordmark">Bracemark</span><span class="brand-tag">Status</span></a>
    <a class="header-link" href="${SITE.home}">bracemark.com</a>
  </div>
</header>
${body}
</body>
</html>
`;
}

function statusLabel(status) {
  return { up: 'Up', down: 'Down', unknown: 'Not checked yet' }[status];
}

function renderRow(r) {
  const dayTitle = (d) => {
    const date = fmtDate(`${d.date}T00:00:00Z`);
    if (d.level === 'none') return `${date}: not monitored yet`;
    if (d.level === 'up') return `${date}: no downtime`;
    return `${date}: down for ${formatMinutes(d.minutes)}`;
  };
  const downDays = r.days.filter((d) => d.level === 'minor' || d.level === 'major').length;
  return html`
<li class="service" data-status="${r.status}">
  <div class="service-head">
    <div class="service-name">
      <h3>${r.name}</h3>
      <span class="host">${r.host}</span>
    </div>
    <p class="pill pill--${r.status}"><span class="dot" aria-hidden="true"></span>${statusLabel(r.status)}</p>
  </div>
  ${
    r.status === 'down' && r.since
      ? html`<p class="service-alert">Down since ${time(r.since, 'datetime', fmtDateTime(r.since))}. It ${describeReason(r.reason)}.</p>`
      : ''
  }
  <p class="service-desc">${r.description}</p>
  <div class="bars" aria-hidden="true">${r.days.map(
    (d) => html`<span class="bar bar--${d.level}" title="${dayTitle(d)}"></span>`,
  )}</div>
  <div class="bars-legend">
    <span><span class="long">${HISTORY_DAYS} days ago</span><span class="short">30 days ago</span></span>
    <span class="uptime">${
      r.uptime === null
        ? 'Too new to measure'
        : html`${r.uptime} up<span class="sr-only"> over the last ${HISTORY_DAYS} days, with downtime on ${downDays} ${downDays === 1 ? 'day' : 'days'}</span>`
    }</span>
    <span>Today</span>
  </div>
</li>`;
}

function renderIncident(i, services, { open }) {
  const names = i.services.map((id) => services.find((s) => s.id === id)?.name ?? id).join(', ');
  return html`
<article class="incident${open ? ' incident--open' : ''}">
  <header>
    <p class="incident-meta"><span class="state state--${i.state}">${STATE_LABELS[i.state]}</span> <span>${names}</span></p>
    <h3 id="incident-${i.slug}">${i.title}</h3>
  </header>
  <ol class="updates">
    ${i.updates.map(
      (u) => html`<li>
      <p class="update-meta">${time(u.at, 'datetime', fmtDateTime(u.at))} · ${STATE_LABELS[u.state]}</p>
      <div class="prose">${raw(u.html)}</div>
    </li>`,
    )}
  </ol>
</article>`;
}

function renderPast(model, services) {
  if (model.past.length === 0) {
    const since =
      model.monitoringSince && Date.parse(model.monitoringSince) > Date.parse(model.generatedAt) - HISTORY_DAYS * DAY
        ? html` since monitoring began on ${time(model.monitoringSince, 'date', fmtDate(model.monitoringSince))}`
        : html` in the last ${HISTORY_DAYS} days`;
    return html`<p class="empty">No outages and no incidents${since}.</p>`;
  }
  return html`<ol class="past">${model.past.map((e) =>
    e.kind === 'incident'
      ? html`<li class="past-item">${renderIncident(e.incident, services, { open: false })}</li>`
      : html`<li class="past-item">
  <p class="update-meta">${time(e.at, 'datetime', fmtDateTime(e.at))} · Found by the checks</p>
  <p class="outage-line"><strong>${e.service.subject}</strong> was down for ${formatMinutes(e.minutes)}: it ${describeReason(e.outage.reason)}.</p>
</li>`,
  )}</ol>`;
}

export function renderIndex(model, services, assets) {
  const titlePrefix = { up: '', unknown: '', incident: 'Incident · ', down: 'Down · ' }[model.level];
  const bodyAttrs = html` data-checked-at="${model.checkedAt ?? ''}" data-version="${model.version}" data-stale-minutes="${STALE_AFTER_MINUTES}"`;

  const body = html`
<main id="main" class="wrap">
  <section class="hero hero--${model.level}" aria-labelledby="headline">
    <h1 id="headline"><span class="hero-dot" aria-hidden="true"></span>${model.headline}</h1>
    <p class="checked">${
      model.checkedAt
        ? html`Last checked ${time(model.checkedAt, 'relative', fmtDateTime(model.checkedAt))}.`
        : 'Not checked yet.'
    } <span class="stale" hidden>That’s later than it should be, so what you see here may be out of date.</span></p>
  </section>

  ${
    model.active.length
      ? html`<section class="block" aria-labelledby="open-incidents">
    <h2 id="open-incidents" class="eyebrow">Open incidents</h2>
    ${model.active.map((i) => renderIncident(i, services, { open: true }))}
  </section>`
      : ''
  }

  <section class="block" aria-labelledby="services">
    <h2 id="services" class="eyebrow">Each part, over ${HISTORY_DAYS} days</h2>
    <ul class="services">${model.rows.map(renderRow)}</ul>
    <p class="key" aria-hidden="true"><span><span class="bar bar--up"></span>No downtime</span><span><span class="bar bar--minor"></span>Down up to ${MINOR_DAY_MINUTES} minutes</span><span><span class="bar bar--major"></span>Down longer</span><span><span class="bar bar--none"></span>Not monitored yet</span></p>
  </section>

  <section class="block" aria-labelledby="history">
    <h2 id="history" class="eyebrow">Past ${HISTORY_DAYS} days</h2>
    ${renderPast(model, services)}
  </section>

  <section class="block how" aria-labelledby="how">
    <h2 id="how" class="eyebrow">How this page works</h2>
    <div class="prose">
      <p>Every ${INTERVAL_MINUTES} minutes, a job on GitHub requests each address above, up to ${WORDS[ATTEMPTS]} times, waiting ${TIMEOUT_MS / 1000} seconds for each answer. A part is marked down only when all ${WORDS[ATTEMPTS]} fail. GitHub sometimes starts a check late when it’s busy, so the gap between two checks can be longer.</p>
      <p>The checks run on GitHub, and GitHub serves this page, so an outage of our own servers doesn’t take it down with them. Its address still resolves through Cloudflare, which holds our domain’s DNS, so an outage there can.</p>
      <p>An outage is timed from the first check that fails to the first one that gets an answer again, so it may have started, and ended, up to ${INTERVAL_MINUTES} minutes before the times shown. One shorter than that can fall between two checks and not appear here at all.</p>
      <p>This page loads nothing from any other address: no analytics, no trackers, no fonts from elsewhere. GitHub serves it, and like any host it sees each request.</p>
      <p>Follow it with the <a href="/feed.xml">Atom feed</a>, or read <a href="/status.json">status.json</a>. The code and every change to the record are in <a href="${SITE.repo}">the repository</a>.</p>
    </div>
  </section>
</main>
<footer class="site-footer">
  <div class="wrap footer-row">
    <span class="tz-note">Times are in UTC.</span>
    <a href="${SITE.home}">bracemark.com</a>
  </div>
</footer>`;

  return layout({
    title: `${titlePrefix}Bracemark status`,
    description:
      `Whether each part of Bracemark is answering, checked every ${INTERVAL_MINUTES} minutes from outside our own servers.`,
    assets,
    body,
    bodyAttrs,
  }).value;
}

export function render404(assets) {
  const body = html`
<main id="main" class="wrap">
  <section class="hero hero--unknown">
    <p class="eyebrow">404</p>
    <h1>There’s no page at this address.</h1>
    <p class="checked"><a href="/">The status page</a> is the only page here.</p>
  </section>
</main>`;
  return layout({ title: 'Not found · Bracemark status', description: 'Not found.', assets, body }).value;
}
