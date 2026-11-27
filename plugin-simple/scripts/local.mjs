// @ts-check
// What the plugin keeps on this computer, all in its own data folder (ADR 0081):
//   reader.json         the Stackwarden address and this computer's key for its organization; secret, mode 0600
//   reader-state.json   when each provider was last read or tried, and a problem to say once
//   panel-summary.json  what the panel shows: names and numbers, never a key or a value
//   reading.json        a reading kept until the person's yes
//   reading-later.json  the kept reading's `later` steps: the background run's process, and when done
//   repo-choices.json   a repo the person said has no Vercel project
//   reader.lock         one background reading at a time
//   cli-login.*         the Vercel CLI's own sign-in while it runs
// It reads two files of Claude Code's, `settings.json` and `plugins/known_marketplaces.json`, for
// auto-update, and writes one key of `settings.json` on the person's click. Nothing else.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

/** Claude Code's own folder: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export function claudeFolder(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : join(homedir(), '.claude');
}

/**
 * The plugin's data folder, only if it is one: a folder directly in `<claude>/plugins/data` whose
 * name starts with `stackwarden`. So no argument or variable points the plugin at another key.
 * @param {string | undefined} candidate
 */
export function dataFolder(candidate, env = process.env) {
  if (!candidate) return null;
  const root = resolve(claudeFolder(env), 'plugins', 'data');
  const folder = resolve(candidate);
  const inside = relative(root, folder);
  const direct = inside !== '' && !inside.startsWith('..') && !isAbsolute(inside) && !/[\\/]/.test(inside);
  if (!direct || !basename(folder).toLowerCase().startsWith('stackwarden')) return null;
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  return folder;
}

/** @param {string} path */
export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch {
    return undefined;
  }
}

/** Writes JSON readable by this user only, through a temporary file so a reader never sees half of it. */
export function writeJson(/** @type {string} */ path, /** @type {unknown} */ value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(temporary, path);
  } catch {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    rmQuietly(temporary);
  }
}

/** @param {string} path */
export function rmQuietly(path) {
  try {
    unlinkSync(path);
  } catch {
    // Gone already.
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
export const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export const KEY = /^swk_[A-Za-z0-9_-]{43}$/;

/**
 * @typedef {{ id: string, name: string | null, key: string, pairedAt: string }} Organization
 * @typedef {{ version: 2, url: string, organizations: Organization[], accounts: Record<string, Record<string, string[]>> }} Config
 */

/**
 * This computer's connection, or null before it is connected. 0.4.x wrote the same file.
 * @param {string} folder
 * @returns {Config | null}
 */
export function config(folder) {
  const file = readJson(join(folder, 'reader.json'));
  if (!isObject(file) || file.version !== 2 || typeof file.url !== 'string' || !Array.isArray(file.organizations)) {
    return null;
  }
  /** @type {Organization[]} */
  const organizations = file.organizations.filter(
    (/** @type {unknown} */ each) => isObject(each) && typeof each.id === 'string' && KEY.test(String(each.key)),
  );
  return {
    version: 2,
    url: file.url,
    organizations,
    accounts: isObject(file.accounts) ? file.accounts : {},
  };
}

/** @param {string} folder @param {Config} value */
export function saveConfig(folder, value) {
  writeJson(join(folder, 'reader.json'), value);
}

/**
 * When each provider was last sent and tried, and a problem the next session says once.
 * @typedef {{ sentAt: string | null, triedAt: string | null, problem: string | null }} ProviderRun
 * @param {string} folder
 * @returns {{ providers: Record<string, ProviderRun> }}
 */
export function state(folder) {
  const file = readJson(join(folder, 'reader-state.json'));
  return isObject(file) && isObject(file.providers) ? { providers: file.providers } : { providers: {} };
}

/** @param {string} folder @param {{ providers: Record<string, ProviderRun> }} value */
export function saveState(folder, value) {
  writeJson(join(folder, 'reader-state.json'), value);
}

const PANEL_PARTS = /** @type {const} */ (['summaries', 'rounds', 'repos', 'scanned', 'answers']);

/**
 * What the panel shows, each part on its own: a part that can't be read starts empty, the rest stay.
 * @param {string} folder
 * @returns {Record<string, any>}
 */
export function panelFile(folder) {
  const file = readJson(join(folder, 'panel-summary.json'));
  /** @type {Record<string, any>} */
  const kept = { view: isObject(file) && isObject(file.view) ? file.view : null };
  for (const part of PANEL_PARTS) kept[part] = isObject(file) && isObject(file[part]) ? file[part] : {};
  return kept;
}

/** @param {string} folder @param {(file: Record<string, any>) => Record<string, any>} change */
export function updatePanelFile(folder, change) {
  writeJson(join(folder, 'panel-summary.json'), change(panelFile(folder)));
}

/** @param {string} folder @param {string} remote */
export function noVercelFor(folder, remote) {
  const choices = readJson(join(folder, 'repo-choices.json'));
  return isObject(choices) && isObject(choices[remote]) && choices[remote].vercel === 'none';
}

/** @param {string} folder @param {string} remote */
export function rememberNoVercel(folder, remote) {
  const choices = readJson(join(folder, 'repo-choices.json'));
  writeJson(join(folder, 'repo-choices.json'), { ...(isObject(choices) ? choices : {}), [remote]: { vercel: 'none' } });
}

const LOCK_FOR_MS = 30 * 60_000;

/** Takes the reading lock, or says another reading holds it. A lock older than 30 minutes is taken over. */
export function takeLock(/** @type {string} */ folder, /** @type {string} */ owner) {
  const lock = join(folder, 'reader.lock');
  try {
    writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 });
    return true;
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs < LOCK_FOR_MS) return false;
      unlinkSync(lock);
      writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }
}

