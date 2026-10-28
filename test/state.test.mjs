import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyResults,
  dailyHistory,
  downtimeMinutes,
  emptyState,
  formatMinutes,
  formatPercent,
  uptimeRatio,
} from '../src/state.mjs';

const T0 = Date.parse('2026-10-28T10:00:00Z');
const MIN = 60_000;

test('first run records every service and starts the clock', () => {
  const { state, outages, changes } = applyResults(emptyState(), [], { a: { ok: true }, b: { ok: true } }, T0);
  assert.equal(state.monitoringSince, '2026-10-28T10:00:00.000Z');
  assert.equal(state.keepaliveMonth, '2026-10');
  assert.deepEqual(state.services.a, { status: 'up', since: '2026-10-28T10:00:00.000Z' });
  assert.deepEqual(outages, []);
  assert.deepEqual(
    changes.map((c) => [c.id, c.from, c.to]),
    [
      ['a', null, 'up'],
      ['b', null, 'up'],
    ],
  );
});

test('a check that agrees with the record changes nothing', () => {
  const first = applyResults(emptyState(), [], { a: { ok: true } }, T0);
  const second = applyResults(first.state, first.outages, { a: { ok: true } }, T0 + 5 * MIN);
  assert.deepEqual(second.state, first.state);
  assert.deepEqual(second.outages, first.outages);
  assert.deepEqual(second.changes, []);
});

test('down then up opens and closes one outage', () => {
  const up = applyResults(emptyState(), [], { a: { ok: true } }, T0);
  const down = applyResults(up.state, up.outages, { a: { ok: false, reason: 'HTTP 503' } }, T0 + 5 * MIN);
  assert.deepEqual(down.outages, [{ service: 'a', start: '2026-10-28T10:05:00.000Z', end: null, reason: 'HTTP 503' }]);
  assert.equal(down.changes[0].to, 'down');

  const still = applyResults(down.state, down.outages, { a: { ok: false, reason: 'timeout' } }, T0 + 10 * MIN);
  assert.deepEqual(still.changes, []);
  assert.equal(still.outages[0].reason, 'HTTP 503', 'the reason is the first one seen');

  const back = applyResults(still.state, still.outages, { a: { ok: true } }, T0 + 20 * MIN);
  assert.equal(back.outages[0].end, '2026-10-28T10:20:00.000Z');
  assert.deepEqual(back.changes, [{ id: 'a', from: 'down', to: 'up', reason: null }]);
});

test('does not mutate its inputs', () => {
  const outages = [{ service: 'a', start: '2026-10-28T09:00:00.000Z', end: null, reason: null }];
  const state = { monitoringSince: 'x', keepaliveMonth: '2026-10', services: { a: { status: 'down', since: 'x' } } };
  const frozen = structuredClone({ state, outages });
  applyResults(state, outages, { a: { ok: true } }, T0);
  assert.deepEqual({ state, outages }, frozen);
});

test('a new month changes the state even when nothing else does', () => {
  const first = applyResults(emptyState(), [], { a: { ok: true } }, Date.parse('2026-10-31T23:58:00Z'));
  const next = applyResults(first.state, first.outages, { a: { ok: true } }, Date.parse('2026-11-01T00:03:00Z'));
  assert.equal(next.state.keepaliveMonth, '2026-11');
  assert.deepEqual(next.changes, []);
});

test('downtime clips to the window and counts an open outage up to now', () => {
  const outages = [
    { service: 'a', start: '2026-10-28T09:50:00Z', end: '2026-10-28T10:10:00Z' },
    { service: 'a', start: '2026-10-28T11:00:00Z', end: null },
    { service: 'b', start: '2026-10-28T10:00:00Z', end: '2026-10-28T12:00:00Z' },
  ];
  assert.equal(downtimeMinutes(outages, 'a', T0, T0 + 60 * MIN, T0 + 90 * MIN), 10);
  assert.equal(downtimeMinutes(outages, 'a', T0, T0 + 120 * MIN, T0 + 90 * MIN), 40);
});

test('daily history marks days before monitoring as none, and grades the rest', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const outages = [
    { service: 'a', start: '2026-10-27T01:00:00Z', end: '2026-10-27T01:10:00Z' },
    { service: 'a', start: '2026-10-28T02:00:00Z', end: '2026-10-28T04:00:00Z' },
  ];
  const days = dailyHistory(outages, 'a', '2026-10-26T15:00:00Z', now, 5, 30);
  assert.deepEqual(
    days.map((d) => [d.date, d.level, d.minutes]),
    [
      ['2026-10-24', 'none', 0],
      ['2026-10-25', 'none', 0],
      ['2026-10-26', 'up', 0],
      ['2026-10-27', 'minor', 10],
      ['2026-10-28', 'major', 120],
    ],
  );
});

test('uptime is measured over the monitored window only', () => {
  const now = T0 + 100 * MIN;
  const outages = [{ service: 'a', start: '2026-10-28T10:00:00Z', end: '2026-10-28T10:10:00Z' }];
  assert.equal(uptimeRatio(outages, 'a', '2026-10-28T10:00:00Z', now, 90), 0.9);
  assert.equal(uptimeRatio(outages, 'a', null, now, 90), null);
  assert.equal(uptimeRatio(outages, 'a', '2026-10-28T11:00:00Z', now, 90), null, 'under an hour is too new');
});

test('percent floors, so it never claims a 100% that was not', () => {
  assert.equal(formatPercent(1), '100%');
  assert.equal(formatPercent(0.99999), '99.99%');
  assert.equal(formatPercent(0.9), '90.00%');
});

test('durations read as words', () => {
  assert.equal(formatMinutes(0.2), '1 minute');
  assert.equal(formatMinutes(12), '12 minutes');
  assert.equal(formatMinutes(60), '1 hour');
  assert.equal(formatMinutes(125), '2 hours 5 minutes');
});
