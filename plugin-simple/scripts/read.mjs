// @ts-check
// Follows a connector's recipe (`connectors/<id>.json`): runs the read commands it lists with the
// person's own CLI, pages as it says, and keeps only the fields it names from each answer. Every
// other field is dropped here, on this computer, before anything is sent. Stackwarden turns the
// answers into a reading with its own connector code.
// It runs no command a recipe doesn't list, adds `--non-interactive` to each, and never passes a
// flag that sends data, changes a setting, or asks for a decrypted value.

import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atLeast, findOnPath, run, statusOf, versionOf } from './cli.mjs';
import { isObject, readJson, rmQuietly, writeJson } from './local.mjs';

const MAX_PAGES = 50;
const NEVER =
  /^(?:-X|--method|-F|--field|-f|--raw-field|--input|-H|--header|-d|--debug|--verbose|-i|--include|-t|--token|--paginate|--cwd|-Q|--global-config|-A|--local-config)$|decrypt/i;

/**
 * A connector's recipe, from `connectors/<id>.json`.
 * @param {string} id
 * @returns {Record<string, any>}
 */
export const recipe = (id) => JSON.parse(readFileSync(new URL(`./connectors/${id}.json`, import.meta.url), 'utf8'));

/**
 * One command's answer as it is sent: the command, its status, and the fields the recipe keeps.
 * @typedef {{ args: string[], status: number, body?: unknown, lines?: true }} Answer
 */

/**
 * A CLI ready to read with. `runner` stands in for the real program in the repo's tests.
 * @typedef {{ program: import('./cli.mjs').Program, version: string, folder: string, recipe: any,
 *   runner?: (args: string[]) => Promise<import('./cli.mjs').Result> }} Cli
 */

/**
 * The provider's CLI on this computer, new enough to read with, or what the person can do about it.
 * @param {any} recipe @param {string} folder
 * @returns {Promise<Cli | { problem: string, onPath: boolean }>}
 */
export async function findCli(recipe, folder, env = process.env) {
  const program = findOnPath(recipe.cli, env);
  const install = `Install it with: ${String(recipe.install)}`;
  if (!program) return { problem: `There's no ${String(recipe.name)} CLI on this computer. ${install}`, onPath: false };
  const version = versionOf(await run(program, ['--version'], { cwd: folder, ...recipe.env }));
  if (!version || !atLeast(version, recipe.minimumVersion)) {
    return {
      problem: `The ${String(recipe.name)} CLI here is older than ${String(recipe.minimumVersion)}. ${install}`,
      onPath: true,
    };
  }
  return { program, version, folder, recipe };
}

/** A read the CLI answered with a failure status: 401 means it is signed out. */
export class Failure extends Error {
  /** @param {number} status */
  constructor(status) {
    super(`The CLI answered ${String(status)}.`);
    this.status = status;
  }
}

/**
 * Keeps only the fields a recipe names: `true` keeps a plain value, `{…}` the named fields of an
 * object, `[…]` each item of a list. Anything not named, and any object where a plain value is
 * expected, is dropped.
 * @param {unknown} value @param {unknown} shape
 * @returns {unknown}
 */
export function keep(value, shape) {
  if (shape === true)
    return value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined;
  if (Array.isArray(shape))
    return Array.isArray(value)
      ? value.map((item) => keep(item, shape[0])).filter((item) => item !== undefined)
      : undefined;
  if (!isObject(shape) || !isObject(value)) return undefined;
  /** @type {Record<string, unknown>} */
  const kept = {};
  for (const [name, inner] of Object.entries(shape)) {
    if (!Object.hasOwn(value, name)) continue;
    const each = keep(value[name], inner);
    if (each !== undefined) kept[name] = each;
  }
  return kept;
}

/** @param {unknown} value @param {string} path */
const at = (value, path) =>
  path.split('.').reduce((/** @type {any} */ inner, part) => (isObject(inner) ? inner[part] : undefined), value);

/**
 * Every account the CLI sees, or the person's own when they have none: id and name, for choosing.
 * Given a reading's answers, which hold both lists, it runs nothing.
 * @param {Cli} cli @param {Answer[]} [read]
 */
export async function accounts(cli, read) {
  const { list, personal } = cli.recipe.accounts;
  const answersTo = async (/** @type {string} */ name) => {
    const step = cli.recipe.reads.find((/** @type {any} */ each) => each.name === name);
    return read ? answersOf(step, read) : follow(cli, step, {});
  };
  const items = (await answersTo(list)).flatMap((answer) =>
    answer.status === 200 ? (at(answer.body, list) ?? []) : [],
  );
  if (items.length > 0)
    return items.map((/** @type {any} */ item) => ({ id: String(item.id), name: String(item.name ?? item.slug) }));
  const [answer] = await answersTo(personal);
  const user = at(answer?.body, personal);
  return [{ id: String(user?.id), name: String(user?.username) }];
}

