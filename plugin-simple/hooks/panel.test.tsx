import { expect, mock, test } from 'claude-code/testing';
import type { TestBody } from 'claude-code/testing';

// The panel as `sw.mjs panel` describes an organization with two projects: the repo's, on Vercel and
// Supabase, and another on Supabase, with a service waiting for an OK and a task.
const NOW = new Date().toISOString();
const WEB = '11111111-1111-4111-8111-111111111111';
const SHOP = '22222222-2222-4222-8222-222222222222';
const RESEND = '44444444-4444-4444-8444-444444444444';
const OWN_VERSION = '0.4.0';

const card = (serviceId: string, provider: string, title: string, rows: unknown[], vercel: unknown = null) => ({
  serviceId,
  provider,
  title,
  kind: provider === 'vercel' ? 'Hosting' : 'Database',
  subtitle: null,
  type: provider === 'vercel' ? 'vercel' : 'service',
  source: provider === 'vercel' ? 'Imported from Vercel' : 'Found by a scan',
  notSeenInLatestScan: false,
  rows,
  vercel,
});

const VIEW = {
  organization: { id: '33333333-3333-4333-8333-333333333333', name: 'Kancl' },
  at: NOW,
  projects: [
    {
      id: WEB,
      name: 'web',
      color: 'blue',
      status: 'live',
      clientName: null,
      repo: 'github.com/acme/web',
      bucket: null,
      url: `https://stackwarden.example/projects/${WEB}`,
      waiting: 1,
      cards: [
        card(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'vercel',
          'Vercel',
          [
            { id: 'status', label: 'Status', value: { type: 'status', word: 'Running', detail: '', tone: 'ok' } },
            { id: 'cost', label: 'Cost this month', value: { type: 'text', text: 'USD 3.20', mono: false } },
            {
              id: 'keys',
              label: 'API keys',
              value: {
                type: 'keys',
                items: [{ id: 'k1', name: 'Web deploy', expiry: '21 Dec 2026 · in 26 days', tone: 'ok' }],
                more: 0,
                stale: null,
                unassigned: null,
                manage: null,
              },
            },
            {
              id: 'deployments',
              label: 'Deployments, 30 days',
              value: { type: 'metric', total: '192', days: [1, 4, 2, 8] },
            },
          ],
          { account: 'team_acme', project: 'prj_web' },
        ),
        card('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'supabase', 'Supabase', [
          { id: 'price', label: 'Plan and price', value: { type: 'text', text: 'Pro · $25/mo', mono: false } },
          { id: 'env', label: 'Env var names', value: { type: 'list', items: ['SUPABASE_URL'], more: 0 } },
        ]),
      ],
    },
    {
      id: SHOP,
      name: 'shop',
      color: 'red',
      status: 'dev',
      clientName: 'Harbor',
      repo: 'github.com/acme/shop',
      bucket: null,
      url: `https://stackwarden.example/projects/${SHOP}`,
      waiting: 0,
      cards: [
        card('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'supabase', 'Supabase', [
          { id: 'price', label: 'Plan and price', value: { type: 'text', text: 'Free', mono: false } },
        ]),
      ],
    },
  ],
  providers: [
    {
      provider: 'vercel',
      title: 'Vercel',
      summary: '1 account · 1 project',
      monthly: '$20',
      trial: null,
      accounts: [{ name: 'Acme Team', owner: 'You', monthly: '$20', plan: 'pro', reads: 'Through the Vercel CLI' }],
      projects: [{ id: WEB, name: 'web', color: 'blue' }],
      unassigned: 0,
    },
    {
      provider: 'supabase',
      title: 'Supabase',
      summary: '1 account · 2 projects',
      monthly: '$25',
      trial: null,
      accounts: [{ name: 'Acme', owner: 'You', monthly: '$25', plan: null, reads: 'Entered by hand' }],
      projects: [
        { id: SHOP, name: 'shop', color: 'red' },
        { id: WEB, name: 'web', color: 'blue' },
      ],
      unassigned: 0,
    },
  ],
  tasks: [
    {
      id: 'key-expiring:k1',
      kind: 'key-expiring',
      severity: 'warning',
      title: 'Web deploy expires in 26 days',
      summary: 'Make a new token at Vercel before it expires.',
      due: '21 Dec',
      project: { id: WEB, name: 'web' },
      url: 'https://stackwarden.example/?task=key-expiring%3Ak1',
    },
    {
      id: 'suggestions-waiting:web',
      kind: 'suggestions-waiting',
      severity: 'info',
      title: '1 service waits for approval',
      summary: 'Found in web by a scan.',
      due: null,
      project: { id: WEB, name: 'web' },
      url: 'https://stackwarden.example/?task=suggestions-waiting%3Aweb',
    },
    {
      id: 'suggestions-waiting:new-projects',
      kind: 'suggestions-waiting',
      severity: 'info',
      title: '1 service waits for a new project',
      summary: 'Recorded by Claude Code for a project that does not exist yet.',
      due: null,
      project: null,
      url: 'https://stackwarden.example/?task=suggestions-waiting%3Anew-projects',
    },
  ],
  suggestions: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Resend',
      provider: 'resend',
      kind: 'Email',
      project: { id: WEB, name: 'web' },
    },
  ],
  fields: {
    vercel: [
      { id: 'status', label: 'Status' },
      { id: 'cost', label: 'Cost this month' },
      { id: 'keys', label: 'API keys' },
      { id: 'deployments', label: 'Deployments, 30 days' },
    ],
    service: [
      { id: 'price', label: 'Plan and price' },
      { id: 'env', label: 'Env var names' },
    ],
  },
  defaults: { vercel: ['status', 'deployments'], service: ['price', 'env'] },
  links: { home: 'https://stackwarden.example/', services: 'https://stackwarden.example/services' },
};

