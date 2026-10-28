import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { INTERVAL_MINUTES, SERVICES, STALE_AFTER_MINUTES } from '../src/config.mjs';

test('the cron line fires every INTERVAL_MINUTES, off the hour', async () => {
  const yml = await readFile(new URL('../.github/workflows/status.yml', import.meta.url), 'utf8');
  const cron = /- cron: '([^']+)'/.exec(yml)?.[1];
  const m = /^(\d+)-59\/(\d+) \* \* \* \*$/.exec(cron ?? '');
  assert.ok(m, `expected "<offset>-59/<step> * * * *", got ${cron}`);
  assert.equal(Number(m[2]), INTERVAL_MINUTES, 'the page states this interval');
  assert.ok(Number(m[1]) > 0 && Number(m[1]) < INTERVAL_MINUTES, 'offset from :00');
  assert.ok(STALE_AFTER_MINUTES > 2 * INTERVAL_MINUTES, 'one late run must not read as overdue');
});

test('every service has the copy the page needs', () => {
  const ids = new Set();
  for (const s of SERVICES) {
    for (const key of ['id', 'name', 'subject', 'host', 'url', 'expect', 'description']) assert.ok(s[key], `${s.id}.${key}`);
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
    assert.doesNotMatch(`${s.name} ${s.subject} ${s.description}`, /'/, `${s.id}: use ’, not '`);
  }
});
