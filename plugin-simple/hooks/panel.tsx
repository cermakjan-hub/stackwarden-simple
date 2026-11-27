import type { EngineInterface, Register, RenderChildren } from 'claude-code';

// The Stackwarden panel beside the chat (ADR 0076 to 0078, 0081): the dashboard, as the panel draws
// it. It opens on the repo's project, with its service cards; "Dashboard" leads to Home, with the
// projects, services and tasks; a card opens its service's detail, with every project that uses it.
// Stackwarden works the view out with the dashboard's own code; the panel only draws what
// `sw.mjs panel` keeps on this computer, and acts only through `sw.mjs`.
//
// One design for every surface, with what each has (Box, Text, Button, Link); Svg only where a
// surface draws it. Colours are theme keys or hex.

const PANE = 'stackwarden';
const COMMAND = 'stackwarden';
const VIEW_EVERY_MS = 10 * 60_000;
// The reading the session-start hook runs in the background lands within a minute or so. Until then
// the panel looks every few seconds at when its own two state files last changed, and draws again
// once they do: a look at a file's time, no program run.
const WATCH_EVERY_MS = 3_000;
const WATCH_FOR_MS = 3 * 60_000;
const STATE_FILES = ['reader-state.json', 'panel-summary.json'];
const FIELDS_KEY = 'fields-v3';
/** Kept once the person says "Not now" to auto-update, so Home stops offering it. */
const AUTO_UPDATE_DECLINED = 'auto-update-declined';
const LONG_MS = 10 * 60_000;
const SHORT_MS = 30_000;
const DAY_MS = 24 * 60 * 60_000;
/** The oldest Node.js the plugin's scripts are written for, as the README says. */
const NODE_MIN = 22;
const NODE_DOWNLOAD = 'https://nodejs.org/en/download';
/** The task kind for services waiting for an OK: the panel shows those in their project, not on Home. */
const APPROVALS = 'suggestions-waiting';

// What `sw.mjs panel` prints: see scripts/panel-data.mjs and core's ReaderView.
/** The spacing steps the panel uses, and what each is in VS Code, in lines down and characters across. */
type Step = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
const VSCODE_SPACE: Record<Step, number> = { xs: 0.35, sm: 0.5, md: 0.75, lg: 1, xl: 1.5 };

type Tone = 'ok' | 'warn' | 'crit' | 'neutral';
type CardValue =
  | { type: 'text'; text: string; mono: boolean }
  | { type: 'status'; word: string; detail: string; tone: Tone }
  | { type: 'list'; items: string[]; more: number }
  | { type: 'metric'; total: string; days: (number | null)[] }
  | {
      type: 'keys';
      items: { id: string; name: string; expiry: string; tone: Tone }[];
      more: number;
      stale: string | null;
      unassigned: string | null;
      manage: { href: string; provider: string } | null;
    }
  | { type: 'none'; text: string };
type CardType = 'vercel' | 'service';
interface ViewCard {
  serviceId: string;
  provider: string;
  title: string;
  kind: string;
  subtitle: string | null;
  type: CardType;
  source: string;
  notSeenInLatestScan: boolean;
  rows: { id: string; label: string; value: CardValue }[];
  vercel: { account: string; project: string } | null;
}
type Color = 'blue' | 'orange' | 'aqua' | 'yellow' | 'magenta' | 'green' | 'violet' | 'red';
interface ViewProject {
  id: string;
  name: string;
  color: Color;
  status: string;
  clientName: string | null;
  repo: string | null;
  bucket: string | null;
  url: string;
  waiting: number;
  cards: ViewCard[];
}
interface ViewProvider {
  provider: string;
  title: string;
  summary: string;
  monthly: string;
  accounts: { name: string; owner: string; monthly: string; plan: string | null; reads: string }[];
  projects: { id: string; name: string; color: Color }[];
}
interface View {
  organization: { id: string; name: string };
  at: string;
  projects: ViewProject[];
  providers: ViewProvider[];
  tasks: {
    id: string;
    kind: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    summary: string;
    due: string | null;
    project: { id: string; name: string } | null;
    url: string;
  }[];
  suggestions: {
    id: string;
    name: string;
    provider: string;
    kind: string;
    project: { id: string | null; name: string } | null;
  }[];
  fields: Record<CardType, { id: string; label: string }[]>;
  defaults: Record<CardType, string[]>;
  links: { home: string; services: string };
  /** The newest plugin people can get (ADR 0079); absent or null from a Stackwarden that doesn't say. */
  plugin?: { latest: string } | null;
}
interface Token {
  id: string;
  name: string;
  expiresAt: string | null;
}
interface PanelData {
  status: { state: string; action: Action; text: string; readAt: string | null };
  organization: string | null;
  repo: { name: string; remote: string | null; filed: { project: { name: string; url: string } } | null };
  team: {
    account: { id: string };
    tokens: Token[] | null;
    /** Each Vercel project: whether it is this repo's, and the Stackwarden project it's in, if any. */
    projects: { id: string; name: string; keys: string[]; thisRepo: boolean; stackwarden: { name: string } | null }[];
  } | null;
  view: View | null;
  /** Whether new versions arrive by themselves; null where the plugin isn't from its marketplace. */
  plugin?: { autoUpdate: boolean | null };
}
interface Answer {
  say: string;
  next: string;
}

type Action = 'refresh' | 'sign_in' | 'connect' | 'set_up';
type Place =
  { kind: 'home' } | { kind: 'project'; id: string } | { kind: 'service'; provider: string; from: string | null };
type Picking = 'project' | 'detail';
/** Fields chosen for a project's cards and for a service's detail. */
interface Chosen {
  project: Record<CardType, string[]>;
  detail: Record<CardType, string[]>;
}

const ACTION_LABELS: Record<Action, string> = {
  refresh: 'Read again',
  sign_in: 'Sign in to Vercel',
  connect: 'Connect this computer',
  set_up: 'Set up the Vercel CLI',
};

/** What the panel asks `sw.mjs` to do besides the status's one action. */
type Errand = 'keys' | 'inbox' | 'autoupdate' | 'update' | 'link' | 'switch';

const BUSY: Record<Action | Errand, string> = {
  refresh: 'Reading Vercel through your Vercel CLI…',
  sign_in: 'Approve the Vercel CLI sign-in in your browser, at Vercel…',
  connect: 'Connect this computer to Stackwarden in your browser…',
  set_up: 'Checking the Vercel CLI…',
  link: 'Matching the repo to its Vercel project…',
  keys: 'Saving the keys…',
  inbox: 'Answering…',
  autoupdate: 'Turning on auto-update…',
  update: 'Updating Stackwarden. It takes up to a minute…',
  switch:
    'Stackwarden opened in your browser. Use another account there if you need to, then click Connect. Until then this computer stays where it is.',
};