const PANEL = {
  status: { state: 'connected', action: 'refresh', text: 'Vercel connected', readAt: NOW },
  organization: 'Kancl',
  repo: { name: 'web', remote: 'github.com/acme/web', filed: null },
  team: {
    account: { id: 'team_acme' },
    tokens: [
      { id: 'token_web', name: 'Web deploy', expiresAt: null },
      { id: 'token_ci', name: 'ci', expiresAt: null },
    ],
    projects: [
      { id: 'prj_web', name: 'web', keys: ['token_web'], thisRepo: true, stackwarden: { name: 'web' } },
      { id: 'prj_blog', name: 'blog', keys: [], thisRepo: false, stackwarden: null },
    ],
  },
  view: VIEW,
};

/** The same panel where no Vercel project is this repo's yet: two are in no Stackwarden project. */
const UNMATCHED = {
  ...PANEL,
  team: {
    ...PANEL.team,
    projects: [
      { id: 'prj_shop', name: 'shop', keys: [], thisRepo: false, stackwarden: { name: 'shop' } },
      { id: 'prj_blog', name: 'blog', keys: [], thisRepo: false, stackwarden: null },
      { id: 'prj_docs', name: 'docs', keys: [], thisRepo: false, stackwarden: null },
    ],
  },
};

const PANE = {
  plugin: 'stackwarden-simple',
  component: 'Pane',
  requestId: 'stackwarden',
  props: {
    title: 'Stackwarden',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const;

/** The engine beneath the panel: each call it makes answered, and every script run recorded. */
/**
 * The engine beneath the panel on a computer whose Node.js is `node` (its `--version`, or null for
 * none): the plugin's scripts answer only on Node.js 22 or newer.
 */
function engine(
  on: Parameters<TestBody>[1],
  runs: string[][],
  panel: object = PANEL,
  stored: unknown[][] = [],
  node: string | null = 'v24.1.0',
  /** When the plugin's state files last changed; without it, the panel has no data folder to look at. */
  stateChangedAt?: () => number,
  /** A test's own answer to a step of the script, or undefined for the usual one. */
  answers?: (argv: readonly string[]) => Promise<object> | undefined,
) {
  on('command.register', () => ({ value: { command: 'stackwarden' } }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('ui.status', () => ({ value: undefined }));
  on('store.get', () => ({ value: undefined }));
  on('store.set', (_, e) => {
    stored.push([e.key, e.value]);
    return { value: undefined };
  });
  // The plugin's own manifest, which says its version.
  on('fs.read', () => ({ value: JSON.stringify({ name: 'stackwarden-simple', version: OWN_VERSION }) }));
  // A clock that moves only when a test moves it, so the panel's own refresh waits its turn.
  const clock = mock.clock(on);
  const env: Record<string, string> = stateChangedAt ? { CLAUDE_PLUGIN_DATA: '/data' } : {};
  on('process.hookEnv', () => ({ value: env }));
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: stateChangedAt?.() ?? 0, isLink: false } }));
  on('session.cwd', () => ({ value: '/code/web/.claude/worktrees/x' }));
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  // A shell command the chat runs answers with nothing.
  on('tool.call', () => ({ result: {} }));
  on('process.run', (_, e) => {
    runs.push([...e.argv]);
    const answer = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    });
    if (e.argv[1] === '--version') return node === null ? answer('', 1) : answer(`${node}\n`);
    if (node === null || Number(/^v(\d+)\./.exec(node)?.[1]) < 22) return answer('', 1);
    const command = e.argv[2];
    const own = answers?.(e.argv);
    if (own) return own.then((value) => answer(JSON.stringify(value)));
    if (command === 'panel') return answer(JSON.stringify(panel));
    if (command === 'update') return answer(JSON.stringify({ say: 'Stackwarden is updated.', next: 'reload' }));
    return answer(JSON.stringify({ say: 'Done.', next: 'done' }));
  });
  return clock;
}