/** The answers a step's own command got, among a reading's. @param {any} step @param {Answer[]} answers */
const answersOf = (step, answers) =>
  answers.filter((answer) =>
    step.api
      ? answer.args[0] === 'api' && String(answer.args[1]).split('?')[0] === step.api
      : answer.args[0] === step.command[0],
  );

/**
 * Reads one account whole, as the recipe says: every step, once or for each item of an earlier one.
 * Steps run side by side, as many as `run` lets at once; a step for each item waits only for the
 * step that lists the items. With `part`, only the steps the recipe reads `later`, or only the others;
 * a later step for each item takes the items from `known`, the answers the first part got.
 * @param {Cli} cli @param {string} account @param {Date} now @param {'first' | 'later'} [part]
 * @param {Answer[]} [known]
 */
export async function readAccount(cli, account, now, part, known = []) {
  const day = (/** @type {number} */ ms) => new Date(ms).toISOString().slice(0, 10);
  // The last 32 days, as Stackwarden reads them back: above a month, so the first day of a monthly
  // billing period is always in.
  const since = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 31);
  /** @type {Record<string, string>} */
  const values = {
    team: account.startsWith(cli.recipe.team) ? account : '',
    since: String(since),
    until: String(now.getTime()),
    sinceIso: new Date(since).toISOString(),
    untilIso: now.toISOString(),
    lastMonthStart: day(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    today: day(now.getTime()),
  };
  /** @type {any[]} */
  const recipeReads = cli.recipe.reads;
  // A step for each item needs an earlier step that lists items, checked before anything runs.
  recipeReads.forEach((step, index) => {
    if (step.each && !recipeReads.slice(0, index).some((earlier) => earlier.name === step.each && earlier.items))
      throw new Error(`The recipe's step "${String(step.name)}" lists no items.`);
  });
  const reads = recipeReads.filter((step) => part === undefined || Boolean(step.later) === (part === 'later'));
  // Once a step fails, the reading fails, so the other steps start no new run.
  const stop = { failed: false };
  const watched = (/** @type {Promise<Answer[]>} */ promise) =>
    promise.catch((/** @type {unknown} */ error) => {
      stop.failed = true;
      throw error;
    });
  /** @type {Map<string, Promise<Answer[]>>} */
  const steps = new Map();
  for (const step of reads) {
    const source = step.each ? recipeReads.find((earlier) => earlier.name === step.each) : undefined;
    const listed = source ? (steps.get(source.name) ?? Promise.resolve(answersOf(source, known))) : undefined;
    const items = source?.items;
    steps.set(
      step.name,
      watched(
        listed
          ? listed.then(async (got) => {
              const list = got.flatMap((answer) => (answer.status === 200 ? (at(answer.body, items) ?? []) : []));
              const each = await Promise.all(
                list.map((item) => follow(cli, step, { ...values, 'item.id': String(item.id) }, stop)),
              );
              return each.flat();
            })
          : follow(cli, step, values, stop),
      ),
    );
  }
  // In the recipe's order, whichever finished first.
  const answers = (await Promise.all(steps.values())).flat();
  return {
    version: 1,
    provider: cli.recipe.id,
    readAt: now.toISOString(),
    cli: { command: cli.recipe.cli, version: cli.version },
    account,
    answers,
  };
}

// Before the person's first yes, the steps the recipe reads `later`, such as a month of billing
// charges, are read in the background after the others, so the first answer comes in seconds. This
// file in the data folder belongs to one kept reading, by its time: the background run's process ID,
// and `done` once its answers are in the reading.
export const LATER = 'reading-later.json';
const KEPT = 'reading.json';

/** Says the kept reading read at `readAt` waits for its later steps, read by the process `pid`. @param {string} folder @param {string} readAt @param {number | null} pid */
export const markLater = (folder, readAt, pid) =>
  writeJson(join(folder, LATER), { readAt, pid, startedAt: new Date().toISOString() });

/**
 * Reads the later steps of the reading kept in the data folder, at the time it was read, and adds
 * them to it, once.
 * @param {Cli} cli @param {string} folder
 */
export async function addLater(cli, folder) {
  const kept = readJson(join(folder, KEPT));
  const marker = readJson(join(folder, LATER));
  if (!isObject(kept) || !Array.isArray(kept.answers) || !isObject(marker)) return;
  if (marker.readAt !== kept.readAt || marker.done) return;
  const readAt = new Date(String(kept.readAt));
  const later = await readAccount(cli, String(kept.account), readAt, 'later', kept.answers);
  // A newer reading kept meanwhile has later steps of its own.
  const now = readJson(join(folder, KEPT));
  if (!isObject(now) || !Array.isArray(now.answers) || now.readAt !== kept.readAt) return;
  writeJson(join(folder, KEPT), { ...now, answers: [...now.answers, ...later.answers] });
  writeJson(join(folder, LATER), { ...marker, done: true });
}

