import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderFeed } from '../src/build.mjs';
import { SERVICES } from '../src/config.mjs';
import { html } from '../src/html.mjs';
import { markdown, parseIncident } from '../src/incidents.mjs';
import { buildModel, describeReason, renderIndex, renderStatusJson } from '../src/render.mjs';

const IDS = SERVICES.map((s) => s.id);
const NOW = Date.parse('2026-10-28T12:00:00Z');
const assets = { css: 'c', js: 'j' };

const allUp = {
  monitoringSince: '2026-09-01T00:00:00.000Z',
  keepaliveMonth: '2026-10',
  services: Object.fromEntries(IDS.map((id) => [id, { status: 'up', since: '2026-09-01T00:00:00.000Z' }])),
};

const INCIDENT = `---
title: Sync is slow
services: api
---

## 2026-10-28 09:00 UTC investigating

Syncs are taking **minutes**.

## 2026-10-28 10:30 UTC — monitoring

A fix is out. See [the changelog](https://bracemark.com/blog).
`;

test('html escapes values and keeps nested markup', () => {
  assert.equal(html`<p>${'<b>"x"</b>'}</p>`.value, '<p>&lt;b&gt;&quot;x&quot;&lt;/b&gt;</p>');
  assert.equal(html`<p>${html`<b>${'&'}</b>`}</p>`.value, '<p><b>&amp;</b></p>');
});

test('markdown escapes raw HTML and allows only http(s) links', () => {
  assert.equal(markdown('<script>x</script>'), '<p>&lt;script&gt;x&lt;/script&gt;</p>');
  assert.equal(markdown('[a](javascript:alert(1))'), '<p>[a](javascript:alert(1))</p>');
  assert.equal(markdown('- one\n- `two`'), '<ul><li>one</li><li><code>two</code></li></ul>');
});

test('an incident takes its state from its latest update', () => {
  const i = parseIncident('2026-10-28-sync', INCIDENT, IDS);
  assert.equal(i.state, 'monitoring');
  assert.equal(i.start, '2026-10-28T09:00:00.000Z');
  assert.equal(i.end, null);
  assert.equal(i.updates[0].state, 'monitoring', 'newest first');
  assert.match(i.updates[1].html, /<strong>minutes<\/strong>/);
});

test('a malformed incident fails loudly, naming the file', () => {
  assert.throws(() => parseIncident('x', 'no front matter', IDS), /incidents\/x\.md/);
  assert.throws(() => parseIncident('x', INCIDENT.replace('services: api', 'services: sync'), IDS), /unknown service "sync"/);
  assert.throws(() => parseIncident('x', INCIDENT.replace('investigating', 'panicking'), IDS), /unknown state/);
  assert.throws(() => parseIncident('x', INCIDENT.replace('## 2026-10-28 09:00', '## yesterday'), IDS), /update heading/);
});

test('headline: everything up', () => {
  const m = buildModel({ services: SERVICES, state: allUp, outages: [], incidents: [], lastRun: null, now: NOW });
  assert.equal(m.level, 'up');
  assert.equal(m.headline, 'Everything is up.');
});

test('headline: one part down names it, and its row says since when and why', () => {
  const state = structuredClone(allUp);
  state.services.api = { status: 'down', since: '2026-10-28T11:40:00.000Z' };
  const outages = [{ service: 'api', start: '2026-10-28T11:40:00.000Z', end: null, reason: 'HTTP 503' }];
  const m = buildModel({ services: SERVICES, state, outages, incidents: [], lastRun: null, now: NOW });
  assert.equal(m.headline, 'Our API is down.');
  const page = renderIndex({ ...m, version: 'v' }, SERVICES, assets);
  assert.match(page, /Down since <time datetime="2026-10-28T11:40:00.000Z"/);
  assert.match(page, /answered with an error \(HTTP 503\)/);
  assert.match(page, /<title>Down · Bracemark status<\/title>/);
});

test('headline: an open incident, with nothing down', () => {
  const incidents = [parseIncident('i', INCIDENT, IDS)];
  const m = buildModel({ services: SERVICES, state: allUp, outages: [], incidents, lastRun: null, now: NOW });
  assert.equal(m.level, 'incident');
  assert.equal(m.headline, 'We’ve made a fix and are watching it.');
});

test('headline: before the first check', () => {
  const m = buildModel({ services: SERVICES, state: null, outages: [], incidents: [], lastRun: null, now: NOW });
  assert.equal(m.level, 'unknown');
});

test('past outages appear in the history with their duration', () => {
  const outages = [{ service: 'web', start: '2026-10-20T08:00:00.000Z', end: '2026-10-20T08:25:00.000Z', reason: 'timeout' }];
  const m = buildModel({ services: SERVICES, state: allUp, outages, incidents: [], lastRun: null, now: NOW });
  const page = renderIndex({ ...m, version: 'v' }, SERVICES, assets);
  assert.match(page, /<strong>The web app<\/strong> was down for 25 minutes: it didn’t answer within 10 seconds\./);
});

test('the page references nothing outside its own origin', () => {
  const m = buildModel({ services: SERVICES, state: allUp, outages: [], incidents: [], lastRun: null, now: NOW });
  const page = renderIndex({ ...m, version: 'v' }, SERVICES, assets);
  for (const [, attr, url] of page.matchAll(/\b(src|href)="([^"]+)"/g)) {
    if (attr === 'src') assert.ok(url.startsWith('/'), `src must be same-origin: ${url}`);
  }
  for (const [, rel, url] of page.matchAll(/<link rel="([^"]+)" href="([^"]+)"/g)) {
    if (rel !== 'canonical') assert.ok(url.startsWith('/'), `<link rel=${rel}> must be same-origin: ${url}`);
  }
  assert.match(page, /Content-Security-Policy" content="default-src 'none';/);
});

test('status.json version ignores the check time but not a status change', () => {
  const base = { services: SERVICES, outages: [], incidents: [], now: NOW };
  const a = renderStatusJson(buildModel({ ...base, state: allUp, lastRun: { checkedAt: '2026-10-28T11:55:00Z' } }));
  const b = renderStatusJson(buildModel({ ...base, state: allUp, lastRun: { checkedAt: '2026-10-28T12:00:00Z' } }));
  assert.equal(a.version, b.version);
  const state = structuredClone(allUp);
  state.services.web.status = 'down';
  const c = renderStatusJson(buildModel({ ...base, state, lastRun: null }));
  assert.notEqual(a.version, c.version);
});

test('the feed is well-formed enough to escape incident text', () => {
  const incidents = [parseIncident('i', INCIDENT.replace('Sync is slow', 'Sync & <sign-in>'), IDS)];
  const m = buildModel({ services: SERVICES, state: allUp, outages: [], incidents, lastRun: null, now: NOW });
  const feed = renderFeed(m, SERVICES);
  assert.match(feed, /<title>Sync &amp; &lt;sign-in&gt; \(monitoring\)<\/title>/);
  assert.doesNotMatch(feed, /<strong>/, 'html content is escaped inside <content type="html">');
});

test('reasons read as sentences', () => {
  assert.equal(describeReason('ECONNREFUSED'), 'couldn’t be reached (ECONNREFUSED)');
  assert.equal(describeReason(null), 'couldn’t be reached');
});