async function started($: Parameters<TestBody>[0]) {
  await $.session.start({ cwd: '/code/web', surface: 'desktop', isInteractive: true });
}

test("opens on the repo's project with its cards and their default fields, on every surface", async ($, on) => {
  engine(on, []);
  await started($);
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: 'Text', text: /^web$/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /this repo/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /Running/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /^192$/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'SUPABASE_URL' })).toBeDefined();
    // A Vercel card shows its keys by default, where the panel chooses them; the cost stays off.
    expect(await ui.find({ type: 'Text', text: /Web deploy/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /USD 3\.20/ })).toBeUndefined();
    expect(await ui.find({ type: 'Button', key: 'nav-home', text: /Dashboard/ })).toBeDefined();
    // A control, filled on every surface, as VS Code fills every button that isn't dim (owner, 0.5.1).
    const nav = await ui.find({ type: 'Button', key: 'nav-home' });
    expect(nav?.props.plain).toBeUndefined();
    expect(nav?.props.dimColor).toBeUndefined();
    await ui.unmount();
  }
});

test("shows a project's own tasks on its page, without a link back to itself", async ($, on) => {
  engine(on, []);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect(await ui.find({ type: 'Text', text: 'Tasks' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'Web deploy expires in 26 days' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'Soon · by 21 Dec' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'task-key-expiring:k1' })).toBeUndefined();
  // Its waiting service is in its own section, not again as a task.
  expect(await ui.find({ type: 'Text', text: /waits for approval/ })).toBeUndefined();
  // Another project's page has none of web's tasks.
  await ui.press({ key: 'nav-home' });
  await ui.press({ key: `project-${SHOP}` });
  expect(await ui.find({ type: 'Text', text: 'Web deploy expires in 26 days' })).toBeUndefined();
  await ui.unmount();
});

test("lists a waiting service among its project's tasks and approves it there, through the script", async ($, on) => {
  const runs: string[][] = [];
  engine(on, runs);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  // A task of its own, after the urgent ones, in place of the dashboard's count of waiting services.
  const tasks = await ui.findAll({ type: 'Text', text: /expires in 26 days|waits for/ });
  expect(tasks.map((each) => each.text)).toEqual(['Web deploy expires in 26 days', 'Resend waits for your OK']);
  expect(await ui.find({ type: 'Text', text: 'When you can · Email' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'Waiting for your OK' })).toBeUndefined();
  // Approve, the main action, is the surface's primary button; Reject a filled control beside it.
  expect((await ui.find({ type: 'Button', key: `approve-${RESEND}` }))?.props.variant).toBe('primary');
  const reject = await ui.find({ type: 'Button', key: `reject-${RESEND}` });
  expect(reject?.props.variant).toBeUndefined();
  expect(reject?.props.plain).toBeUndefined();
  await ui.press({ key: 'approve-44444444-4444-4444-8444-444444444444' });
  expect(runs.find((argv) => argv[2] === 'inbox')?.slice(2)).toEqual([
    'inbox',
    '44444444-4444-4444-8444-444444444444',
    'approve',
  ]);
  await ui.unmount();
});

