// Render the site into dist/ from the committed record, the incidents, and the
// last run's results (if this machine ran the checks).
//
//   node src/build.mjs

import { createHash } from 'node:crypto';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SERVICES, SITE } from './config.mjs';
import { DATA, DIST_DIR, INCIDENTS_DIR, readJson, SITE_DIR } from './files.mjs';
import { escape } from './html.mjs';
import { loadIncidents } from './incidents.mjs';
import { buildModel, describeReason, fmtDateTime, render404, renderIndex, renderStatusJson } from './render.mjs';
import { formatMinutes } from './state.mjs';

export function renderFeed(model, services) {
  const entries = [
    ...model.active.map((i) => ({ kind: 'incident', incident: i })),
    ...model.past,
    ...model.rows
      .filter((r) => r.status === 'down' && r.since)
      .map((r) => ({ kind: 'open-outage', row: r })),
  ].map((e) => {
    if (e.kind === 'incident') {
      const i = e.incident;
      const names = i.services.map((id) => services.find((s) => s.id === id)?.name ?? id).join(', ');
      const content = i.updates.map((u) => `<p><strong>${escape(fmtDateTime(u.at))} · ${u.state}</strong></p>${u.html}`).join('');
      return {
        id: `${SITE.url}/#incident-${i.slug}`,
        title: `${i.title} (${i.state})`,
        updated: i.updates[0].at,
        summary: names,
        content,
      };
    }
    if (e.kind === 'open-outage') {
      const r = e.row;
      return {
        id: `${SITE.url}/#outage-${r.id}-${r.since}`,
        title: `${r.subject} is down`,
        updated: r.since,
        content: `<p>${escape(`${r.subject} (${r.host}) ${describeReason(r.reason)}, first seen ${fmtDateTime(r.since)}.`)}</p>`,
      };
    }
    const o = e.outage;
    return {
      // Same id as the open entry, so a reader updates it in place on recovery.
      id: `${SITE.url}/#outage-${o.service}-${o.start}`,
      title: `${e.service.subject} was down for ${formatMinutes(e.minutes)}`,
      updated: o.end,
      content: `<p>${escape(`${e.service.subject} (${e.service.host}) ${describeReason(o.reason)}, from ${fmtDateTime(o.start)} to ${fmtDateTime(o.end)}.`)}</p>`,
    };
  });
  entries.sort((a, b) => b.updated.localeCompare(a.updated));
  const updated = entries[0]?.updated ?? model.monitoringSince ?? model.generatedAt;

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Bracemark status</title>
  <id>${SITE.url}/</id>
  <link rel="alternate" href="${SITE.url}/"/>
  <link rel="self" href="${SITE.url}/feed.xml"/>
  <updated>${updated}</updated>
  <author><name>Bracemark</name></author>
${entries
  .map(
    (e) => `  <entry>
    <id>${escape(e.id)}</id>
    <title>${escape(e.title)}</title>
    <link rel="alternate" href="${SITE.url}/"/>
    <updated>${e.updated}</updated>${e.summary ? `\n    <summary>${escape(e.summary)}</summary>` : ''}
    <content type="html">${escape(e.content)}</content>
  </entry>`,
  )
  .join('\n')}
</feed>
`;
}

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 10);

async function main() {
  const now = Date.now();
  const [state, outages, lastRun, incidents] = await Promise.all([
    readJson(DATA.state),
    readJson(DATA.outages),
    readJson(DATA.lastRun),
    loadIncidents(
      INCIDENTS_DIR,
      SERVICES.map((s) => s.id),
    ),
  ]);
  const model = buildModel({ services: SERVICES, state, outages: outages ?? [], incidents, lastRun, now });

  await rm(DIST_DIR, { recursive: true, force: true });
  await cp(SITE_DIR, DIST_DIR, { recursive: true });
  const assets = {
    css: hash(await readFile(join(SITE_DIR, 'style.css'))),
    js: hash(await readFile(join(SITE_DIR, 'page.js'))),
  };
  const statusJson = renderStatusJson(model);
  model.version = statusJson.version;
  await writeFile(join(DIST_DIR, 'index.html'), renderIndex(model, SERVICES, assets));
  await writeFile(join(DIST_DIR, '404.html'), render404(assets));
  await writeFile(join(DIST_DIR, 'status.json'), `${JSON.stringify(statusJson, null, 2)}\n`);
  await writeFile(join(DIST_DIR, 'feed.xml'), renderFeed(model, SERVICES));

  console.log(`built dist/ — ${model.headline} (${incidents.length} incident file(s))`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