// A service's detail compares its projects: cost, deploys and keys first, where a provider has them.
const DETAIL_DEFAULTS: Record<CardType, string[]> = {
  vercel: ['status', 'cost', 'deployments', 'keys'],
  service: ['price', 'keys', 'env'],
};

const PROJECT_COLORS: Record<Color, string> = {
  blue: '#3b82f6',
  orange: '#f97316',
  aqua: '#06b6d4',
  yellow: '#ca8a04',
  magenta: '#d946ef',
  green: '#16a34a',
  violet: '#8b5cf6',
  red: '#ef4444',
};

const TONES: Record<Tone, { mark: string; color: 'success' | 'warning' | 'error' | undefined }> = {
  ok: { mark: '✓', color: 'success' },
  warn: { mark: '◌', color: 'warning' },
  crit: { mark: '✕', color: 'error' },
  neutral: { mark: '·', color: undefined },
};

// How urgent a task is, as its box's colour and a word under its title.
type Severity = 'critical' | 'warning' | 'info';
const SEVERITY: Record<Severity, { color: 'error' | 'warning' | 'subtle'; word: string }> = {
  critical: { color: 'error', word: 'Urgent' },
  warning: { color: 'warning', word: 'Soon' },
  info: { color: 'subtle', word: 'When you can' },
};

// The module's own state: it starts over at a reload, and session.start reads it again.
let data: PanelData | null = null;
let busy: string | null = null;
let note: string | null = null;
let place: Place | null = null;
let history: Place[] = [];
let choosingFields: Picking | null = null;
let choosingKeys: { project: string; keys: Set<string> } | null = null;
let chosen: Chosen | null = null;
let serviceSearch = '';
/** This plugin's version, from its plugin.json, read at session start. */
let ownVersion: string | null = null;
let autoUpdateDeclined = false;
/** Why the scripts can't run, when the last read got no answer; null when they can. */
let nodeProblem: string | null = null;
/** When the state files had last changed as the panel last read them. */
let drawnAt = 0;
/** "Update now" installed a newer version, which runs once the person reloads or starts a session. */
let updated = false;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function asPanel(value: unknown): PanelData | null {
  if (!isObject(value) || !isObject(value.status) || !isObject(value.repo)) return null;
  const action = value.status.action;
  if (typeof action !== 'string' || !(action in ACTION_LABELS)) return null;
  return value as unknown as PanelData;
}

function asAnswer(value: unknown): Answer {
  return isObject(value) && typeof value.say === 'string' && typeof value.next === 'string'
    ? { say: value.say, next: value.next }
    : { say: 'Stackwarden did not answer.', next: 'stop' };
}

/** Runs the plugin's script with the plugin's own variables, in the session's folder, and reads its JSON. */
async function sw($: EngineInterface, args: string[], timeoutMs: number): Promise<unknown> {
  const env = await $.process.hookEnv();
  const cwd = await $.session.cwd();
  try {
    const result = await $.process.run(['node', `${$.plugin.root}/scripts/sw.mjs`, ...args], { env, cwd, timeoutMs });
    return JSON.parse(result.stdout) as unknown;
  } catch {
    // No Node.js to run it, or no answer it could read: the panel says which, from nodeCheck.
    return null;
  }
}

/**
 * Why the plugin's scripts can't run here, in the person's words, or null when Node.js is there at
 * the version they need. The Vercel CLI runs on it too.
 */
async function nodeCheck($: EngineInterface): Promise<string | null> {
  const install = `Install Node.js ${NODE_MIN} or newer, then restart Claude Code.`;
  try {
    const env = await $.process.hookEnv();
    const result = await $.process.run(['node', '--version'], { env, timeoutMs: SHORT_MS });
    const version = result.stdout.trim();
    const major = Number(/^v(\d+)\./.exec(version)?.[1] ?? Number.NaN);
    if (result.exitCode !== 0 || Number.isNaN(major))
      return `Stackwarden runs on Node.js, which this computer doesn't have. ${install}`;
    return major < NODE_MIN
      ? `Stackwarden needs Node.js ${NODE_MIN} or newer, and this computer has ${version}. ${install}`
      : null;
  } catch {
    return `Stackwarden runs on Node.js, which this computer doesn't have. ${install}`;
  }
}

/** The project of the repo the session is in, by its remote, or by the project its filing named. */
function repoProject(panel: PanelData): ViewProject | null {
  const projects = panel.view?.projects ?? [];
  const { remote, filed } = panel.repo;
  return (
    projects.find((project) => remote !== null && project.repo === remote) ??
    projects.find((project) => filed !== null && project.url === filed.project.url) ??
    null
  );
}

/** When the plugin's state files last changed, or 0 when there are none to look at. */
async function changedAt($: EngineInterface): Promise<number> {
  const folder = (await $.process.hookEnv()).CLAUDE_PLUGIN_DATA;
  if (!folder) return 0;
  const times = await Promise.all(
    STATE_FILES.map((name) =>
      $.fs.stat(`${folder}/${name}`).then(
        (file) => file.mtimeMs,
        () => 0,
      ),
    ),
  );
  return Math.max(0, ...times);
}

/** Draws again whenever the state files change, for `WATCH_FOR_MS`. */
function watchForReading($: EngineInterface): void {
  let ticks = Math.ceil(WATCH_FOR_MS / WATCH_EVERY_MS);
  const timer = $.clock.every(WATCH_EVERY_MS, () => {
    ticks -= 1;
    if (ticks <= 0) timer.cancel();
    void changedAt($).then((at) => (at > drawnAt ? reload($) : undefined));
  });
}

async function reload($: EngineInterface): Promise<void> {
  // What changes after this is new to the panel, and the watch draws it.
  drawnAt = await changedAt($);
  data = asPanel(await sw($, ['panel', await $.session.cwd()], SHORT_MS));
  // No answer: say whether Node.js is the reason, rather than read on for ever.
  nodeProblem = data ? null : await nodeCheck($);
  // The first view decides where the panel opens: the repo's project, else Home.
  if (data?.view && place === null) {
    const mine = repoProject(data);
    place = mine ? { kind: 'project', id: mine.id } : { kind: 'home' };
  }
  $.ui.status(data ? statusLine(data) : undefined);
  $.ui.invalidate('ui.render');
}

/** Reads the organization again, quietly, then draws what came. */
async function refreshView($: EngineInterface): Promise<void> {
  if (busy || data?.status.state === 'not_connected') return;
  await sw($, ['view'], SHORT_MS);
  await reload($);
}