test('shows Home with no Projects or Services button, and the tasks one to a line, without the approvals', async ($, on) => {
  engine(on, []);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'nav-home' });
  expect(await ui.find({ type: 'Text', text: /^2 projects · 2 services · 1 waiting for your OK$/ })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'home-projects' })).toBeUndefined();
  expect(await ui.find({ type: 'Button', key: 'home-services' })).toBeUndefined();
  // A task says how urgent it is, and its project's name opens the project; an approval waits there.
  expect(await ui.find({ type: 'Text', text: 'Web deploy expires in 26 days' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'Soon · by 21 Dec' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'task-key-expiring:k1', text: 'web ›' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /waits for approval/ })).toBeUndefined();
  expect(await ui.find({ type: 'Button', key: 'approve-44444444-4444-4444-8444-444444444444' })).toBeUndefined();
  // Services waiting for a project not made yet have no project to wait in, so their task stays here.
  expect(await ui.find({ type: 'Text', text: '1 service waits for a new project' })).toBeDefined();
  await ui.press({ key: 'task-key-expiring:k1' });
  expect(await ui.find({ type: 'Text', text: 'Resend waits for your OK' })).toBeDefined();
  await ui.unmount();
});

test("keeps a task's title in its row on a terminal, where a link writes its whole URL", async ($, on) => {
  engine(on, []);
  await started($);
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    await ui.press({ key: 'nav-home' });
    expect(await ui.find({ type: 'Text', text: 'Web deploy expires in 26 days' })).toBeDefined();
    const links = await ui.findAll({ type: 'Link', text: /^↗$/ });
    expect(links.length === 0).toBe(surface === 'terminal');
    // The tasks stay one link away: "On the dashboard" above them.
    expect(await ui.find({ type: 'Link', text: 'On the dashboard ↗' })).toBeDefined();
    await ui.unmount();
  }
});

test('shows each project on Home in two lines: its name, then its services, each opening what it names', async ($, on) => {
  engine(on, []);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'nav-home' });
  expect(await ui.find({ type: 'Button', key: `project-${SHOP}`, text: 'shop ›' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'Harbor' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'dev' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: '1 waiting for your OK' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: `line-${WEB}-vercel`, text: 'Vercel ›' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: `line-${WEB}-supabase`, text: 'Supabase ›' })).toBeDefined();
  // A project has its dot and a service never does; a title is bright, a name on the line under it quiet.
  expect(await ui.find({ type: 'Box', key: `project-${SHOP}-named` })).toBeDefined();
  expect(await ui.find({ type: 'Box', key: `line-${WEB}-supabase-named` })).toBeUndefined();
  expect((await ui.find({ type: 'Button', key: `project-${SHOP}` }))?.props.dimColor).toBeUndefined();
  expect((await ui.find({ type: 'Button', key: `line-${WEB}-supabase` }))?.props.dimColor).toBe(true);
  expect((await ui.find({ type: 'Button', key: 'service-supabase' }))?.props.dimColor).toBeUndefined();
  expect((await ui.find({ type: 'Button', key: `service-supabase-${SHOP}` }))?.props.dimColor).toBe(true);
  // A service there opens its detail, with the project it was pressed in first.
  await ui.press({ key: `line-${SHOP}-supabase` });
  const projects = await ui.findAll({ type: 'Button', text: /^(web|shop) ›$/ });
  expect(projects.map((each) => each.text)).toEqual(['shop ›', 'web ›']);
  expect(await ui.find({ type: 'Text', text: /you came from here/ })).toBeDefined();
  await ui.press({ key: 'nav-home' });
  await ui.press({ key: `project-${SHOP}` });
  expect(await ui.find({ type: 'Text', text: /^Client: Harbor · github\.com\/acme\/shop/ })).toBeDefined();
  await ui.unmount();
});

test('shows each service on Home in two lines: its name and spend, then its projects, each opening what it names', async ($, on) => {
  engine(on, []);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'nav-home' });
  expect(await ui.find({ type: 'Button', key: 'service-supabase', text: 'Supabase ›' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: '$25/mo' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: `service-supabase-${SHOP}`, text: 'shop ›' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: `service-supabase-${WEB}`, text: 'web ›' })).toBeDefined();
  await ui.press({ key: `service-supabase-${SHOP}` });
  expect(await ui.find({ type: 'Text', text: /^Client: Harbor/ })).toBeDefined();
  await ui.press({ key: 'nav-home' });
  await ui.press({ key: 'service-supabase' });
  expect(await ui.find({ type: 'Text', text: /Entered by hand/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /you came from here/ })).toBeUndefined();
  await ui.unmount();
});

