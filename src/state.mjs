// The record, and the only code that changes it.
//
// Two committed files, both written only when something CHANGES, never per check:
//
//   data/state.json    { monitoringSince, keepaliveMonth, services: { [id]: { status, since } } }
//   data/outages.json  [{ service, start, end, reason }]   end is null while open
//
// A check that agrees with the record writes nothing, so a quiet day is zero
// commits and the git log of data/ reads as the outage history. Uptime is
// derived from the outage list (downtime over the monitored window), not from
// counting checks — counting would need a write on every run.
//
// Times are ISO strings in UTC throughout.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function emptyState() {
  return { monitoringSince: null, keepaliveMonth: null, services: {} };
}

/**
 * Fold one run's results into the record.
 *
 * `results` is `{ [serviceId]: { ok, reason? } }`. Returns the next state and
 * outage list (new objects; the inputs are not mutated) plus the transitions,
 * which drive the commit message and the alert.
 */
export function applyResults(state, outages, results, now) {
  const nowIso = new Date(now).toISOString();
  const next = {
    monitoringSince: state.monitoringSince ?? nowIso,
    // GitHub disables a public repo's scheduled workflows after 60 days with no
    // activity. A quiet stretch writes nothing, so the first run of each month
    // writes this instead — one commit a month keeps the schedule alive.
    keepaliveMonth: nowIso.slice(0, 7),
    services: { ...state.services },
  };
  const nextOutages = outages.map((o) => ({ ...o }));
  const changes = [];

  for (const [id, result] of Object.entries(results)) {
    const status = result.ok ? 'up' : 'down';
    const prev = state.services[id];
    if (prev?.status === status) continue;

    next.services[id] = { status, since: nowIso };
    changes.push({ id, from: prev?.status ?? null, to: status, reason: result.reason ?? null });

    if (status === 'down') {
      nextOutages.push({ service: id, start: nowIso, end: null, reason: result.reason ?? null });
    } else {
      for (const o of nextOutages) if (o.service === id && o.end === null) o.end = nowIso;
    }
  }

  return { state: next, outages: nextOutages, changes };
}

/** Minutes of `outages` for `serviceId` overlapping [from, to). */
export function downtimeMinutes(outages, serviceId, from, to, now) {
  let ms = 0;
  for (const o of outages) {
    if (o.service !== serviceId) continue;
    const start = Math.max(Date.parse(o.start), from);
    const end = Math.min(o.end ? Date.parse(o.end) : now, to);
    if (end > start) ms += end - start;
  }
  return ms / MINUTE;
}

/**
 * One entry per UTC day, oldest first, ending today. A day before monitoring
 * began is `none` — no checks ran, which is not the same claim as no downtime.
 */
export function dailyHistory(outages, serviceId, monitoringSince, now, days, minorMinutes) {
  const since = monitoringSince ? Date.parse(monitoringSince) : now;
  const todayStart = Math.floor(now / DAY) * DAY;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const from = todayStart - i * DAY;
    const to = from + DAY;
    const date = new Date(from).toISOString().slice(0, 10);
    if (to <= since) {
      out.push({ date, level: 'none', minutes: 0 });
      continue;
    }
    const minutes = downtimeMinutes(outages, serviceId, from, Math.min(to, now), now);
    const level = minutes === 0 ? 'up' : minutes <= minorMinutes ? 'minor' : 'major';
    out.push({ date, level, minutes });
  }
  return out;
}

/**
 * Share of the window [max(since, now - days), now] that was not downtime, or
 * null when monitoring is younger than an hour and a percentage would be noise.
 */
export function uptimeRatio(outages, serviceId, monitoringSince, now, days) {
  if (!monitoringSince) return null;
  const from = Math.max(Date.parse(monitoringSince), now - days * DAY);
  const window = now - from;
  if (window < 60 * MINUTE) return null;
  return 1 - (downtimeMinutes(outages, serviceId, from, now, now) * MINUTE) / window;
}

/** "99.98%" — floored, never rounded up to a 100% that wasn't. */
export function formatPercent(ratio) {
  if (ratio >= 1) return '100%';
  const floored = Math.floor(ratio * 10_000) / 100;
  return `${floored.toFixed(2)}%`;
}

export function formatMinutes(minutes) {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const hours = `${h} hour${h === 1 ? '' : 's'}`;
  return rest ? `${hours} ${rest} minute${rest === 1 ? '' : 's'}` : hours;
}
