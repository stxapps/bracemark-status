import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkService, commitMessage, probe } from '../src/check.mjs';

const page = { id: 'site', host: 'bracemark.com', url: 'https://bracemark.com/', expect: 'page' };
const health = { id: 'api', host: 'api.bracemark.com', url: 'https://api.bracemark.com/health', expect: 'health' };

const respond = (status, body) => async () => new Response(body, { status });

test('a 200 page is up', async () => {
  assert.equal((await probe(page, { fetchImpl: respond(200, '<html>') })).ok, true);
});

test('an error status is down, with the status as the reason', async () => {
  const r = await probe(page, { fetchImpl: respond(503, 'oops') });
  assert.deepEqual([r.ok, r.reason], [false, 'HTTP 503']);
});

test('a health check needs {"status":"ok"}, not just a 200', async () => {
  assert.equal((await probe(health, { fetchImpl: respond(200, '{"status":"ok"}') })).ok, true);
  const html = await probe(health, { fetchImpl: respond(200, '<html>captive portal</html>') });
  assert.deepEqual([html.ok, html.reason], [false, 'unexpected response']);
  const wrong = await probe(health, { fetchImpl: respond(200, '{"status":"degraded"}') });
  assert.equal(wrong.ok, false);
});

test('a timeout and a network error are down, with a reason', async () => {
  const hang = (_url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const t = await probe(page, { fetchImpl: hang, timeoutMs: 20 });
  assert.deepEqual([t.ok, t.reason], [false, 'timeout']);

  const dns = async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  };
  const d = await probe(page, { fetchImpl: dns });
  assert.deepEqual([d.ok, d.reason], [false, 'ENOTFOUND']);
});

test('one failed attempt followed by a success is up', async () => {
  let calls = 0;
  const flaky = async () => (++calls === 1 ? new Response('', { status: 502 }) : new Response('ok'));
  const r = await checkService(page, { fetchImpl: flaky, retryDelayMs: 0 });
  assert.deepEqual([r.ok, r.attempts], [true, 2]);
});

test('down only after every attempt fails', async () => {
  let calls = 0;
  const r = await checkService(page, {
    fetchImpl: async () => {
      calls++;
      return new Response('', { status: 500 });
    },
    attempts: 3,
    retryDelayMs: 0,
  });
  assert.deepEqual([r.ok, r.attempts, calls], [false, 3, 3]);
});

test('commit messages name the host and say what changed', () => {
  const services = [page, health];
  assert.equal(commitMessage([], services, false), '');
  assert.equal(commitMessage([], services, true), 'Keep the schedule alive');
  assert.equal(
    commitMessage(
      [
        { id: 'api', from: 'up', to: 'down', reason: 'HTTP 503' },
        { id: 'site', from: 'down', to: 'up' },
      ],
      services,
      true,
    ),
    'api.bracemark.com is down (HTTP 503); bracemark.com is back up',
  );
});
