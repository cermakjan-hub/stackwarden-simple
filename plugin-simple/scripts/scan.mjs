// @ts-check
// Reads the repo on this computer for what it names: its packages (package.json, requirements.txt,
// pyproject.toml, Pipfile), the env var names its code and `.env.example` use, its Docker images,
// the hosts its code calls, its config files, linked project IDs, and its Git remote and commit.
// It never opens a `.env` file, a key, a certificate or a credentials file, and never keeps a value:
// only names, paths and line numbers. It changes nothing and sends nothing.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CATALOG = /** @type {any[]} */ (JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8')));
const MAX_FILES = 20_000;
const MAX_BYTES = 1_000_000;
const SKIP = new Set([
  'fixtures',
  '__fixtures__',
  '__mocks__',
  'testdata',
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.output',
  '.terraform',
  '.cache',
  '.idea',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target',
  'tmp',
]);
const SKIP_UNDER = new Set(['.vercel/output', '.claude/worktrees']);
const PRIVATE_FOLDERS = new Set(['secrets', '.ssh', '.aws', '.gnupg']);
const PRIVATE_NAMES = new Set(['.npmrc', '.pypirc', '.netrc', '.git-credentials', 'credentials.json']);
const TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template']);
const SOURCE = /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|svelte|astro|py)$/;
const NAME = '[A-Za-z_][A-Za-z0-9_]*';
const ENV_REFERENCES = [
  `process\\.env\\.(${NAME})`,
  `process\\.env\\[\\s*['"\`](${NAME})['"\`]\\s*\\]`,
  `import\\.meta\\.env\\.(${NAME})`,
  `os\\.environ\\[\\s*['"](${NAME})['"]\\s*\\]`,
  `os\\.environ\\.get\\(\\s*['"](${NAME})['"]`,
  `os\\.getenv\\(\\s*['"](${NAME})['"]`,
  `Deno\\.env\\.get\\(\\s*['"](${NAME})['"]`,
].map((pattern) => new RegExp(pattern, 'g'));

/** Whether a path is one the scan never lists or opens: env files, keys, credentials, private folders. @param {string} path */
export function isPrivate(path) {
  const parts = path
    .split(/[\\/]/)
    .map((part) => part.split(':')[0]?.replace(/[. ]+$/, '') ?? '')
    .filter(Boolean);
  if (parts.some((part) => PRIVATE_FOLDERS.has(part.toLowerCase()))) return true;
  const name = (parts.at(-1) ?? '').toLowerCase();
  if ((name.startsWith('.env') || name.endsWith('.env') || name === '.flaskenv') && !TEMPLATES.has(name)) return true;
  if (/^id_(?:rsa|ed25519|ecdsa|dsa)/.test(name) || PRIVATE_NAMES.has(name)) return true;
  if (/^client_secret.*\.json$/.test(name) || /(?:service[-_]?account|adminsdk).*\.json$/.test(name)) return true;
  return /\.(?:pem|key|p12|pfx|keystore|jks)$/.test(name);
}

/** The repo's files, relative and sorted, and how many private ones were left alone. @param {string} root */
export function walk(root) {
  /** @type {string[]} */
  const files = [];
  let skipped = 0;
  const pending = [''];
  while (pending.length > 0 && files.length < MAX_FILES) {
    const folder = /** @type {string} */ (pending.pop());
    let entries;
    try {
      entries = readdirSync(join(root, folder), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      continue;
    }
    // A worktree or submodule inside the repo is a repo of its own.
    if (folder !== '' && entries.some((entry) => entry.name === '.git' && entry.isFile())) continue;
    const parent = folder.split('/').at(-1) ?? '';
    for (const entry of entries) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (PRIVATE_FOLDERS.has(entry.name.toLowerCase())) skipped += 1;
        else if (
          !SKIP.has(entry.name) &&
          !SKIP_UNDER.has(`${parent}/${entry.name}`) &&
          !/^CLAUDE-SECURITY-\d{8}-\d{6}$/.test(entry.name)
        )
          pending.push(path);
      } else if (entry.isFile()) {
        if (isPrivate(path)) skipped += 1;
        else if (files.length < MAX_FILES) files.push(path);
      }
    }
  }
  return { files: files.sort(), skipped };
}

/** @param {string} path @param {string} file */
export const isFileAt = (path, file) => path === file || path.endsWith(`/${file}`);
const baseName = (/** @type {string} */ path) => path.split('/').at(-1) ?? path;
const pypi = (/** @type {string} */ name) => name.toLowerCase().replace(/[-_.]+/g, '-');
const lineOf = (/** @type {string} */ text, /** @type {string} */ needle) => {
  const at = text.indexOf(needle);
  return at === -1 ? null : text.slice(0, at).split('\n').length;
};
const isDockerfile = (/** @type {string} */ name) =>
  name === 'Dockerfile' || name.startsWith('Dockerfile.') || name.endsWith('.Dockerfile');