test('searches the services on Home as the person types: by name, or a project or account they are in', async ($, on) => {
  engine(on, []);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'nav-home' });
  const shown = async () =>
    (await ui.findAll({ type: 'Button', text: /^(Vercel|Supabase) ›$/ }))
      .filter((each) => each.key?.startsWith('service-'))
      .map((each) => each.text);
  expect(await shown()).toEqual(['Vercel ›', 'Supabase ›']);
  await ui.input({ key: 'service-search', text: 'VERC', kind: 'change' });
  expect(await shown()).toEqual(['Vercel ›']);
  await ui.input({ key: 'service-search', text: 'shop', kind: 'change' });
  expect(await shown()).toEqual(['Supabase ›']);
  await ui.input({ key: 'service-search', text: 'acme team', kind: 'change' });
  expect(await shown()).toEqual(['Vercel ›']);
  await ui.input({ key: 'service-search', text: 'stripe ', kind: 'change' });
  expect(await shown()).toEqual([]);
  expect(await ui.find({ type: 'Text', text: 'No service matches “stripe”.' })).toBeDefined();
  // The projects above are not searched.
  expect(await ui.find({ type: 'Button', key: `project-${SHOP}` })).toBeDefined();
  await ui.input({ key: 'service-search', text: '', kind: 'change' });
  expect(await shown()).toEqual(['Vercel ›', 'Supabase ›']);
  await ui.unmount();
});

test("opens a card's service detail with the project it came from first, and one choice of fields", async ($, on) => {
  engine(on, []);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'open-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
  expect(await ui.find({ type: 'Text', text: /you came from here/ })).toBeDefined();
  const projects = await ui.findAll({ type: 'Button', text: /^(web|shop) ›$/ });
  expect(projects.map((each) => each.text)).toEqual(['web ›', 'shop ›']);
  expect(await ui.find({ type: 'Text', text: /Entered by hand/ })).toBeDefined();
  // The page names the service once; its cards are headed by their projects, without its name or kind again.
  expect(await ui.findAll({ type: 'Text', text: 'Supabase' })).toHaveLength(1);
  expect(await ui.find({ type: 'Text', text: 'Database' })).toBeUndefined();
  // The detail's own choice, one for every project in it: turning env var names off hides them all.
  expect(await ui.findAll({ type: 'Text', text: /Free|Pro · \$25\/mo/ })).toHaveLength(2);
  expect(await ui.find({ type: 'Text', text: 'SUPABASE_URL' })).toBeDefined();
  await ui.press({ key: 'fields-detail' });
  await ui.press({ key: 'field-detail-service-env' });
  expect(await ui.find({ type: 'Text', text: 'SUPABASE_URL' })).toBeUndefined();
  await ui.unmount();
});

test("chooses a Vercel project's keys in the service detail and saves exactly those", async ($, on) => {
  const runs: string[][] = [];
  engine(on, runs);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'open-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  expect(await ui.find({ type: 'Text', text: /USD 3\.20/ })).toBeDefined();
  await ui.press({ key: 'choose-keys-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  await ui.press({ key: 'token-token_ci' });
  await ui.press({ key: 'save-keys' });
  expect(runs.find((argv) => argv[2] === 'keys')?.slice(2)).toEqual(['keys', 'prj_web', 'token_web', 'token_ci']);
  await ui.unmount();
});

test("names the Vercel project matched to this repo on the repo's page", async ($, on) => {
  engine(on, []);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect(await ui.find({ type: 'Text', text: 'Matched to your Vercel project web.' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'pick-none' })).toBeUndefined();
  await ui.unmount();
});

test('offers the Vercel projects in no Stackwarden project when none is matched, and links the one picked', async ($, on) => {
  const runs: string[][] = [];
  engine(on, runs, UNMATCHED);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect(await ui.find({ type: 'Text', text: /^No Vercel project is matched to this repo yet/ })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'pick-prj_blog', text: 'blog' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'pick-prj_docs', text: 'docs' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'pick-none', text: 'None of these' })).toBeDefined();
  // One already in a Stackwarden project is not offered.
  expect(await ui.find({ type: 'Button', key: 'pick-prj_shop' })).toBeUndefined();
  await ui.press({ key: 'pick-prj_docs' });
  expect(runs.find((argv) => argv[2] === 'link')?.slice(2)).toEqual([
    'link',
    'prj_docs',
    '/code/web/.claude/worktrees/x',
  ]);
  await ui.unmount();
});

