import { expect, test } from 'claude-code/testing';
import type { TestBody } from 'claude-code/testing';

// The panel as `sw.mjs panel` describes a filed repo with one Vercel project of a team of two.
const NOW = new Date().toISOString();
const PANEL = {
  status: { state: 'connected', action: 'refresh', text: 'Vercel connected', readAt: NOW },
  organization: 'Kancl',
  repo: {
    name: 'stackwarden',
    remote: 'github.com/acme/stackwarden',
    filed: {
      project: { name: 'stackwarden', url: 'https://stackwarden.example/projects/1' },
      unread: ['GitHub', 'Supabase', 'Stripe'],
    },
  },
  team: {
    account: { id: 'team_acme', name: "Acme's projects" },
    readAt: NOW,
    plan: { name: 'pro', price: { amount: '40.00', currency: 'USD', interval: 'month' } },
    cost: { since: '2026-11-08', period: true, totals: [{ amount: 53.33, currency: 'USD', estimated: false }] },
    tokens: [
      { id: 'token_sw', name: 'Stackwarden', expiresAt: null, lastUsedAt: null },
      { id: 'token_ci', name: 'ci', expiresAt: null, lastUsedAt: null },
    ],
    unassigned: [{ id: 'token_ci', name: 'ci', expiresAt: null, lastUsedAt: null }],
    projects: [
      {
        id: 'prj_sw',
        name: 'stackwarden',
        url: 'https://stackwarden.vercel.app',
        domains: 7,
        repo: 'github.com/acme/stackwarden',
        framework: 'nextjs',
        branch: 'main',
        deploy: { state: 'ready', at: NOW },
        activity: { deployments: 192, buildMinutes: 141.5, cost: [{ amount: 3.2, currency: 'USD' }], visitors: null },
        stackwarden: { name: 'stackwarden', url: 'https://stackwarden.example/projects/1' },
        keys: ['token_sw'],
        thisRepo: true,
      },
      {
        id: 'prj_shop',
        name: 'shop',
        url: null,
        domains: null,
        repo: null,
        framework: null,
        branch: null,
        deploy: { state: 'failed', at: null },
        activity: null,
        stackwarden: null,
        keys: [],
        thisRepo: false,
      },
    ],
  },
  links: {
    connections: 'https://stackwarden.example/settings/connections',
    tokens: 'https://vercel.com/account/tokens',
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
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const;

/** The engine beneath the panel: each call it makes answered, and every script run recorded. */
function engine(on: Parameters<TestBody>[1], runs: string[][]) {
  on('command.register', () => ({ value: { command: 'stackwarden' } }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('ui.status', () => ({ value: undefined }));
  on('store.get', () => ({ value: undefined }));
  on('clock.every', () => ({ value: undefined }));
  on('process.hookEnv', () => ({ value: {} }));
  on('session.cwd', () => ({ value: '/code/stackwarden/.claude/worktrees/x' }));
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('process.run', (_, e) => {
    runs.push([...e.argv]);
    const command = e.argv[2];
    const stdout =
      command === 'panel'
        ? JSON.stringify(PANEL)
        : JSON.stringify({ say: 'stackwarden uses Stackwarden, ci.', next: 'done' });
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
  });
}

test("draws the repo, its Vercel card's two sections and the other services, on every surface", async ($, on) => {
  engine(on, []);
  await $.session.start({ cwd: '/code/stackwarden', surface: 'desktop', isInteractive: true });
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect((await ui.find({ type: 'Text', text: /^stackwarden$/ }))?.text).toBe('stackwarden');
    expect(await ui.find({ type: 'Text', text: /^GENERAL/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /USD 53\.33/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /141\.5 build min/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /Stackwarden · never expires/ })).toBeDefined();
    expect(await ui.find({ type: 'Button', key: 'unread', text: /3 more services/ })).toBeDefined();
    // Connected: no second status line, and one Refresh, in the card's footer.
    expect(await ui.findAll({ type: 'Button', text: 'Refresh' })).toHaveLength(1);
    expect(await ui.find({ type: 'Text', text: /isn't in Stackwarden/ })).toBeUndefined();
    await ui.unmount();
  }
});

test("goes up to the team's projects, into another one, and back to this repo", async ($, on) => {
  engine(on, []);
  await $.session.start({ cwd: '/code/stackwarden', surface: 'desktop', isInteractive: true });
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'team' });
  expect(await ui.find({ type: 'Button', key: 'project-prj_shop', text: /shop · not in Stackwarden/ })).toBeDefined();
  await ui.press({ key: 'project-prj_shop' });
  expect(await ui.find({ type: 'Text', text: /Failed/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'Not in Stackwarden' })).toBeDefined();
  await ui.press({ key: 'back' });
  expect(await ui.find({ type: 'Text', text: /^GENERAL/ })).toBeDefined();
  await ui.unmount();
});

test("chooses a project's keys and saves exactly those through the script", async ($, on) => {
  const runs: string[][] = [];
  engine(on, runs);
  await $.session.start({ cwd: '/code/stackwarden', surface: 'desktop', isInteractive: true });
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'choose-keys-prj_sw' });
  await ui.press({ key: 'token-token_ci' });
  await ui.press({ key: 'save-keys' });
  const saved = runs.find((argv) => argv[2] === 'keys');
  expect(saved?.slice(2)).toEqual(['keys', 'prj_sw', 'token_sw', 'token_ci']);
  await ui.unmount();
});