/**
 * Before the kept reading is sent: waits, up to two minutes, while the background run reads its later
 * steps, then reads here whatever it left.
 * @param {Cli} cli @param {string} folder
 */
export async function withLater(cli, folder) {
  const until = Date.now() + 120_000;
  for (;;) {
    const marker = readJson(join(folder, LATER));
    if (!isObject(marker) || marker.done || !alive(marker.pid) || Date.now() > until) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  await addLater(cli, folder);
}

/**
 * One step: its command with the values filled in, then each next page. A flag or parameter whose
 * value is empty is left out.
 *
 * A step whose `page` says `all` gets every page in one run: the reader adds the CLI's `--paginate`
 * itself, never from the recipe, and files the whole list under `all` as the answer to the command as
 * written, a first page with no next one. That is how Stackwarden's connector reads it back.
 * @param {Cli} cli @param {any} step @param {Record<string, string>} values
 * @param {{ failed: boolean }} stop set once another step of the reading failed
 */
async function follow(cli, step, values, stop = { failed: false }) {
  const fill = (/** @type {string} */ text) => text.replace(/\{([\w.]+)\}/g, (_, name) => values[name] ?? '');
  /** @type {string | undefined} */
  const all = step.page?.all;
  /** @type {Answer[]} */
  const answers = [];
  /** @type {string | undefined} */
  let page;
  for (let count = 0; count < MAX_PAGES; count += 1) {
    if (stop.failed) return answers;
    /** @type {string[]} */
    let args;
    if (step.api) {
      const query = Object.entries({ ...step.query, ...(page ? { [step.page.param]: page } : {}) })
        .map(([name, value]) => [name, fill(String(value))])
        .filter(([, value]) => value !== '');
      const search = query.map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`).join('&');
      const path = fill(step.api);
      args = [...cli.recipe.api.args, search ? `${path}?${search}` : path, ...cli.recipe.api.flags];
    } else {
      args = [];
      const command = [...step.command, ...(page ? [step.page.flag, page] : [])];
      for (let index = 0; index < command.length; index += 1) {
        const part = fill(command[index]);
        if (part === '' && args.length > 0 && String(args.at(-1)).startsWith('--')) args.pop();
        else args.push(part);
      }
    }
    args.push(...cli.recipe.always);
    if (args.some((arg) => NEVER.test(arg.split('=', 1)[0] ?? arg)))
      throw new Error(`The recipe asks for a refused flag: ${args.join(' ')}`);
    const ran = all ? [...args, '--paginate'] : args;
    const result = cli.runner
      ? await cli.runner(ran)
      : await run(cli.program, ran, { cwd: cli.folder, ...cli.recipe.env });
    const status = statusOf(result);
    if (status === 401) throw new Failure(401);
    if (status !== 200) {
      answers.push({ args, status });
      return answers;
    }
    const body = step.lines
      ? group(
          result.stdout
            .split('\n')
            .filter((line) => line.trim() !== '')
            .map((line) => keep(json(line, cli.recipe), step.keep)),
          step.group,
        )
      : keep(
          all ? { [all]: allPages(result.stdout, cli.recipe) } : parse(result.stdout, step.items, cli.recipe),
          step.keep,
        );
    answers.push({ args, status, body, ...(step.lines ? { lines: true } : {}) });
    const next = step.page && !all ? at(body, step.page.next) : undefined;
    if (next === undefined || next === null || next === '') return answers;
    page = String(next);
  }
  return answers;
}

/**
 * Lines that differ only in what the recipe sums become one line a day, as Stackwarden would add them
 * up anyway: a month of a team's billed usage is tens of thousands of lines, and a few hundred sums.
 * `day:` before a field counts it by its UTC day.
 * @param {unknown[]} lines @param {{ by: string[], sum: string[] } | undefined} rule
 */
function group(lines, rule) {
  if (!rule) return lines;
  /** @type {Map<string, any>} */
  const sums = new Map();
  for (const line of lines) {
    if (!isObject(line)) continue;
    const day = (/** @type {unknown} */ value) =>
      typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? `${new Date(value).toISOString().slice(0, 10)}T00:00:00.000Z`
        : value;
    const fields = rule.by.map((field) => (field.startsWith('day:') ? day(at(line, field.slice(4))) : at(line, field)));
    const key = JSON.stringify(fields);
    const kept = sums.get(key);
    if (!kept) {
      const first = structuredClone(line);
      rule.by.forEach((field) => {
        if (field.startsWith('day:')) first[field.slice(4)] = day(at(line, field.slice(4)));
      });
      sums.set(key, first);
      continue;
    }
    for (const field of rule.sum) kept[field] = (Number(kept[field]) || 0) + (Number(line[field]) || 0);
  }
  // A sum of decimals carries the float's noise, 0.30000000000000004 for 0.3. Every summed field is
  // cut to six places: Stackwarden reads costs to a millionth, and a quantity needs no more.
  for (const kept of sums.values()) {
    for (const field of rule.sum) if (typeof kept[field] === 'number') kept[field] = Number(kept[field].toFixed(6));
  }
  return [...sums.values()];
}

/**
 * A CLI's answer as JSON. A parse error would quote the answer, so the error says only which CLI.
 * @param {string} text @param {any} recipe
 */
function json(text, recipe) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The ${String(recipe.name)} CLI answered something other than JSON.`);
  }
}

/**
 * Every page as one list, as `--paginate` prints it. Nothing printed is an empty list. Anything but a
 * list is refused: one page in its place would cut the list short without a word.
 * @param {string} text @param {any} recipe
 * @returns {unknown[]}
 */
function allPages(text, recipe) {
  const start = text.search(/[[{]/);
  if (start === -1 && text.trim() === '') return [];
  const value = json(start === -1 ? text : text.slice(start), recipe);
  if (!Array.isArray(value)) throw new Error(`The ${String(recipe.name)} CLI answered its pages in another shape.`);
  return value;
}

/** An answer's JSON, from its first bracket. A bare list is filed under the step's item name. @param {string} text @param {string | undefined} items @param {any} recipe */
function parse(text, items, recipe) {
  const start = text.search(/[[{]/);
  const value = json(start === -1 ? text : text.slice(start), recipe);
  return Array.isArray(value) && items ? { [items]: value } : value;
}

/**
 * Starts the CLI's own sign-in, which opens the person's browser at the provider, and answers the
 * address and code it printed. The plugin never sees what the CLI keeps.
 * @param {Cli} cli
 */
export async function signIn(cli) {
  const log = join(cli.folder, 'cli-login.log');
  const started = readJson(join(cli.folder, 'cli-login.json'));
  if (!alive(started?.pid)) {
    const out = openSync(log, 'w', 0o600);
    /** @type {Record<string, string>} */
    const env = { ...cli.recipe.env.set };
    for (const [name, value] of Object.entries(process.env)) {
      const upper = name.toUpperCase();
      if (
        value !== undefined &&
        !upper.startsWith('CI') &&
        !cli.recipe.env.clear.some((/** @type {string} */ prefix) => upper.startsWith(prefix))
      )
        env[name] ??= value;
    }
    const child = spawn(cli.program.file, [...cli.program.prefix, ...cli.recipe.signIn.args], {
      cwd: cli.folder,
      env,
      detached: true,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', out, out],
    });
    closeSync(out);
    child.unref();
    writeJson(join(cli.folder, 'cli-login.json'), { pid: child.pid, startedAt: new Date().toISOString() });
  }
  for (let waited = 0; waited < 20_000; waited += 250) {
    const found = approvalIn(log, cli.recipe.signIn.host);
    if (found.url) return found;
    await new Promise((done) => setTimeout(done, 250));
  }
  return approvalIn(log, cli.recipe.signIn.host);
}

/** Waits up to 90 seconds for the sign-in: the accounts it sees once it's done, null if it ended without. @param {Cli} cli */
export async function signedIn(cli) {
  for (let waited = 0; waited <= 90_000; waited += 3000) {
    try {
      const seen = await accounts(cli);
      rmQuietly(join(cli.folder, 'cli-login.json'));
      rmQuietly(join(cli.folder, 'cli-login.log'));
      return seen;
    } catch (error) {
      if (!(error instanceof Failure)) throw error;
    }
    if (!alive(readJson(join(cli.folder, 'cli-login.json'))?.pid)) return null;
    await new Promise((done) => setTimeout(done, 3000));
  }
  return undefined;
}

/** Whether a process is still running. */
const alive = (/** @type {unknown} */ pid) => {
  try {
    return typeof pid === 'number' && process.kill(pid, 0);
  } catch {
    return false;
  }
};

/** The approval address the sign-in printed, on the provider's own host, and its code. @param {string} log @param {string} host */
function approvalIn(log, host) {
  let printed = '';
  try {
    printed = readFileSync(log, 'utf8');
  } catch {
    // Nothing printed yet.
  }
  for (const candidate of printed.match(/https:\/\/[^\s"'<>]+/g) ?? []) {
    try {
      const url = new URL(candidate);
      if (url.hostname !== host && !url.hostname.endsWith(`.${host}`)) continue;
      const code = url.searchParams.get('user_code') ?? /enter\s+([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(printed)?.[1] ?? null;
      return { url: url.toString(), code: code && /^[A-Za-z0-9-]{4,20}$/.test(code) ? code : null };
    } catch {
      // Not an address.
    }
  }
  return { url: null, code: null };
}