test('reads what it shows again once the chat runs a step of the script, and not for its own reads', async ($, on) => {
  const runs: string[][] = [];
  const clock = engine(on, runs);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await clock.settle();
  const panelRuns = () => runs.filter((argv) => argv[2] === 'panel').length;
  // The panel reads again beside the call, without holding the call up.
  const ran = async (tool: 'Bash' | 'PowerShell', command: string) => {
    await $.tool.call({ tool, command, agentId: 'a1' });
    await clock.settle();
  };
  const before = panelRuns();
  const script = 'node "/p/stackwarden-simple/scripts/sw.mjs" --data "/d/stackwarden-simple"';
  await ran('Bash', `${script} panel`);
  await ran('Bash', 'ls scripts');
  expect(panelRuns()).toBe(before);
  await ran('Bash', `${script} send .`);
  expect(panelRuns()).toBe(before + 1);
  await ran('PowerShell', `& ${script} link prj_web .`);
  expect(panelRuns()).toBe(before + 2);
  await ui.unmount();
});

test('asks Stackwarden for the dashboard when it opens and every 10 minutes, as the README says', async ($, on) => {
  const runs: string[][] = [];
  const clock = engine(on, runs);
  await started($);
  await clock.settle();
  const views = () => runs.filter((argv) => argv[2] === 'view').length;
  expect(views()).toBe(1);
  await clock.advance(9 * 60_000);
  expect(views()).toBe(1);
  await clock.advance(60_000);
  expect(views()).toBe(2);
});

test('draws the reading the session-start hook sends in the background within seconds, and stops looking after 3 minutes', async ($, on) => {
  const runs: string[][] = [];
  let changed = 1;
  const clock = engine(on, runs, PANEL, [], 'v24.1.0', () => changed);
  await started($);
  await clock.settle();
  const panels = () => runs.filter((argv) => argv[2] === 'panel').length;
  const before = panels();
  await clock.advance(3_000);
  expect(panels()).toBe(before);
  // The hook's reading lands: Stackwarden answered, and the plugin wrote down what it said.
  changed = 2;
  await clock.advance(3_000);
  expect(panels()).toBe(before + 1);
  // Past the watch, a change waits for the panel's next reason to read, such as its 10-minute refresh.
  await clock.advance(4 * 60_000);
  changed = 3;
  await clock.advance(3_000);
  expect(panels()).toBe(before + 1);
});

test('shows no monthly cost for a service whose bill names none', async ($, on) => {
  const free = {
    ...PANEL,
    view: {
      ...VIEW,
      providers: VIEW.providers.map((each) =>
        each.provider === 'vercel'
          ? { ...each, monthly: '$0.00', accounts: each.accounts.map((account) => ({ ...account, monthly: '$0.00' })) }
          : each,
      ),
    },
  };
  engine(on, [], free);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'nav-home' });
  expect(await ui.find({ type: 'Text', text: '$25/mo' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /\$0(?:\.00)?\/mo/ })).toBeUndefined();
  await ui.press({ key: 'service-vercel' });
  expect(await ui.find({ type: 'Text', text: /\$0(?:\.00)?\/mo/ })).toBeUndefined();
  await ui.unmount();
});

test('says it is a local build, and that a local build connects on its own', async ($, on) => {
  const unconnected = {
    ...PANEL,
    status: {
      state: 'not_connected',
      action: 'connect',
      text: "This computer isn't connected to Stackwarden",
      readAt: null,
    },
    organization: null,
    team: null,
    view: null,
  };
  engine(on, [], unconnected);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect((await ui.find({ type: 'Text', text: /^Local build · / }))?.text).toMatch(/^Local build · \S+ · 0\.4\.0$/);
  expect(await ui.find({ type: 'Text', text: /keeps a connection of its own/ })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'action', text: 'Connect this computer' })).toBeDefined();
  await ui.unmount();
});

/** The panel as the marketplace's copy sees it: Stackwarden names `latest`, and auto-update is as given. */
const fromMarketplace = (latest: string, autoUpdate: boolean | null) => ({
  ...PANEL,
  view: { ...VIEW, plugin: { latest } },
  plugin: { autoUpdate },
});

