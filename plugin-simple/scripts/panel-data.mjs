// @ts-check
// What the panel shows, worked out from what this computer keeps (`local.mjs`): the status with its
// one action, the Vercel team with each project's keys, and which of the team's tokens look like a
// repo's own. It reads nothing else and sends nothing.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { gitOf } from './scan.mjs';

/** The repo a folder is in: the nearest folder up holding `.git`, and its origin. @param {string} folder */
export function repoAt(folder) {
  const start = resolve(folder);
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return { root: dir, remote: gitOf(dir).remote };
    if (dirname(dir) === dir) return { root: start, remote: null };
  }
}

/** The key a repo is kept under: its remote, so its clones and worktrees share one. @param {{ root: string, remote: string | null }} place */
export const repoKey = (place) => place.remote ?? place.root;

/** The repo filed from here, by key or by remote. @param {Record<string, any>} file @param {{ root: string, remote: string | null }} place */
export function filedRepo(file, place) {
  return (
    file.repos[repoKey(place)] ??
    (place.remote ? (Object.values(file.repos).find((repo) => repo?.remote === place.remote) ?? null) : null)
  );
}

/**
 * The panel's status and its one action, in the order a person meets them. `waiting`: a reading
 * is kept here for the person's first yes.
 * @param {{ connected: boolean, hasCli: boolean, last: any, summary: any, waiting?: boolean }} input
 */
export function panelStatus({ connected, hasCli, last, summary, waiting = false }) {
  const readAt = summary?.readAt ?? null;
  if (!connected)
    return { state: 'not_connected', action: 'connect', text: "This computer isn't connected to Stackwarden", readAt };
  if (!hasCli) return { state: 'no_cli', action: 'set_up', text: 'No Vercel CLI on this computer', readAt };
  if (last?.signedOut) return { state: 'signed_out', action: 'sign_in', text: 'Your Vercel CLI is signed out', readAt };
  if (last && last.outcome !== 'sent')
    return {
      state: 'failed',
      action: 'refresh',
      text: `The last reading didn't arrive: ${String(last.message)}`,
      readAt,
    };
  if (summary) return { state: 'connected', action: 'refresh', text: 'Vercel connected', readAt };
  return waiting
    ? {
        state: 'waiting',
        action: 'refresh',
        text: 'Vercel read here: it goes to Stackwarden on your yes in the chat',
        readAt,
      }
    : { state: 'not_read', action: 'refresh', text: 'Vercel not read yet', readAt };
}

/**
 * The team, each project with its Stackwarden project and keys, and the tokens no project uses. The
 * repo's own projects come first.
 * @param {any} summary @param {any} answer @param {any} repo @param {string | null} remote
 */
export function teamView(summary, answer, repo, remote) {
  const known = new Map(
    (answer?.account === summary.account.id ? answer.resources : []).map((/** @type {any} */ resource) => [
      resource.externalId,
      resource,
    ]),
  );
  const filed = new Set(repo?.vercel ?? []);
  const projects = summary.projects.map((/** @type {any} */ project) => {
    const resource = known.get(project.id);
    const stackwarden = resource?.project ?? null;
    const thisRepo =
      filed.has(project.id) ||
      (repo !== null && stackwarden !== null && stackwarden.url === repo.project.url) ||
      (remote !== null && project.repo === remote);
    return { ...project, stackwarden, keys: resource?.keys ?? [], thisRepo };
  });
  projects.sort(
    (/** @type {any} */ a, /** @type {any} */ b) =>
      Number(b.thisRepo) - Number(a.thisRepo) || a.name.localeCompare(b.name),
  );
  const assigned = new Set(projects.flatMap((/** @type {any} */ project) => project.keys));
  return {
    account: { id: summary.account.id, name: summary.account.name },
    readAt: summary.readAt,
    plan: summary.plan,
    cost: summary.cost,
    tokens: summary.tokens,
    unassigned: (summary.tokens ?? []).filter((/** @type {any} */ token) => !assigned.has(token.id)),
    projects,
  };
}

/** A name to compare on: letters and digits, without a trailing -prod, -web, -api and the like. @param {string} name */
const nameKey = (name) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-(?:prod|production|staging|dev|app|web|api|frontend|backend|site|www)$/, '')
    .replace(/-/g, '');

/** The tokens whose name holds one of these names, three letters or more. @param {any[]} tokens @param {string[]} names */
export function suggestedTokens(tokens, names) {
  const keys = [...new Set(names.map(nameKey))].filter((key) => key.length >= 3);
  return tokens.filter((token) => keys.some((key) => nameKey(token.name).includes(key)));
}
