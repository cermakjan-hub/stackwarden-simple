// @ts-check
// Runs a provider's CLI that the person installed and signed in to themselves, the way a person
// would, and answers what it printed. It finds the program on PATH, starts it without a shell, in
// the plugin's data folder, with the provider's own variables cleared so no stray token or setting
// reaches it, and stops it after two minutes or 64 MiB of output.
// It installs nothing, signs nothing in by itself, and runs only the commands a connector lists.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 64 * 1024 * 1024;

/** @typedef {{ file: string, prefix: string[] }} Program */
/** @typedef {{ exitCode: number, stdout: string, stderr: string }} Result */

/** @param {string} path */
const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * A program found on PATH. On Windows npm installs a `.cmd` shim, which can't start without a
 * shell, so the script it names is run with Node itself.
 * @param {string} command
 * @returns {Program | null}
 */
export function findOnPath(command, env = process.env) {
  const folders = (env.PATH ?? env.Path ?? '').split(delimiter).filter((folder) => isAbsolute(folder));
  const windows = process.platform === 'win32';
  const extensions = windows ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';') : [''];
  for (const folder of folders) {
    for (const extension of extensions) {
      const file = join(folder, command + extension);
      if (!isFile(file)) continue;
      if (!windows || extension === '.exe') return { file, prefix: [] };
      if (extension !== '.cmd') continue;
      const script = /"%~?dp0%?\\([^"%]+\.(?:c|m)?js)"/i.exec(readFileSync(file, 'utf8'))?.[1];
      const path = script ? resolve(dirname(file), script) : null;
      if (path && existsSync(path)) return { file: process.execPath, prefix: [path] };
    }
  }
  return null;
}

// At most this many CLI runs at once, for every connector this process reads. Each run is a program
// of its own, often Node, on a computer that also runs the person's editor and dev server.
const AT_ONCE = 4;
let running = 0;
/** @type {(() => void)[]} */
const waiting = [];

/**
 * Runs the program and collects its output, waiting its turn while `AT_ONCE` others run. A run that
 * takes too long or prints too much is stopped, and answers as a failure.
 * @param {Program} program
 * @param {string[]} args
 * @param {{ cwd: string, clear: string[], set: Record<string, string> }} options
 * @returns {Promise<Result>}
 */
export async function run(program, args, options) {
  // A finished run hands its place to the next in line, so no newcomer slips in between.
  if (running < AT_ONCE) running += 1;
  else await new Promise((/** @type {(value?: unknown) => void} */ resolve) => waiting.push(resolve));
  try {
    return await start(program, args, options);
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

/**
 * One run of the program.
 * @param {Program} program @param {string[]} args
 * @param {{ cwd: string, clear: string[], set: Record<string, string> }} options
 * @returns {Promise<Result>}
 */
function start(program, args, { cwd, clear, set }) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !clear.some((prefix) => name.toUpperCase().startsWith(prefix))) env[name] = value;
  }
  Object.assign(env, set);
  return new Promise((done, fail) => {
    const child = spawn(program.file, [...program.prefix, ...args], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    /** @type {Buffer[]} */
    const out = [];
    /** @type {Buffer[]} */
    const err = [];
    let size = 0;
    /** @type {string | null} */
    let stopped = null;
    const stop = (/** @type {string} */ why) => {
      stopped = why;
      child.kill();
    };
    const timer = setTimeout(() => stop('The CLI took too long.'), TIMEOUT_MS);
    const collect = (/** @type {Buffer[]} */ into) => (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) stop('The CLI printed too much.');
      else into.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    child.on('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(
        stopped
          ? { exitCode: 1, stdout: '', stderr: stopped }
          : {
              exitCode: code ?? 1,
              stdout: Buffer.concat(out).toString('utf8'),
              stderr: Buffer.concat(err).toString('utf8'),
            },
      );
    });
  });
}

/** The first `x.y.z` the program printed for `--version`. @param {Result} result */
export const versionOf = (result) => /\b(\d+\.\d+\.\d+)\b/.exec(`${result.stdout}\n${result.stderr}`)?.[1] ?? null;

/** @param {string} version @param {string} minimum */
export function atLeast(version, minimum) {
  const have = version.split('.').map(Number);
  const want = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((have[index] ?? 0) !== (want[index] ?? 0)) return (have[index] ?? 0) > (want[index] ?? 0);
  }
  return true;
}

/**
 * What a run means, as an HTTP-like status: the CLI's own `(401)` at the end of its errors, words
 * that say it is signed out, or a failure.
 * @param {Result} result
 */
export function statusOf(result) {
  if (result.exitCode === 0) return 200;
  const stated = /\((\d{3})\)\s*$/m.exec(result.stderr)?.[1];
  if (stated) return Number(stated);
  return /not (?:logged|signed) in|no existing credentials|please log ?in|run [`'"]?[a-z-]+ login/i.test(result.stderr)
    ? 401
    : 502;
}

/** @param {number} status */
export function problemOf(status) {
  if (status === 401) return 'auth_invalid';
  if (status === 403 || status === 404) return 'permission_missing';
  if (status === 402) return 'not_on_plan';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'provider_down' : 'unexpected_shape';
}