/** Runs a command, then its `wait` while it says to wait, a few times at most. */
async function untilDone($: EngineInterface, command: string, waiting: string): Promise<Answer> {
  let answer = asAnswer(await sw($, [command], LONG_MS));
  for (let tries = 0; answer.next === waiting && tries < 6; tries += 1) {
    answer = asAnswer(await sw($, [command, 'wait'], LONG_MS));
  }
  return answer;
}

async function act($: EngineInterface, action: Action | Errand, args: string[] = []): Promise<void> {
  if (busy) return;
  busy = BUSY[action];
  note = null;
  $.ui.invalidate('ui.render');
  try {
    const answer =
      action === 'refresh'
        ? asAnswer(await sw($, ['read', await $.session.cwd()], LONG_MS))
        : action === 'keys' || action === 'inbox' || action === 'autoupdate' || action === 'update' || action === 'link'
          ? asAnswer(await sw($, [action, ...args], action === 'update' ? LONG_MS : SHORT_MS))
          : action === 'sign_in'
            ? await untilDone($, 'login', 'login_wait')
            : action === 'connect' || action === 'switch'
              ? await untilDone($, 'connect', 'connect_wait')
              : asAnswer(await sw($, ['install'], LONG_MS));
    note = answer.say;
    if (action === 'update' && answer.next === 'reload') updated = true;
    if (action === 'connect' || action === 'switch') await sw($, ['view'], SHORT_MS);
  } catch {
    note = 'That did not finish. Try again.';
  } finally {
    busy = null;
    await reload($);
  }
}

/**
 * Whether a shell command ran this plugin's script for a step that can change what the panel shows:
 * any but `panel` and `hook`, which only read. The step is the word after the data folder.
 */
function rereadAfter<T>($: EngineInterface, command: string, ran: T): T {
  const step = /scripts[\\/]sw\.mjs"?\s+--data\s+(?:"[^"]*"|\S+)\s+(\S+)/.exec(command)?.[1];
  if (step !== undefined && step !== 'panel' && step !== 'hook') void reload($);
  return ran;
}

function redraw($: EngineInterface, change: () => void): void {
  change();
  $.ui.invalidate('ui.render');
}

function go($: EngineInterface, next: Place): void {
  redraw($, () => {
    if (place) history = [...history, place].slice(-20);
    place = next;
    choosingFields = null;
    choosingKeys = null;
  });
}

function back($: EngineInterface): void {
  redraw($, () => {
    place = history.at(-1) ?? { kind: 'home' };
    history = history.slice(0, -1);
    choosingFields = null;
    choosingKeys = null;
  });
}

function chosenOf(view: View): Chosen {
  return (
    chosen ?? {
      // The dashboard's defaults, with a Vercel project's keys too: the panel is where they are chosen (ADR 0077).
      project: {
        vercel: view.defaults.vercel.includes('keys') ? view.defaults.vercel : [...view.defaults.vercel, 'keys'],
        service: view.defaults.service,
      },
      detail: DETAIL_DEFAULTS,
    }
  );
}

function fieldsFor(view: View, where: 'project' | 'detail', type: CardType): string[] {
  return chosenOf(view)[where][type];
}

/** Turns one field on or off, kept on this computer across sessions. */
async function toggleField($: EngineInterface, view: View, where: Picking, type: CardType, id: string) {
  const base = chosenOf(view);
  const list = base[where][type];
  const flipped = list.includes(id) ? list.filter((each) => each !== id) : [...list, id];
  chosen = { ...base, [where]: { ...base[where], [type]: flipped } };
  await $.store.set(FIELDS_KEY, chosen);
  $.ui.invalidate('ui.render');
}

