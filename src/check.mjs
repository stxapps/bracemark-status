// One run of the checks: probe every service, fold the results into data/, and
// leave the run itself in data/last-run.json (gitignored) for the build.
//
//   node src/check.mjs
//
// Under GitHub Actions it also writes two step outputs: `message` (the commit
// message, empty when data/ did not change) and `went-down` (true when a service
// went from up to down this run — the workflow fails on it so GitHub emails the
// schedule's owner, once per outage rather than once per check).

import { appendFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { ATTEMPTS, RETRY_DELAY_MS, SERVICES, TIMEOUT_MS, USER_AGENT } from './config.mjs';
import { readJson, writeJson, DATA } from './files.mjs';
import { applyResults, emptyState } from './state.mjs';

/** One request. Never throws: a failure is a result with a reason. */
export async function probe(service, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const res = await fetchImpl(service.url, {
      headers: { 'user-agent': USER_AGENT, 'cache-control': 'no-cache' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, ms: elapsed(), reason: `HTTP ${res.status}` };
    if (service.expect === 'health') {
      let json;
      try {
        json = JSON.parse(body);
      } catch {
        return { ok: false, ms: elapsed(), reason: 'unexpected response' };
      }
      if (json?.status !== 'ok') return { ok: false, ms: elapsed(), reason: 'unexpected response' };
    }
    return { ok: true, ms: elapsed() };
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, ms: elapsed(), reason: timedOut ? 'timeout' : (err?.cause?.code ?? 'unreachable') };
  }
}

/** Up to `attempts` probes; the first success wins. */
export async function checkService(service, { attempts = ATTEMPTS, retryDelayMs = RETRY_DELAY_MS, ...opts } = {}) {
  let result;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(retryDelayMs);
    result = await probe(service, opts);
    if (result.ok) return { ...result, attempts: i + 1 };
  }
  return { ...result, attempts };
}

export function commitMessage(changes, services, stateChanged) {
  if (changes.length === 0) return stateChanged ? 'Keep the schedule alive' : '';
  const name = (id) => services.find((s) => s.id === id)?.host ?? id;
  return changes
    .map((c) => {
      if (c.to === 'down') return `${name(c.id)} is down${c.reason ? ` (${c.reason})` : ''}`;
      return c.from === 'down' ? `${name(c.id)} is back up` : `${name(c.id)} is up`;
    })
    .join('; ');
}

async function main() {
  const now = Date.now();
  const entries = await Promise.all(SERVICES.map(async (s) => [s.id, await checkService(s)]));
  const results = Object.fromEntries(entries);

  const state = (await readJson(DATA.state)) ?? emptyState();
  const outages = (await readJson(DATA.outages)) ?? [];
  const next = applyResults(state, outages, results, now);

  const stateChanged = JSON.stringify(next.state) !== JSON.stringify(state);
  const outagesChanged = JSON.stringify(next.outages) !== JSON.stringify(outages);
  if (stateChanged) await writeJson(DATA.state, next.state);
  if (outagesChanged) await writeJson(DATA.outages, next.outages);
  await writeJson(DATA.lastRun, { checkedAt: new Date(now).toISOString(), results });

  for (const s of SERVICES) {
    const r = results[s.id];
    console.log(`${r.ok ? 'up  ' : 'DOWN'}  ${s.host.padEnd(26)} ${String(r.ms).padStart(5)} ms  ${r.attempts} attempt(s)${r.reason ? `  ${r.reason}` : ''}`);
  }

  const message = commitMessage(next.changes, SERVICES, stateChanged || outagesChanged);
  const wentDown = next.changes.some((c) => c.to === 'down');
  if (message) console.log(`\nchanged: ${message}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `message=${message}\nwent-down=${wentDown}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
