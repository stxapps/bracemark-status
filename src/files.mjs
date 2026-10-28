import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const DATA = {
  state: join(ROOT, 'data/state.json'),
  outages: join(ROOT, 'data/outages.json'),
  lastRun: join(ROOT, 'data/last-run.json'),
};
export const INCIDENTS_DIR = join(ROOT, 'incidents');
export const SITE_DIR = join(ROOT, 'site');
export const DIST_DIR = join(ROOT, 'dist');

/** Parsed JSON, or null when the file does not exist yet. */
export async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