test('tells of a newer version among the tasks, updates through the script, and offers auto-update', async ($, on) => {
  const runs: string[][] = [];
  engine(on, runs, fromMarketplace('0.5.0', false));
  const filled: string[] = [];
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }));
  on('prompt.fill', (_, e) => {
    filled.push(e.text);
    return { isFilled: true };
  });
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  // A task, so on Home, first among the tasks; not on a project's page.
  expect(await ui.find({ type: 'Text', text: 'Stackwarden 0.5.0 is out' })).toBeUndefined();
  await ui.press({ key: 'nav-home' });
  expect(await ui.find({ type: 'Text', text: 'Stackwarden 0.5.0 is out' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'Soon · You have 0.4.0' })).toBeDefined();
  expect((await ui.find({ type: 'Button', key: 'plugin-update' }))?.props.variant).toBe('primary');
  expect(await ui.find({ type: 'Text', text: 'Turn on auto-update' })).toBeDefined();
  await ui.press({ key: 'auto-update-on' });
  expect(runs.find((argv) => argv[2] === 'autoupdate')?.slice(2)).toEqual(['autoupdate', 'on']);
  // The update runs past a press's 10 seconds, so the press only starts it, and the task says what
  // makes the new version run once it is installed.
  await ui.press({ key: 'plugin-update' });
  expect(runs.some((argv) => argv[2] === 'update')).toBe(true);
  expect(await ui.find({ type: 'Text', text: 'Stackwarden 0.5.0 is installed' })).toBeDefined();
  expect(
    await ui.find({
      type: 'Text',
      text: 'When you can · To use it, reload the plugins or start a new session.',
    }),
  ).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'plugin-update' })).toBeUndefined();
  // Said once, in the task: the script's own answer isn't drawn under it again.
  expect(await ui.find({ type: 'Text', text: 'Stackwarden is updated.' })).toBeUndefined();
  // One press puts /reload-plugins in the chat; the person sends it.
  await ui.press({ key: 'reload-plugins' });
  expect(filled).toEqual(['/reload-plugins']);
  expect(await ui.find({ type: 'Text', text: '/reload-plugins is in the chat: press Enter.' })).toBeDefined();
  await ui.unmount();
});

test('dismisses a newer version until a newer one is out', async ($, on) => {
  const stored: unknown[][] = [];
  engine(on, [], fromMarketplace('0.5.0', true), stored);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'nav-home' });
  await ui.press({ key: 'plugin-update-dismiss' });
  expect(await ui.find({ type: 'Text', text: 'Stackwarden 0.5.0 is out' })).toBeUndefined();
  expect(stored).toContainEqual(['update-dismissed', '0.5.0']);
  await ui.unmount();
});

test('switches this computer to another account from Home, by connecting it again', async ($, on) => {
  const runs: string[][] = [];
  engine(on, runs);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'nav-home' });
  await ui.press({ key: 'switch-account' });
  expect(runs.filter((argv) => argv[2] === 'connect').map((argv) => argv.slice(2))).toEqual([['connect']]);
  // Connected again: the panel asks for the organization it now goes to.
  expect(runs.filter((argv) => argv[2] === 'view').length).toBeGreaterThan(0);
  await ui.unmount();
});

test('cancels a connection the browser waits for, and offers Switch account again', async ($, on) => {
  const runs: string[][] = [];
  let release: () => void = () => undefined;
  const cancelled = new Promise<void>((done) => (release = done));
  engine(on, runs, PANEL, [], 'v24.1.0', undefined, (argv) => {
    if (argv[2] !== 'connect') return undefined;
    if (argv[3] === undefined) return Promise.resolve({ say: 'Opened.', next: 'connect_wait' });
    if (argv[3] === 'wait') return cancelled.then(() => ({ say: 'Connecting was cancelled.', next: 'done' }));
    release();
    return Promise.resolve({ say: 'Cancelled. This computer stays connected to “Kancl”.', next: 'done' });
  });
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'nav-home' });
  await ui.press({ key: 'switch-account' });
  // The page may be closed, or show the wrong account: the wait says so, with a way out.
  expect(await ui.find({ type: 'Text', text: /^Stackwarden opened in your browser/ })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'switch-account' })).toBeUndefined();
  await ui.press({ key: 'connect-cancel' });
  expect(runs.some((argv) => argv[2] === 'connect' && argv[3] === 'cancel')).toBe(true);
  expect(await ui.find({ type: 'Button', key: 'switch-account' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'connect-cancel' })).toBeUndefined();
  await ui.unmount();
});

