import { expect, test } from 'claude-code/testing';
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
    projects: [{ id: 'prj_web', keys: ['token_web'] }],
  },
  view: VIEW,
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
function engine(on: Parameters<TestBody>[1], runs: string[][], panel: object = PANEL, stored: unknown[][] = []) {
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
  on('clock.every', () => ({ value: undefined }));
  on('process.hookEnv', () => ({ value: {} }));
  on('session.cwd', () => ({ value: '/code/web/.claude/worktrees/x' }));
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('process.run', (_, e) => {
    runs.push([...e.argv]);
    const command = e.argv[2];
    const stdout = command === 'panel' ? JSON.stringify(panel) : JSON.stringify({ say: 'Done.', next: 'done' });
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
  });
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
    // Text with no fill, except on the terminal, which draws a button as `[ label ]`.
    const nav = await ui.find({ type: 'Button', key: 'nav-home' });
    expect(nav?.props.plain).toBe(surface === 'terminal' ? undefined : true);
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
  // Approve, the main action, is the one filled button; Reject is text.
  expect((await ui.find({ type: 'Button', key: `approve-${RESEND}` }))?.props.variant).toBe('primary');
  expect((await ui.find({ type: 'Button', key: `reject-${RESEND}` }))?.props.plain).toBe(true);
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
  expect((await ui.find({ type: 'Text', text: /^Local build · / }))?.text).toMatch(/^Local build · \S+/);
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

test('tells of a newer version, updates through the script, and offers auto-update with it', async ($, on) => {
  const runs: string[][] = [];
  engine(on, runs, fromMarketplace('0.5.0', false));
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect(await ui.find({ type: 'Text', text: 'Stackwarden 0.5.0 is out' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /^You have 0\.4\.0\. With auto-update on/ })).toBeDefined();
  expect((await ui.find({ type: 'Button', key: 'plugin-update' }))?.props.variant).toBe('primary');
  await ui.press({ key: 'plugin-update' });
  expect(runs.some((argv) => argv[2] === 'update')).toBe(true);
  await ui.press({ key: 'auto-update-on' });
  expect(runs.find((argv) => argv[2] === 'autoupdate')?.slice(2)).toEqual(['autoupdate', 'on']);
  // On every view, under the navigation: Home too.
  await ui.press({ key: 'nav-home' });
  expect(await ui.find({ type: 'Text', text: 'Stackwarden 0.5.0 is out' })).toBeDefined();
  await ui.unmount();
});

test('tells nothing, and offers nothing, on the newest version with auto-update on', async ($, on) => {
  engine(on, [], fromMarketplace(OWN_VERSION, true));
  await started($);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect(await ui.find({ type: 'Text', text: /is out$/ })).toBeUndefined();
  // Every view says which version runs.
  expect(await ui.find({ type: 'Text', text: `Stackwarden plugin ${OWN_VERSION}` })).toBeDefined();
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

test('offers auto-update on Home once, and keeps "Not now"', async ($, on) => {
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