// Words and numbers.

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function expiry(token: Token): string {
  if (!token.expiresAt) return 'never expires';
  const days = Math.ceil((Date.parse(token.expiresAt) - Date.now()) / DAY_MS);
  if (days < 0) return 'expired';
  return days === 0 ? 'expires today' : `expires in ${days} ${days === 1 ? 'day' : 'days'}`;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Whether version `a` is above `b`, number by number; false when either isn't plain numbers. */
function isNewer(a: string, b: string): boolean {
  const parts = (version: string) => (/^\d+\.\d+\.\d+$/.test(version) ? version.split('.').map(Number) : null);
  const [x, y] = [parts(a), parts(b)];
  if (!x || !y) return false;
  for (let index = 0; index < 3; index += 1) {
    if ((x[index] ?? 0) !== (y[index] ?? 0)) return (x[index] ?? 0) > (y[index] ?? 0);
  }
  return false;
}

/** This plugin's version, from its own plugin.json. */
async function readOwnVersion($: EngineInterface): Promise<string | null> {
  try {
    const manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as unknown;
    return isObject(manifest) && typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

/** Whether a service answers what the person typed: by its name, or a project or an account it is in. */
function matchesSearch(provider: ViewProvider, search: string): boolean {
  const typed = search.trim().toLowerCase();
  if (typed === '') return true;
  return [
    provider.title,
    provider.provider,
    ...provider.projects.map((project) => project.name),
    ...provider.accounts.map((account) => account.name),
  ].some((text) => text.toLowerCase().includes(typed));
}

function statusLine(panel: PanelData): string {
  const { status } = panel;
  return status.state === 'connected' && status.readAt
    ? `Stackwarden: Vercel ✓ · read ${ago(status.readAt)}`
    : `Stackwarden: ${status.text}`;
}

/**
 * The checkout a local build is loaded from, such as a worktree's name, or null for an installed copy,
 * which runs from the plugins' cache.
 */
function localBuild(root: string): string | null {
  if (/[\\/]plugins[\\/]cache[\\/]/i.test(root)) return null;
  return root.split(/[\\/]/).filter(Boolean).at(-2) ?? root;
}

// Vercel's mark in a dark square, so it reads on a light and a dark theme alike; any other provider
// has its first letter.
const VERCEL_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="#111"/><path d="M14 8l7 12H7z" fill="#fff"/></svg>';

function letterMark(title: string): string {
  const letter = (title.match(/[A-Za-z0-9]/)?.[0] ?? '?').toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="#3f3f46"/><text x="14" y="19" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
}

/** A metric's last days as a line, as the dashboard's sparkline draws them. */
function sparkline(days: readonly (number | null)[]): string | null {
  const values = days.map((day) => day ?? 0);
  const max = Math.max(...values, 0);
  if (values.length < 2 || max === 0) return null;
  const step = 120 / (values.length - 1);
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${(21 - (value / max) * 19).toFixed(1)}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="22" viewBox="0 0 120 22"><polyline points="${points.join(' ')}" fill="none" stroke="#8b8b94" stroke-width="1.5"/></svg>`;
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    // The person's choice of fields stays on this computer across sessions.
    const kept = await $.store.get(FIELDS_KEY);
    if (isObject(kept) && isObject(kept.project) && isObject(kept.detail)) {
      chosen = kept as unknown as Chosen;
    }
    autoUpdateDeclined = (await $.store.get(AUTO_UPDATE_DECLINED)) === true;
    ownVersion = await readOwnVersion($);
    await $.command.register({ name: COMMAND, description: 'Open the Stackwarden panel' });
    void $.ui.open({ id: PANE, title: 'Stackwarden' });
    void reload($).then(() => refreshView($));
    watchForReading($);
    $.clock.every(VIEW_EVERY_MS, () => {
      void refreshView($);
    });
    return next(e);
  });

  on('command.run', { command: COMMAND }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Stackwarden' });
    return { text: 'Stackwarden panel opened.' };
  }).catch(($, e, next) => (next.called ? next(e) : { text: 'The Stackwarden panel could not open.' }));

  // Each step the setup takes in the chat runs the plugin's script: once it has, the panel shows
  // what changed, rather than what it last read (round 1, finding 10).
  // The script keeps what Stackwarden answered, so reading this computer's files is enough. A failure
  // here never holds the command up.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => rereadAfter($, e.command, await next(e))).catch(
    ($, e, next) => next(e),
  );
  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => rereadAfter($, e.command, await next(e))).catch(
    ($, e, next) => next(e),
  );

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link, Input } = $.ui.resolve(e);
    const draws = e.surface === 'desktop' || e.surface === 'mobile';
    /**
     * VS Code's panel (extension 2.1.332) takes spacing only as a number of lines or characters, and
     * drops a step's name, so a box's text sat on its border there. It also fills every Button but a
     * dim one, whatever `plain` says. Those are the two places the panel draws VS Code its own way.
     */
    const vscode = e.surface === 'vscode';
    const space = (step: Step) => (vscode ? VSCODE_SPACE[step] : step);
    const quiet = vscode ? { dimColor: true as const } : {};
    // A field's label column, in cells, worked out from the pane's own width.
    const columns = typeof e.props.bodyColumns === 'number' && e.props.bodyColumns > 0 ? e.props.bodyColumns : 60;
    const labelWidth = Math.max(10, Math.round(columns * 0.3));
    const svg = (source: string, alt: string, width: number, height: number) => {
      if (e.surface !== 'desktop' && e.surface !== 'mobile') return null;
      const { Svg } = $.ui.resolve(e);
      return <Svg source={source} alt={alt} width={width} height={height} />;
    };
    const build = localBuild($.plugin.root);

    // Type, from the page's title down to a row's note.
    const title = (text: string) => (
      <Text size="title" weight="semibold">
        {text}
      </Text>
    );
    const section = (text: string) => (
      <Text size="heading" weight="semibold">
        {text}
      </Text>
    );
    const meta = (text: string) => (
      <Text size="footnote" dimColor>
        {text}
      </Text>
    );

    /**
     * A button as text, with no fill and no border, to keep the panel light. A desktop's border takes
     * a line above and below what it holds, so an outline doubled a button's height. The main action
     * of a place is the one filled button. One design for every surface (ADR 0081): each draws a plain
     * button its own way.
     */
    const textButton = (key: string, label: string, onPress: () => unknown, main = false) => (
      <Button
        key={key}
        label={label}
        // A press has 10 seconds; a step can take minutes. The step says what it does while it runs.
        onPress={() => {
          void onPress();
        }}
        {...(main ? { variant: 'primary' as const } : { plain: true as const, ...quiet })}
      />
    );

    /**
     * A name that opens what it names, as a web app's link: text ending in a ›, the only part of a
     * card or row that is pressed. A title is bright; a name it links to, on the line under it, is
     * quiet, dim until the pointer is on it. A project always has its colour's dot before its name
     * and a service never does, so the two never look alike. A desktop draws a Button's text at one
     * size and in its own colour, so the dot stands outside it.
     */
    const named = (
      key: string,
      onPress: () => void,
      name: string,
      options: { color?: Color; quiet?: boolean } = {},
    ) => {
      const button = (
        <Button key={key} plain onPress={onPress} {...(options.quiet ? { dimColor: true } : quiet)}>
          <Text weight={options.quiet ? 'regular' : 'semibold'}>{name}</Text>
          <Text dimColor> ›</Text>
        </Button>
      );
      return options.color ? (
        <Box key={`${key}-named`} flexDirection="row" alignItems="center" gap={space('xs')}>
          <Text color={PROJECT_COLORS[options.color]}>●</Text>
          {button}
        </Box>
      ) : (
        button
      );
    };

    /** A cost a month, or nothing where none is known: never "$0.00/mo" for a service no bill names. */
    const perMonth = (monthly: string, size?: 'heading') =>
      /^\$?0(?:\.0+)?$/.test(monthly.trim()) ? null : (
        <Text tabular {...(size ? { size } : {})}>{`${monthly}/mo`}</Text>
      );

    // Every view starts with which plugin runs, so the person sees it at a glance, as after an update:
    // a local build in the warning colour with its checkout, the marketplace's copy dim.
    const version = ownVersion ? ` · ${ownVersion}` : '';
    const frame = (body: RenderChildren) => (
      <Box flexDirection="column" gap={1} paddingX={1} paddingY={space('xs')}>
        {build ? (
          <Text size="caption" color="warning">
            Local build · {build}
            {version}
          </Text>
        ) : (
          <Text size="caption" dimColor>
            Stackwarden plugin{version}
          </Text>
        )}
        {body}
      </Box>
    );

    if (!data) {
      // Without Node.js the scripts never answer: say so, with where to get it, once the check is in.
      return frame(
        nodeProblem ? (
          <Box
            flexDirection="column"
            gap={space('xs')}
            borderStyle="round"
            borderColor="warning"
            paddingX={1}
            paddingY={space('xs')}
          >
            <Text color="warning" weight="semibold">
              Stackwarden needs Node.js {NODE_MIN} or newer
            </Text>
            {meta(nodeProblem)}
            <Link href={NODE_DOWNLOAD} label="Download Node.js ↗" />
          </Box>
        ) : (
          meta('Stackwarden: reading what this computer knows…')
        ),
      );
    }
    const panel = data;
    const view = panel.view;

    const status =
      panel.status.state === 'connected' ? null : (
        <Box
          flexDirection="column"
          gap={space('xs')}
          borderStyle="round"
          borderColor="warning"
          paddingX={1}
          paddingY={space('xs')}
        >
          <Text color="warning" weight="semibold">
            {panel.status.text}
          </Text>
          {build && panel.status.state === 'not_connected'
            ? meta('A local build keeps a connection of its own: approve it once, then Refresh.')
            : null}
          {busy ? null : (
            <Box flexDirection="row">
              {textButton('action', ACTION_LABELS[panel.status.action], () => act($, panel.status.action), true)}
            </Box>
          )}
        </Box>
      );

    const notes =
      busy || note ? (
        <Box flexDirection="column">
          {busy ? meta(busy) : null}
          {note ? meta(note) : null}
        </Box>
      ) : null;

    // The top bar of every view: Dashboard and Back on the left, when it was read and Refresh on the right.
    const navigation = (
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
        <Box flexDirection="row" gap={1}>
          {textButton('nav-home', '⌂ Dashboard', () => go($, { kind: 'home' }))}
          {history.length > 0 ? textButton('nav-back', '‹ Back', () => back($)) : null}
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center">
          {view ? meta(`${view.organization.name} · ${ago(view.at)}`) : null}
          {busy ? null : textButton('refresh', '↻ Refresh', () => act($, 'refresh'))}
        </Box>
      </Box>
    );

    // A newer plugin people can get, as Stackwarden names it (ADR 0079). Auto-update is null where the
    // plugin isn't its marketplace's copy, such as a local build, which updates through its checkout:
    // then there is neither a notice nor an offer.
    const autoUpdate = panel.plugin?.autoUpdate ?? null;
    const latest = view?.plugin?.latest ?? null;
    const newer =
      autoUpdate !== null && latest !== null && ownVersion !== null && isNewer(latest, ownVersion) ? latest : null;
    const turnOnAutoUpdate = () =>
      textButton('auto-update-on', 'Turn on auto-update', () => act($, 'autoupdate', ['on']));
    /**
     * A rounded box that is not pressed itself, such as a notice or an account: what it says on the
     * left, and what it offers on the right. No hover, so only what can be pressed answers the pointer.
     */
    const boxed = (key: string, border: 'suggestion' | 'subtle', left: RenderChildren, right: RenderChildren) => (
      <Box
        key={key}
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        gap={1}
        flexWrap="wrap"
        borderStyle="round"
        borderColor={border}
        borderDimColor={border === 'subtle'}
        paddingX={1}
        paddingY={space('xs')}
      >
        <Box flexDirection="column" flexShrink={1}>
          {left}
        </Box>
        {right ? (
          <Box flexDirection="row" gap={1} alignItems="center">
            {right}
          </Box>
        ) : null}
      </Box>
    );
    // Buttons wait while a step runs. The update says what it is doing in its own box, and once it is
    // installed, what makes it run: Claude Code loads a plugin when a session starts or reloads.
    const updateNotice = !newer
      ? null
      : updated
        ? boxed(
            'update',
            'suggestion',
            [
              <Text key="out" weight="semibold">
                Stackwarden {newer} is installed
              </Text>,
              meta('To use it, type /reload-plugins in the chat, or start a new session.'),
            ],
            null,
          )
        : boxed(
            'update',
            'suggestion',
            [
              <Text key="out" weight="semibold">
                Stackwarden {newer} is out
              </Text>,
              meta(
                busy === BUSY.update
                  ? BUSY.update
                  : `You have ${ownVersion ?? 'an older one'}.${autoUpdate === false ? ' With auto-update on, new versions arrive by themselves.' : ''}`,
              ),
            ],
            busy
              ? null
              : [
                  textButton('plugin-update', 'Update now', () => act($, 'update'), true),
                  autoUpdate === false ? turnOnAutoUpdate() : null,
                ],
          );
    // Home offers auto-update once, while new versions don't arrive by themselves; "Not now" is kept.
    const autoUpdateOffer =
      !newer && autoUpdate === false && !autoUpdateDeclined
        ? boxed(
            'auto-update',
            'subtle',
            meta('New versions of Stackwarden arrive by themselves only with auto-update on.'),
            busy
              ? null
              : [
                  turnOnAutoUpdate(),
                  textButton('auto-update-later', 'Not now', () =>
                    redraw($, () => {
                      autoUpdateDeclined = true;
                      void $.store.set(AUTO_UPDATE_DECLINED, true);
                    }),
                  ),
                ],
          )
        : null;

    // The top of every view: the navigation, then a newer version when there is one.
    const bar = (
      <Box flexDirection="column" gap={space('xl')}>
        {navigation}
        {updateNotice}
      </Box>
    );

    if (!view) {
      return frame(
        <Box flexDirection="column" gap={space('xl')}>
          {status}
          {notes}
          {panel.status.state === 'not_connected' ? null : meta('Loading Stackwarden…')}
        </Box>,
      );
    }

    /** One field: its label in the left column, its value beside it. */
    const field = (key: string, label: string, value: RenderChildren) => (
      <Box key={key} flexDirection="row" gap={1}>
        <Box width={labelWidth} flexShrink={0}>
          {meta(label)}
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {value}
        </Box>
      </Box>
    );

    /** A field's value as the dashboard draws each kind. */
    const valueOf = (value: CardValue, card: ViewCard): RenderChildren => {
      switch (value.type) {
        case 'text':
          return <Text mono={value.mono}>{value.text}</Text>;
        case 'none':
          return <Text dimColor>{value.text}</Text>;
        case 'status': {
          const tone = TONES[value.tone];
          return (
            <Text color={tone.color} weight="medium">
              {tone.mark} {value.word}
              {value.detail ? <Text dimColor> · {value.detail}</Text> : null}
            </Text>
          );
        }
        case 'list':
          return (
            <Text mono>
              {value.items.join(', ')}
              {value.more > 0 ? <Text dimColor> +{value.more} more</Text> : null}
            </Text>
          );
        case 'metric': {
          const line = draws ? sparkline(value.days) : null;
          return (
            <Box flexDirection="row" gap={1} alignItems="center">
              <Text tabular weight="medium">
                {value.total}
              </Text>
              {line ? svg(line, `${value.total} over the last days`, 120, 22) : null}
            </Box>
          );
        }
        case 'keys':
          return keysValue(value, card);
      }
    };

    const keysValue = (value: Extract<CardValue, { type: 'keys' }>, card: ViewCard): RenderChildren => {
      const tokens = panel.team?.tokens ?? [];
      const project = card.vercel?.project ?? null;
      const canChoose =
        project !== null && card.vercel?.account === panel.team?.account.id && tokens.length > 0 && !busy;
      if (project !== null && choosingKeys?.project === project) {
        const draft = choosingKeys.keys;
        return (
          <Box flexDirection="column" gap={space('xs')}>
            {tokens.map((token) => (
              <Button
                key={`token-${token.id}`}
                plain
                {...quiet}
                label={`${draft.has(token.id) ? '☑' : '☐'} ${token.name} · ${expiry(token)}`}
                onPress={() =>
                  redraw($, () => {
                    if (draft.has(token.id)) draft.delete(token.id);
                    else draft.add(token.id);
                  })
                }
              />
            ))}
            <Box flexDirection="row" gap={1}>
              {textButton(
                'save-keys',
                'Save',
                () => {
                  const keys = [...draft];
                  choosingKeys = null;
                  void act($, 'keys', [project, ...keys]);
                },
                true,
              )}
              {textButton('cancel-keys', 'Cancel', () => redraw($, () => (choosingKeys = null)))}
            </Box>
          </Box>
        );
      }
      return (
        <Box flexDirection="column" gap={space('xs')}>
          {value.items.length === 0 ? <Text dimColor>None listed</Text> : null}
          {value.items.map((key) => (
            <Text key={key.id}>
              🔒 {key.name} <Text color={TONES[key.tone].color}>· {key.expiry}</Text>
            </Text>
          ))}
          {value.more > 0 ? meta(`+${value.more} more`) : null}
          {value.stale ? <Text color="warning">{value.stale}</Text> : null}
          {value.unassigned ? meta(value.unassigned) : null}
          {canChoose ? (
            <Box flexDirection="row">
              {textButton(`choose-keys-${card.serviceId}`, 'Choose keys', () =>
                redraw($, () => {
                  const own = panel.team?.projects.find((each) => each.id === project)?.keys ?? [];
                  choosingKeys = { project, keys: new Set(own) };
                }),
              )}
            </Box>
          ) : null}
        </Box>
      );
    };

    const markOf = (provider: string, name: string) =>
      draws ? (
        svg(provider === 'vercel' ? VERCEL_MARK : letterMark(name), name, 28, 28)
      ) : (
        <Text bold>{provider === 'vercel' ? '▲' : '●'}</Text>
      );

    /**
     * A service card as the dashboard draws it: mark, kind, title, the chosen fields and the source.
     * A service's detail heads each card with its project instead, as the page names the service.
     */
    const serviceCard = (
      card: ViewCard,
      fields: readonly string[],
      opens: (() => void) | null,
      options: { marked?: boolean; head?: RenderChildren } = {},
    ) => {
      const shown = card.rows.filter((each) => fields.includes(each.id));
      return (
        <Box
          key={card.serviceId}
          flexDirection="column"
          gap={space('sm')}
          borderStyle="round"
          borderColor={options.marked ? 'claude' : 'subtle'}
          borderDimColor={!options.marked}
          paddingX={1}
          paddingY={space('xs')}
        >
          {/* The kind above, the service's name under it, which opens its detail; its own name under that. */}
          {options.head ?? (
            <Box flexDirection="row" gap={1} alignItems="center">
              {markOf(card.provider, card.title)}
              <Box flexDirection="column" alignItems="flex-start" gap={space('xs')} flexGrow={1} flexShrink={1}>
                {meta(card.kind)}
                {opens ? (
                  named(`open-${card.serviceId}`, opens, card.title)
                ) : (
                  <Text size="heading" weight="semibold">
                    {card.title}
                  </Text>
                )}
                {card.subtitle ? (
                  <Text size="footnote" mono dimColor>
                    {card.subtitle}
                  </Text>
                ) : null}
              </Box>
            </Box>
          )}
          {shown.length === 0
            ? meta('No fields chosen: pick some with Fields.')
            : shown.map((each) => field(`${card.serviceId}-${each.id}`, each.label, valueOf(each.value, card)))}
          {/* Where it came from, as the dashboard's badge, unless a field says it already. */}
          {shown.some((each) => each.id === 'source') && !card.notSeenInLatestScan ? null : (
            <Box flexDirection="row" gap={1}>
              {shown.some((each) => each.id === 'source') ? null : meta(card.source)}
              {card.notSeenInLatestScan ? (
                <Text size="footnote" color="warning">
                  Not seen in the latest scan
                </Text>
              ) : null}
            </Box>
          )}
        </Box>
      );
    };

    /** The field picker: one group of checkboxes for each list of fields it chooses. */
    const picker = (
      where: Picking,
      groups: readonly {
        name: string;
        type: CardType;
        fields: readonly { id: string; label: string }[];
        on: readonly string[];
      }[],
    ) =>
      choosingFields === where ? (
        <Box
          flexDirection="column"
          gap={space('xs')}
          borderStyle="round"
          borderColor="suggestion"
          paddingX={1}
          paddingY={space('xs')}
        >
          {groups.map((group) => (
            <Box key={group.name} flexDirection="column">
              <Text weight="semibold">{group.name}</Text>
              {group.fields.map((each) => (
                <Button
                  key={`field-${where}-${group.type}-${each.id}`}
                  plain
                  {...quiet}
                  label={`${group.on.includes(each.id) ? '☑' : '☐'} ${each.label}`}
                  onPress={() => toggleField($, view, where, group.type, each.id)}
                />
              ))}
            </Box>
          ))}
        </Box>
      ) : null;

    const cardGroups = (where: 'project' | 'detail', types: readonly CardType[]) =>
      types.map((type) => ({
        name: type === 'vercel' ? 'Vercel projects' : 'Other services',
        type,
        fields: view.fields[type],
        on: fieldsFor(view, where, type),
      }));

    const fieldsButton = (where: Picking) =>
      textButton(`fields-${where}`, choosingFields === where ? 'Done' : 'Fields', () =>
        redraw($, () => (choosingFields = choosingFields === where ? null : where)),
      );

    /** A heading with something on its right, such as a button. */
    const heading = (left: RenderChildren, right: RenderChildren = null) => (
      <Box flexDirection="row" gap={1} alignItems="center" justifyContent="space-between">
        <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
          {left}
        </Box>
        {right}
      </Box>
    );

    const projectNamed = (id: string | null) => view.projects.find((project) => project.id === id) ?? null;
    const current = place ?? { kind: 'home' };

    /** A task in a box the colour of how urgent it is: its title, a line under it, and what it offers on the right. */
    const taskBox = (key: string, level: Severity, headline: string, under: string, right: RenderChildren) => {
      const severity = SEVERITY[level];
      return (
        <Box
          key={key}
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          gap={1}
          borderStyle="round"
          borderColor={severity.color}
          borderDimColor
          paddingX={1}
          paddingY={space('xs')}
        >
          <Box flexDirection="row" alignItems="center" gap={1} flexShrink={1}>
            <Text color={severity.color}>●</Text>
            <Box flexDirection="column" flexShrink={1}>
              <Text weight="medium">{headline}</Text>
              <Text size="footnote" color={severity.color}>
                {[severity.word, under].filter(Boolean).join(' · ')}
              </Text>
            </Box>
          </Box>
          <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
            {right}
          </Box>
        </Box>
      );
    };

    /**
     * A task from the dashboard's list. On Home its project's name opens the project; on the project's
     * own page that name would lead nowhere new, so it is left out.
     */
    const taskRow = (task: View['tasks'][number], showProject: boolean) => {
      const project = showProject ? projectNamed(task.project?.id ?? null) : null;
      return taskBox(`task-${task.id}`, task.severity, task.title, task.due ? `by ${task.due}` : '', [
        project
          ? named(`task-${task.id}`, () => go($, { kind: 'project', id: project.id }), project.name, {
              color: project.color,
              quiet: true,
            })
          : null,
        <Link key="open" href={task.url} label="↗" />,
      ]);
    };

    /** A service waiting for an OK in its project, as a task of its own, answered here. */
    const approvalRow = (suggestion: View['suggestions'][number]) =>
      taskBox(
        `waiting-${suggestion.id}`,
        'info',
        `${suggestion.name} waits for your OK`,
        suggestion.kind,
        busy
          ? null
          : [
              textButton(
                `approve-${suggestion.id}`,
                'Approve',
                () => act($, 'inbox', [suggestion.id, 'approve']),
                true,
              ),
              textButton(`reject-${suggestion.id}`, 'Reject', () => act($, 'inbox', [suggestion.id, 'reject'])),
            ],
      );

    // Home: every project and every service in two lines each, a name and then what it is linked to,
    // each name opening what it names; what needs attention sits between them, one task to a line.
    if (current.kind === 'home') {
      // A project's waiting services are answered in the project; those for a project not made yet stay here.
      const tasks = view.tasks.filter((task) => task.kind !== APPROVALS || task.project === null);
      const waiting = view.projects.reduce((sum, project) => sum + project.waiting, 0);
      const buckets = [...new Set(view.projects.map((project) => project.bucket))];
      const found = view.providers.filter((provider) => matchesSearch(provider, serviceSearch));
      /** Two lines in a rounded box: the name with a note on its right, then the names it links to. */
      const twoLines = (key: string, first: RenderChildren, right: RenderChildren, second: RenderChildren) => (
        <Box
          key={key}
          flexDirection="column"
          gap={space('sm')}
          borderStyle="round"
          borderColor="subtle"
          borderDimColor
          paddingX={1}
          paddingY={space('sm')}
        >
          {heading(first, right)}
          {second}
        </Box>
      );
      // The names a row links to, quiet on the line under its title, with room between them.
      const links = (children: RenderChildren) => (
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={space('lg')}>
          {children}
        </Box>
      );
      /** A project: its dot and name, then each service it uses, which opens that service's detail. */
      const projectLines = (project: ViewProject) => {
        const services = [...new Map(project.cards.map((card) => [card.provider, card])).values()];
        return twoLines(
          `line-${project.id}`,
          [
            named(`project-${project.id}`, () => go($, { kind: 'project', id: project.id }), project.name, {
              color: project.color,
            }),
            project.clientName ? <Box key="client">{meta(project.clientName)}</Box> : null,
          ],
          project.waiting > 0 ? (
            <Text size="footnote" color="warning">
              {project.waiting} waiting for your OK
            </Text>
          ) : (
            meta(project.status)
          ),
          services.length === 0
            ? meta('No services yet')
            : links(
                services.map((card) =>
                  named(
                    `line-${project.id}-${card.provider}`,
                    () => go($, { kind: 'service', provider: card.provider, from: project.id }),
                    card.title,
                    { quiet: true },
                  ),
                ),
              ),
        );
      };
      /** A service: its mark and name, its spend this month, then each project that uses it. */
      const serviceLines = (provider: ViewProvider) =>
        twoLines(
          `service-line-${provider.provider}`,
          [
            <Box key="mark">{markOf(provider.provider, provider.title)}</Box>,
            named(
              `service-${provider.provider}`,
              () => go($, { kind: 'service', provider: provider.provider, from: null }),
              provider.title,
            ),
          ],
          perMonth(provider.monthly),
          provider.projects.length === 0
            ? meta('In no project')
            : links(
                provider.projects.map((project) =>
                  named(
                    `service-${provider.provider}-${project.id}`,
                    () => go($, { kind: 'project', id: project.id }),
                    project.name,
                    { color: project.color, quiet: true },
                  ),
                ),
              ),
        );
      return frame(
        <Box flexDirection="column" gap={space('xl')}>
          {bar}
          {status}
          {notes}
          <Box flexDirection="row" alignItems="flex-start" justifyContent="space-between" gap={1} flexWrap="wrap">
            <Box flexDirection="column" gap={space('xs')} flexShrink={1}>
              {title(view.organization.name)}
              {meta(
                `${plural(view.projects.length, 'project')} · ${plural(view.providers.length, 'service')}${waiting > 0 ? ` · ${waiting} waiting for your OK` : ''}`,
              )}
            </Box>
            {/* Another Stackwarden account or organization: connecting again replaces this computer's key. */}
            {busy ? null : textButton('switch-account', 'Switch account', () => act($, 'switch'))}
          </Box>
          {autoUpdateOffer}
          <Box flexDirection="column" gap={space('md')}>
            {section('Projects')}
            {view.projects.length === 0 ? meta('No projects yet.') : null}
            {buckets.map((bucket) => (
              <Box key={bucket ?? 'all'} flexDirection="column" gap={space('md')}>
                {bucket ? <Text weight="semibold">{bucket}</Text> : null}
                {view.projects.filter((project) => project.bucket === bucket).map(projectLines)}
              </Box>
            ))}
          </Box>
          <Box flexDirection="column" gap={space('md')}>
            {heading(section('Tasks'), <Link href={view.links.home} label="On the dashboard ↗" />)}
            {tasks.length === 0 ? meta('Nothing needs you now.') : null}
            {tasks.map((task) => taskRow(task, true))}
          </Box>
          <Box flexDirection="column" gap={space('md')}>
            {heading(section('Services'), <Link href={view.links.services} label="On the dashboard ↗" />)}
            {view.providers.length === 0 ? (
              meta('No services yet.')
            ) : (
              // Narrows the list as the person types, by a service's name or a project or account it is in.
              <Input
                key="service-search"
                placeholder="Search services, or a project or account they are in"
                value={serviceSearch}
                submitLabel="search"
                onInput={(value) => redraw($, () => (serviceSearch = value))}
                onSubmit={(value) => redraw($, () => (serviceSearch = value))}
              />
            )}
            {view.providers.length > 0 && found.length === 0
              ? meta(`No service matches “${serviceSearch.trim()}”.`)
              : null}
            {found.map(serviceLines)}
          </Box>
        </Box>,
      );
    }

    // A service's detail: its accounts, then every project that uses it, the one the person came from first.
    if (current.kind === 'service') {
      const provider = view.providers.find((each) => each.provider === current.provider);
      const uses = view.projects
        .flatMap((project) =>
          project.cards.filter((card) => card.provider === current.provider).map((card) => ({ project, card })),
        )
        .sort(
          (a, b) =>
            Number(b.project.id === current.from) - Number(a.project.id === current.from) ||
            a.project.name.localeCompare(b.project.name),
        );
      const types = [...new Set(uses.map(({ card }) => card.type))];
      const name = provider?.title ?? uses[0]?.card.title ?? current.provider;
      return frame(
        <Box flexDirection="column" gap={space('xl')}>
          {bar}
          {notes}
          {heading(
            [<Box key="mark">{markOf(current.provider, name)}</Box>, <Box key="title">{title(name)}</Box>],
            provider ? perMonth(provider.monthly, 'heading') : null,
          )}
          {provider ? meta(provider.summary) : null}
          {provider && provider.accounts.length > 0 ? (
            <Box flexDirection="column" gap={space('xs')}>
              {section('Accounts')}
              {provider.accounts.map((account) =>
                boxed(
                  `account-${account.name}-${account.owner}`,
                  'subtle',
                  [
                    <Text key="name" weight="semibold">
                      {account.name}
                    </Text>,
                    meta(`${account.owner} · ${account.reads}${account.plan ? ` · ${account.plan}` : ''}`),
                  ],
                  perMonth(account.monthly),
                ),
              )}
            </Box>
          ) : null}
          {heading(
            section(plural(new Set(uses.map(({ project }) => project.id)).size, 'project')),
            fieldsButton('detail'),
          )}
          {picker('detail', cardGroups('detail', types))}
          <Box flexDirection="column" gap={space('md')}>
            {uses.map(({ project, card }) =>
              serviceCard(card, fieldsFor(view, 'detail', card.type), null, {
                marked: project.id === current.from,
                // The page names the service, so each card is headed by its project, whose name opens
                // it, and the service's own name in that project where it has one.
                head: (
                  <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
                    <Box flexDirection="row" alignItems="center" gap={1} flexShrink={1}>
                      {named(
                        `detail-project-${card.serviceId}`,
                        () => go($, { kind: 'project', id: project.id }),
                        project.name,
                        { color: project.color },
                      )}
                      {card.subtitle ? (
                        <Text size="footnote" mono dimColor>
                          {card.subtitle}
                        </Text>
                      ) : null}
                    </Box>
                    {project.id === current.from ? meta('you came from here') : null}
                  </Box>
                ),
              }),
            )}
          </Box>
        </Box>,
      );
    }

    /**
     * This repo's Vercel project: named when it is matched, else a pick from the team's projects in
     * no Stackwarden project yet, which links it (round 1, finding 11).
     */
    const vercelMatch = () => {
      const team = panel.team;
      if (!team) return null;
      const matched = team.projects.filter((each) => each.thisRepo);
      if (matched.length > 0) {
        return meta(`Matched to your Vercel project ${matched.map((each) => each.name).join(', ')}.`);
      }
      const link = (id: string) => () => {
        void (async () => {
          await act($, 'link', [id, await $.session.cwd()]);
        })();
      };
      const free = team.projects.filter((each) => each.stackwarden === null);
      return (
        <Box flexDirection="column" gap={space('sm')}>
          {section('Vercel')}
          {meta('No Vercel project is matched to this repo yet. Which one is it?')}
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={space('lg')}>
            {free.map((each) => textButton(`pick-${each.id}`, each.name, link(each.id)))}
            {textButton('pick-none', 'None of these', link('none'))}
          </Box>
        </Box>
      );
    };

    // A project: its tasks, each waiting service one of them, then its service cards.
    const project = view.projects.find((each) => each.id === current.id);
    if (!project) {
      return frame(
        <Box flexDirection="column" gap={space('xl')}>
          {bar}
          {meta(`That project is no longer in ${view.organization.name}.`)}
        </Box>,
      );
    }
    const types = [...new Set(project.cards.map((card) => card.type))];
    const isRepo = repoProject(panel)?.id === project.id;
    const waiting = view.suggestions.filter((suggestion) => suggestion.project?.id === project.id);
    // The project's own tasks, as Home lists them, with each waiting service a task in place of the
    // dashboard's count of them: the urgent first, then what waits for an OK, then the rest.
    const tasks = view.tasks.filter((task) => task.project?.id === project.id && task.kind !== APPROVALS);
    const urgent = tasks.filter((task) => task.severity !== 'info');
    const later = tasks.filter((task) => task.severity === 'info');
    return frame(
      <Box flexDirection="column" gap={space('xl')}>
        {bar}
        {status}
        {notes}
        <Box flexDirection="column" gap={space('xs')}>
          {heading(
            [
              <Text key="dot" color={PROJECT_COLORS[project.color]}>
                ●
              </Text>,
              <Box key="title">{title(project.name)}</Box>,
              <Text key="status" size="caption" weight="semibold" inverse>
                {` ${project.status} `}
              </Text>,
            ],
            <Link href={project.url} label="Open on the dashboard ↗" />,
          )}
          {meta(
            `${project.clientName ? `Client: ${project.clientName}` : 'Own project'}${project.repo ? ` · ${project.repo}` : ''}${isRepo ? ' · this repo' : ''}`,
          )}
        </Box>
        {isRepo ? vercelMatch() : null}
        {tasks.length + waiting.length > 0 ? (
          <Box flexDirection="column" gap={space('md')}>
            {section('Tasks')}
            {urgent.map((task) => taskRow(task, false))}
            {waiting.map(approvalRow)}
            {later.map((task) => taskRow(task, false))}
          </Box>
        ) : null}
        {heading(section(plural(project.cards.length, 'service')), fieldsButton('project'))}
        {picker('project', cardGroups('project', types))}
        {project.cards.length === 0 ? meta('No services yet.') : null}
        <Box flexDirection="column" gap={space('xl')}>
          {project.cards.map((card) =>
            serviceCard(card, fieldsFor(view, 'project', card.type), () =>
              go($, { kind: 'service', provider: card.provider, from: project.id }),
            ),
          )}
        </Box>
      </Box>,
    );
  });
};