test('draws VS Code its own spacing in numbers, and its buttons as every surface', async ($, on) => {
  engine(on, [], fromMarketplace('0.5.0', false));
  await started($);
  for (const surface of ['vscode', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    await ui.press({ key: 'nav-home' });
    const boxes = await ui.findAll({ type: 'Box' });
    const named = boxes.flatMap((box) => [box.props.gap, box.props.paddingY].filter((v) => typeof v === 'string'));
    expect(named.length === 0).toBe(surface === 'vscode');
    // A control is a filled button on every surface, and a name a link: VS Code fills a button that
    // isn't dim, and dimmed, nothing in the panel caught the eye.
    const refresh = await ui.find({ type: 'Button', key: 'refresh' });
    expect(refresh?.props.dimColor).toBeUndefined();
    expect(refresh?.props.plain).toBeUndefined();
    const [name] = await ui.findAll({ type: 'Button', text: /›$/ });
    expect(name?.props.plain).toBe(true);
    // A project's or a service's name stays a button that isn't dim, which VS Code fills: it flattens
    // what a button holds to plain text, so a bold or coloured name can't show there.
    expect(name?.props.dimColor).toBeUndefined();
    expect((await ui.find({ type: 'Button', key: 'plugin-update' }))?.props.variant).toBe('primary');
    expect((await ui.find({ type: 'Button', key: 'plugin-update' }))?.props.dimColor).toBeUndefined();
    await ui.unmount();
  }
});

test('tells nothing, and offers nothing, on the newest version with auto-update on', async ($, on) => {
  engine(on, [], fromMarketplace(OWN_VERSION, true));
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect(await ui.find({ type: 'Text', text: /is out$/ })).toBeUndefined();
  // Every view starts with which version runs; a test runs from the source, as a local build.
  const [first] = await ui.findAll({ type: 'Text' });
  expect(first?.text).toMatch(new RegExp(`^Local build · \\S+ · ${OWN_VERSION.replaceAll('.', '\\.')}$`));
  await ui.press({ key: 'nav-home' });
  expect(await ui.find({ type: 'Button', key: 'auto-update-on' })).toBeUndefined();
  await ui.unmount();
});

test("says nothing of updates where the plugin isn't its marketplace's copy", async ($, on) => {
  engine(on, [], fromMarketplace('0.5.0', null));
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect(await ui.find({ type: 'Text', text: /is out$/ })).toBeUndefined();
  await ui.press({ key: 'nav-home' });
  expect(await ui.find({ type: 'Button', key: 'auto-update-on' })).toBeUndefined();
  await ui.unmount();
});

test('offers auto-update among the tasks on Home, and keeps its Dismiss', async ($, on) => {
  const runs: string[][] = [];
  const stored: unknown[][] = [];
  engine(on, runs, fromMarketplace(OWN_VERSION, false), stored);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  // Not on a project's page: Home is where it is offered.
  expect(await ui.find({ type: 'Button', key: 'auto-update-on' })).toBeUndefined();
  await ui.press({ key: 'nav-home' });
  expect(await ui.find({ type: 'Text', text: /arrive by themselves only with auto-update on/ })).toBeDefined();
  await ui.press({ key: 'auto-update-later' });
  expect(await ui.find({ type: 'Button', key: 'auto-update-on' })).toBeUndefined();
  expect(stored).toContainEqual(['auto-update-declined', true]);
  expect(runs.some((argv) => argv[2] === 'autoupdate')).toBe(false);
  await ui.unmount();
});

test('says Node.js is missing, with where to get it, instead of reading for ever', async ($, on) => {
  engine(on, [], PANEL, [], null);
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect(await ui.find({ type: 'Text', text: 'Stackwarden needs Node.js 22 or newer' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /which this computer doesn't have\. Install Node\.js 22/ })).toBeDefined();
  expect(await ui.find({ type: 'Link', text: 'Download Node.js ↗' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /reading what this computer knows/ })).toBeUndefined();
  await ui.unmount();
});

test('says which Node.js this computer has when it is too old', async ($, on) => {
  engine(on, [], PANEL, [], 'v20.11.0');
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect(
    await ui.find({ type: 'Text', text: /needs Node\.js 22 or newer, and this computer has v20\.11\.0/ }),
  ).toBeDefined();
  await ui.unmount();
});