const isCompose = (/** @type {string} */ name) => /^(?:docker-)?compose\.ya?ml$/.test(name);
const LINKED_FILES = CATALOG.flatMap((rule) =>
  (rule.linkedIds ?? []).map((/** @type {any} */ source) => String(source.file)),
);
const HOSTS = [...new Set(CATALOG.flatMap((rule) => rule.hosts ?? []))];
const CONFIG_FILES = CATALOG.flatMap((rule) => rule.configFiles ?? []);

/** The packages a manifest names, with their lines. @param {string} name @param {string} text */
function packagesIn(name, text) {
  /** @type {{ ecosystem: string, name: string, line: number | null }[]} */
  const found = [];
  const lines = text.split(/\r?\n/);
  if (name === 'package.json') {
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return found;
    }
    if (typeof json !== 'object' || json === null) return found;
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const each of Object.keys(json[section] ?? {}))
        found.push({ ecosystem: 'npm', name: each, line: lineOf(text, `"${each}"`) });
    }
  } else if (name === 'requirements.txt') {
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const match = /^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)/.exec(trimmed);
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-') && match?.[1])
        found.push({ ecosystem: 'pypi', name: pypi(match[1]), line: index + 1 });
    });
  } else {
    let section = '';
    let inArray = false;
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const header = /^\[([^\]]+)\]$/.exec(trimmed)?.[1];
      if (header !== undefined) {
        section = header;
        inArray = false;
        return;
      }
      const add = (/** @type {string} */ each) => found.push({ ecosystem: 'pypi', name: pypi(each), line: index + 1 });
      if (name === 'Pipfile') {
        const key = /^["']?([A-Za-z0-9][A-Za-z0-9_.-]*)["']?\s*=/.exec(trimmed)?.[1];
        if ((section === 'packages' || section === 'dev-packages') && key) add(key);
        return;
      }
      if (/^tool\.poetry\.(?:dev-dependencies|dependencies|group\.[^.]+\.dependencies)$/.test(section)) {
        const key = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*=/.exec(trimmed)?.[1];
        if (key && key !== 'python') add(key);
        return;
      }
      const start = /^([A-Za-z0-9_-]+)\s*=\s*\[(.*)$/.exec(trimmed);
      const listed =
        section === 'project.optional-dependencies' ||
        section === 'dependency-groups' ||
        (section === 'project' && start?.[1] === 'dependencies');
      if (start && listed) inArray = true;
      if (!inArray) return;
      const part = start ? (start[2] ?? '') : trimmed;
      for (const match of part.matchAll(/["']([A-Za-z][A-Za-z0-9_.-]*)/g)) if (match[1]) add(match[1]);
      if ((start ? part : trimmed).includes(']') || (!start && trimmed.startsWith(']'))) inArray = false;
    });
  }
  return found;
}

/** A Docker image as the catalog names it: no registry, tag, digest or `library/`. @param {string} reference */
export function normalizeImage(reference) {
  const parts = (reference.split('@')[0] ?? '').split('/');
  if (parts.length > 1 && /[.:]|^localhost$/.test(parts[0] ?? '')) parts.shift();
  const last = (parts.pop() ?? '').split(':')[0];
  return [...parts, last]
    .join('/')
    .replace(/^library\//, '')
    .toLowerCase();
}

/** A Git remote as `host/owner/repo`, lowercased, without credentials, or null. @param {string} url */
export function normalizeRepoUrl(url) {
  let host;
  let path;
  const scp = /^(?:[\w.-]+@)?([\w.-]+\.[a-z]{2,}):(?!\/\/)(.+)$/i.exec(url);
  if (scp) [, host, path] = scp;
  else {
    try {
      const parsed = new URL(/^[\w.-]+\.[a-z]{2,}\//i.test(url) ? `https://${url}` : url);
      if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)) return null;
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  const segments = String(path)
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  if (!host || segments.length < 2 || segments.includes('..')) return null;
  return `${host}/${segments.join('/')}`.toLowerCase();
}

/** The repo's Git origin and commit, read from `.git` without running git. @param {string} root */
export function gitOf(root) {
  const read = (/** @type {string} */ path) => {
    try {
      return statSync(path).size <= MAX_BYTES ? readFileSync(path, 'utf8') : null;
    } catch {
      return null;
    }
  };
  let own = join(root, '.git');
  const pointer = read(own);
  if (pointer !== null) {
    const gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(pointer)?.[1];
    if (!gitdir) return { remote: null, commit: null };
    own = resolve(root, gitdir);
  }
  const commondir = read(join(own, 'commondir'))?.trim();
  const common = commondir ? resolve(own, commondir) : own;
  const config = read(join(common, 'config'));
  if (config === null) return { remote: null, commit: null };
  const origin = config.split('[remote "origin"]')[1]?.split(/^\[/m)[0] ?? '';
  const url = /^\s*url\s*=\s*(.+?)\s*$/m.exec(origin)?.[1];
  const head = read(join(own, 'HEAD'))?.trim() ?? '';
  const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
  const ref = /^ref:\s*(refs\/heads\/.+)$/.exec(head)?.[1];
  let commit = sha.test(head) ? head : null;
  if (ref) {
    const loose = read(join(common, ref))?.trim();
    commit = loose && sha.test(loose) ? loose : null;
    if (!commit) {
      for (const line of (read(join(common, 'packed-refs')) ?? '').split('\n')) {
        const [hash, name] = line.trim().split(' ');
        if (name === ref && hash && sha.test(hash)) commit = hash;
      }
    }
  }
  return { remote: url ? normalizeRepoUrl(url) : null, commit };
}

/**
 * Everything the repo names, as signals for `detect.mjs`.
 * @param {string} root
 */
export function scanRepo(root) {
  const { files, skipped } = walk(root);
  /** @type {{ signal: string, path: string, line: number | null, detail: string, ecosystem?: string }[]} */
  const signals = [];
  /** @type {{ name: string, path: string, line: number }[]} */
  const references = [];
  /** @type {{ rule: any, kind: string, id: string, path: string, line: number | null }[]} */
  const linked = [];
  for (const path of files) {
    const name = baseName(path);
    if (CONFIG_FILES.some((file) => isFileAt(path, file)))
      signals.push({ signal: 'config_file', path, line: null, detail: path });
    const manifest = ['package.json', 'requirements.txt', 'pyproject.toml', 'Pipfile'].includes(name);
    const template = TEMPLATES.has(name.toLowerCase());
    const source = SOURCE.test(name) && !name.endsWith('.min.js');
    const linkedFile = LINKED_FILES.some((file) => isFileAt(path, file));
    if (!manifest && !template && !source && !linkedFile && !isDockerfile(name) && !isCompose(name)) continue;
    let text;
    try {
      if (statSync(join(root, path)).size > MAX_BYTES) continue;
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      continue;
    }
    if (manifest) {
      for (const found of packagesIn(name, text))
        signals.push({ signal: 'package', path, line: found.line, detail: found.name, ecosystem: found.ecosystem });
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (template) {
        const match = new RegExp(`^\\s*(?:export\\s+)?(${NAME})\\s*=`).exec(line);
        if (match?.[1]) references.push({ name: match[1], path, line: index + 1 });
      }
      if (source) {
        const seen = new Set();
        for (const pattern of ENV_REFERENCES) {
          for (const match of line.matchAll(pattern)) {
            if (match[1] && !seen.has(match[1])) {
              seen.add(match[1]);
              references.push({ name: match[1], path, line: index + 1 });
            }
          }
        }
        for (const host of HOSTS)
          if (line.includes(host)) signals.push({ signal: 'host_reference', path, line: index + 1, detail: host });
      }
      const image = isDockerfile(name)
        ? /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i.exec(line)?.[1]
        : isCompose(name)
          ? /^\s*image:\s*["']?([^"'\s#]+)/.exec(line)?.[1]
          : undefined;
      if (image && !image.includes('$') && image !== 'scratch')
        signals.push({ signal: 'image', path, line: index + 1, detail: normalizeImage(image) });
    });
    if (linkedFile) {
      /** @type {unknown} */
      let json;
      for (const rule of CATALOG) {
        for (const source of rule.linkedIds ?? []) {
          if (!isFileAt(path, source.file)) continue;
          let id;
          let line;
          if (source.field) {
            try {
              json ??= JSON.parse(text);
            } catch {
              continue;
            }
            const value =
              typeof json === 'object' && json !== null && Object.hasOwn(json, source.field)
                ? /** @type {any} */ (json)[source.field]
                : undefined;
            if (typeof value !== 'string') continue;
            id = value;
            line = lineOf(text, `"${String(source.field)}"`);
          } else {
            id = text.trim();
            line = lineOf(text, id);
          }
          if (new RegExp(source.pattern).test(id)) linked.push({ rule, kind: source.kind, id, path, line });
        }
      }
    }
  }
  const git = gitOf(root);
  return {
    files: files.length,
    skipped,
    signals,
    references,
    linked,
    remote: git.remote,
    commit: git.commit,
    folder: baseName(resolve(root).replaceAll('\\', '/')),
  };
}

export { CATALOG };
