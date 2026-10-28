// Incidents are the part a person writes: one markdown file per incident in
// incidents/, format in the README. The parser is strict on purpose — a file it
// cannot read fails the build, and a failed build deploys nothing, so a typo
// can never publish a half-parsed incident.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { escape } from './html.mjs';

export const STATES = ['investigating', 'identified', 'monitoring', 'resolved'];

const UPDATE_HEADING =
  /^##\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?:\s*UTC)?\s+(?:[—–·-]\s*)?([a-z]+)\s*$/i;

export function parseIncident(slug, text, serviceIds) {
  const fail = (msg) => {
    throw new Error(`incidents/${slug}.md: ${msg}`);
  };
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replaceAll('\r\n', '\n'));
  if (!match) fail('must start with a --- front matter block ---');

  const meta = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const kv = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!kv) fail(`cannot read front matter line "${line}"`);
    meta[kv[1]] = kv[2].trim();
  }
  if (!meta.title) fail('needs a title');
  const services = (meta.services ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (services.length === 0) fail(`needs services: one or more of ${serviceIds.join(', ')}`);
  for (const s of services) if (!serviceIds.includes(s)) fail(`unknown service "${s}"`);

  const updates = [];
  let current = null;
  for (const line of match[2].split('\n')) {
    if (line.startsWith('## ')) {
      const h = UPDATE_HEADING.exec(line);
      if (!h) fail(`cannot read update heading "${line}" — expected "## 2026-10-28 14:05 UTC investigating"`);
      const state = h[3].toLowerCase();
      if (!STATES.includes(state)) fail(`unknown state "${h[3]}" — one of ${STATES.join(', ')}`);
      const at = new Date(`${h[1]}T${h[2]}:00Z`);
      if (Number.isNaN(at.getTime())) fail(`bad date in "${line}"`);
      current = { at: at.toISOString(), state, lines: [] };
      updates.push(current);
    } else if (current) {
      current.lines.push(line);
    } else if (line.trim()) {
      fail('text before the first ## update heading');
    }
  }
  if (updates.length === 0) fail('needs at least one ## update');

  updates.sort((a, b) => b.at.localeCompare(a.at));
  for (const u of updates) {
    u.html = markdown(u.lines.join('\n'));
    if (!u.html) fail(`the ${u.at} update has no text`);
    delete u.lines;
  }
  const latest = updates[0];
  return {
    slug,
    title: meta.title,
    services,
    state: latest.state,
    start: updates.at(-1).at,
    end: latest.state === 'resolved' ? latest.at : null,
    updates,
  };
}

export async function loadIncidents(dir, serviceIds) {
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const incidents = [];
  for (const name of names.filter((n) => n.endsWith('.md') && n !== 'README.md')) {
    const text = await readFile(join(dir, name), 'utf8');
    incidents.push(parseIncident(name.slice(0, -3), text, serviceIds));
  }
  return incidents.sort((a, b) => b.start.localeCompare(a.start));
}

/**
 * The markdown an incident update needs and nothing more: paragraphs, "- "
 * lists, **bold**, `code` and [links](https://…). Everything is escaped first,
 * so raw HTML in a file shows as text.
 */
export function markdown(text) {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^[-*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${inline(lines.join(' '))}</p>`;
    })
    .join('\n');
}

function inline(text) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${escape(part.slice(1, -1))}</code>`;
      return escape(part)
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    })
    .join('');
}