export function releaseLock(/** @type {string} */ folder, /** @type {string} */ owner) {
  const lock = join(folder, 'reader.lock');
  try {
    if (readFileSync(lock, 'utf8') === owner) unlinkSync(lock);
  } catch {
    // Someone else's, or gone.
  }
}

/**
 * The marketplace this copy of the plugin was installed from, read from its own path
 * (`<claude>/plugins/cache/<marketplace>/<plugin>/<version>/scripts`), or null for a local build.
 * @param {string} self
 */
export function marketplaceOf(self) {
  const match = /[\\/]plugins[\\/]cache[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]/i.exec(self);
  return match?.[1] && match[2] ? { marketplace: match[1], plugin: `${match[2]}@${match[1]}` } : null;
}

/**
 * Whether new versions arrive by themselves, for the marketplace the plugin came from: the setting
 * in `settings.json` wins, else Claude Code's own `/plugin` toggle. Null when it can't be told.
 * @param {string} marketplace
 */
export function autoUpdateState(marketplace, env = process.env) {
  const settings = readJson(join(claudeFolder(env), 'settings.json'));
  const entry =
    isObject(settings) && isObject(settings.extraKnownMarketplaces)
      ? settings.extraKnownMarketplaces[marketplace]
      : undefined;
  if (isObject(entry) && typeof entry.autoUpdate === 'boolean') return entry.autoUpdate;
  const known = readJson(join(claudeFolder(env), 'plugins', 'known_marketplaces.json'));
  const knownEntry = isObject(known) ? known[marketplace] : undefined;
  return isObject(knownEntry) ? knownEntry.autoUpdate === true : null;
}

/**
 * On the person's click: auto-update on for the marketplace the plugin came from, and nothing else
 * changed. Its entry keeps its own source, or takes the one Claude Code recorded when the marketplace
 * was added; the plugin never names a source of its own, so updates keep coming from where they did.
 * @param {string} marketplace
 * @returns {'on' | 'unreadable' | 'unknown'}
 */
export function turnOnAutoUpdate(marketplace, env = process.env) {
  const path = join(claudeFolder(env), 'settings.json');
  const text = existsSync(path) ? readFileSync(path, 'utf8').replace(/^﻿/, '') : '';
  /** @type {unknown} */
  let settings = {};
  if (text.trim() !== '') {
    try {
      settings = JSON.parse(text);
    } catch {
      return 'unreadable';
    }
  }
  if (!isObject(settings)) return 'unreadable';
  const marketplaces = settings.extraKnownMarketplaces ?? {};
  if (!isObject(marketplaces)) return 'unreadable';
  const entry = isObject(marketplaces[marketplace]) ? marketplaces[marketplace] : {};
  const known = readJson(join(claudeFolder(env), 'plugins', 'known_marketplaces.json'));
  const source =
    entry.source ?? (isObject(known) && isObject(known[marketplace]) ? known[marketplace].source : undefined);
  if (!isObject(source)) return 'unknown';
  writeJson(path, {
    ...settings,
    extraKnownMarketplaces: { ...marketplaces, [marketplace]: { ...entry, source, autoUpdate: true } },
  });
  return 'on';
}
