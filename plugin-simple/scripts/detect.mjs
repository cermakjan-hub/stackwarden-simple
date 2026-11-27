// @ts-check
// Recognizes the services a repo uses from what `scan.mjs` found, by the catalog in `catalog.json`:
// a package, an env var name, a config file, a Docker image, a host, a linked project ID or the Git
// remote. Each finding keeps its evidence (file, line, and the name that matched) and the env var
// names it uses, never a value. Text shaped like a key is left out.

import { CATALOG, scanRepo } from './scan.mjs';
import { looksSecret } from './stackwarden.mjs';

export const SCANNER_VERSION = 'simple-0.5.1';
const MAX_EVIDENCE = 50;
const MAX_USES = 50;
const pypi = (/** @type {string} */ name) => name.toLowerCase().replace(/[-_.]+/g, '-');

/** @typedef {{ signal: string, path: string, line: number | null, detail: string }} Evidence */
/** @typedef {{ name: string, path: string, line: number }} Reference */
/**
 * @typedef {{ service: string, name: string, kind: string, strength: 'strong' | 'medium', source: 'scanner',
 *   evidence: Evidence[], envVars: { name: string, usedIn: { path: string, line: number }[] }[] }} Finding
 */

/** Whether a piece of evidence may be sent: a plain relative path and plain words. @param {Evidence} item */
const safe = (item) =>
  item.path.length <= 200 &&
  item.detail.length > 0 &&
  item.detail.length <= 200 &&
  !/^(?:\/|[A-Za-z]:)/.test(item.path) &&
  !item.path.split('/').includes('..') &&
  (item.line === null || (Number.isInteger(item.line) && item.line >= 1 && item.line <= 10_000_000)) &&
  !looksSecret(item.path) &&
  !looksSecret(item.detail);

/** @param {any} rule @param {{ signal: string, path: string, detail: string, ecosystem?: string }} found */
function matches(rule, found) {
  switch (found.signal) {
    case 'package':
      return (
        (rule.packages?.[found.ecosystem ?? ''] ?? []).some(
          (/** @type {string} */ name) => (found.ecosystem === 'pypi' ? pypi(name) : name) === found.detail,
        ) ||
        (found.ecosystem === 'npm' &&
          (rule.packagePrefixes ?? []).some((/** @type {string} */ prefix) => found.detail.startsWith(prefix)))
      );
    case 'config_file':
      return (rule.configFiles ?? []).some(
        (/** @type {string} */ file) => found.path === file || found.path.endsWith(`/${file}`),
      );
    case 'image':
      return (rule.images ?? []).includes(found.detail);
    case 'host_reference':
      return (rule.hosts ?? []).includes(found.detail);
    default:
      return false;
  }
}

/** @param {any} rule @param {string} name */
const owns = (rule, name) =>
  (rule.envNames ?? []).includes(name) ||
  (rule.envPrefixes ?? []).some((/** @type {string} */ prefix) => name.startsWith(prefix));

/** Each env var name with where it's used, sorted, at most 50 places each. @param {Reference[]} references */
function usages(references) {
  /** @type {Map<string, Map<string, { path: string, line: number }>>} */
  const byName = new Map();
  for (const reference of references) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(reference.name)) continue;
    const places = byName.get(reference.name) ?? new Map();
    places.set(`${reference.path}:${String(reference.line)}`, { path: reference.path, line: reference.line });
    byName.set(reference.name, places);
  }
  return [...byName]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, places]) => ({
      name,
      usedIn: [...places.values()].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line).slice(0, MAX_USES),
    }));
}

/**
 * Scans the repo at `root` and recognizes its services: what `send` files in Stackwarden.
 * @param {string} root
 */
export function detect(root) {
  const scanned = scanRepo(root);
  const references = scanned.references.filter(
    (reference) => !looksSecret(reference.path) && !looksSecret(reference.name),
  );
  const remote = scanned.remote && !looksSecret(scanned.remote) ? scanned.remote : null;
  /** @type {Finding[]} */
  const findings = [];
  for (const rule of CATALOG) {
    /** @type {Evidence[]} */
    const candidates = scanned.signals
      .filter((found) => matches(rule, found))
      .map(({ signal, path, line, detail }) => ({ signal, path, line, detail }));
    const names = [...new Set(references.map((reference) => reference.name))].filter((name) => owns(rule, name));
    for (const name of names) {
      const first = references.find((reference) => reference.name === name);
      if (first) candidates.push({ signal: 'env_var', path: first.path, line: first.line, detail: name });
    }
    for (const hit of scanned.linked) {
      if (hit.rule.id === rule.id)
        candidates.push({
          signal: 'linked_id',
          path: hit.path,
          line: hit.line,
          detail: `${String(rule.name)} ${hit.kind} ${hit.id}`,
        });
    }
    if (rule.id === 'github' && remote?.startsWith('github.com/'))
      candidates.push({ signal: 'git_remote', path: '.git/config', line: null, detail: remote });
    const seen = new Set();
    const evidence = candidates
      .filter(safe)
      .sort(
        (a, b) =>
          a.signal.localeCompare(b.signal) ||
          a.path.localeCompare(b.path) ||
          (a.line ?? 0) - (b.line ?? 0) ||
          a.detail.localeCompare(b.detail),
      )
      .filter((item) => {
        const key = `${item.signal}|${item.path}|${String(item.line)}|${item.detail}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_EVIDENCE);
    if (evidence.length === 0) continue;
    const signals = new Set(evidence.map((item) => item.signal));
    const strong =
      signals.has('config_file') ||
      signals.has('linked_id') ||
      signals.has('git_remote') ||
      (signals.has('package') && signals.has('env_var'));
    findings.push({
      service: rule.id,
      name: rule.name,
      kind: rule.kind,
      strength: strong ? 'strong' : 'medium',
      source: 'scanner',
      evidence,
      envVars: usages(references.filter((reference) => names.includes(reference.name))).slice(0, 100),
    });
  }
  const vercel = scanned.linked.filter((hit) => hit.rule.id === 'vercel').sort((a, b) => a.path.localeCompare(b.path));
  const project = vercel.find((hit) => hit.kind === 'project' && !looksSecret(hit.id));
  const org = project
    ? vercel.find((hit) => hit.kind === 'org' && hit.path === project.path && !looksSecret(hit.id))
    : undefined;
  return {
    scannerVersion: SCANNER_VERSION,
    repo: {
      name: (remote?.split('/').at(-1) ?? scanned.folder) || 'repo',
      remote,
      // Stackwarden uses no branch; the commit tells a scan it filed before.
      branch: null,
      commit: scanned.commit,
    },
    linkedIds: project ? { vercelProjectId: project.id, ...(org ? { vercelOrgId: org.id } : {}) } : {},
    findings: findings.slice(0, 200),
  };
}
