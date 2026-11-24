import type { EngineInterface, Register } from 'claude-code';

// The Stackwarden panel beside the chat (ADR 0076): whether Vercel is connected, with the one button
// that fixes it, a short Vercel card whose fields the person chooses, and this repo's project. It
// only shows what `sw.mjs panel` reads on this computer, and acts only through `sw.mjs`: the path
// works the same without it, in words in the chat.

const PANE = 'stackwarden';
const COMMAND = 'stackwarden';
const REFRESH_MS = 10 * 60_000;
const FIELDS_KEY = 'fields';
const LONG_MS = 10 * 60_000;
const SHORT_MS = 30_000;

type FieldId = 'plan' | 'cost' | 'projects' | 'tokens' | 'unused' | 'deploys' | 'visitors' | 'domains';

const FIELDS: readonly { id: FieldId; label: string; initial: boolean }[] = [
  { id: 'plan', label: 'Plan and its price', initial: true },
  { id: 'cost', label: 'Cost this billing period', initial: true },
  { id: 'projects', label: 'Projects, and failing deploys', initial: true },
  { id: 'tokens', label: 'Tokens, and the next to expire', initial: true },
  { id: 'unused', label: 'Tokens unused for 90 days', initial: false },
  { id: 'deploys', label: 'Deployments and build minutes this month', initial: false },
  { id: 'visitors', label: 'Visitors and page views this month', initial: false },
  { id: 'domains', label: 'Domains', initial: false },
];

type Action = 'refresh' | 'sign_in' | 'connect' | 'set_up';

const ACTION_LABELS: Record<Action, string> = {
  refresh: 'Refresh',
  sign_in: 'Sign in to Vercel',
  connect: 'Connect this computer',
  set_up: 'Set up the Vercel CLI',
};

const BUSY: Record<Action, string> = {
  refresh: 'Reading Vercel…',
  sign_in: 'Approve the sign-in in your browser, at Vercel…',
  connect: 'Approve this computer in your browser, at Stackwarden…',
  set_up: 'Setting up the Vercel CLI, about two minutes…',
};

interface Summary {
  account: { name: string; plan: string | null };
  readAt: string;
  plan: { name: string; price: { amount: string; currency: string; interval: string } | null } | null;
  cost: { amount: number; currency: string; estimated: boolean }[] | null;
  projects: { count: number; failing: string[] };
  tokens: { count: number; nextExpiry: { name: string; expiresAt: string } | null; unused: number } | null;
  deploys: { deployments: number; buildMinutes: number } | null;
  visitors: { visitors: number; pageViews: number } | null;
  domains: number | null;
}

interface PanelData {
  status: { state: string; action: Action; text: string; readAt: string | null };
  organization: string | null;
  vercel: Summary | null;
  repo: { project: { name: string; url: string }; unread: string[] } | null;
  links: { connections: string };
}

interface Answer {
  say: string;
  next: string;
}

// The module's own state: it starts over at a reload, and session.start reads it again.
let data: PanelData | null = null;
let busy: string | null = null;
let note: string | null = null;
let choosing = false;
let shown: Record<string, boolean> = Object.fromEntries(FIELDS.map((field) => [field.id, field.initial]));

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function asPanel(value: unknown): PanelData | null {
  if (!isObject(value) || !isObject(value.status) || !isObject(value.links)) return null;
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
  const result = await $.process.run(['node', `${$.plugin.root}/scripts/sw.mjs`, ...args], { env, cwd, timeoutMs });
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    return null;
  }
}

async function reload($: EngineInterface): Promise<void> {
  data = asPanel(await sw($, ['panel', await $.session.cwd()], SHORT_MS));
  $.ui.status(data ? `Stackwarden: ${statusText(data)}` : undefined);
  $.ui.invalidate('ui.render');
}

/** Runs a command, then its `wait` while it says to wait, a few times at most. */
async function untilDone($: EngineInterface, command: string, waiting: string): Promise<Answer> {
  let answer = asAnswer(await sw($, [command], LONG_MS));
  for (let tries = 0; answer.next === waiting && tries < 6; tries += 1) {
    answer = asAnswer(await sw($, [command, 'wait'], LONG_MS));
  }
  return answer;
}

async function act($: EngineInterface, action: Action): Promise<void> {
  if (busy) return;
  busy = BUSY[action];
  note = null;
  $.ui.invalidate('ui.render');
  try {
    const answer =
      action === 'refresh'
        ? asAnswer(await sw($, ['read', await $.session.cwd()], LONG_MS))
        : action === 'sign_in'
          ? await untilDone($, 'login', 'login_wait')
          : action === 'connect'
            ? await untilDone($, 'connect', 'connect_wait')
            : asAnswer(await sw($, ['install'], LONG_MS));
    note = answer.say;
  } catch {
    note = 'That did not finish. Try again.';
  } finally {
    busy = null;
    await reload($);
  }
}

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function statusText(panel: PanelData): string {
  const { status } = panel;
  return status.state === 'connected' && status.readAt
    ? `Vercel: connected, read ${ago(status.readAt)} through your CLI`
    : status.text;
}

function fieldLines(summary: Summary): { id: FieldId; text: string }[] {
  const days = (iso: string) => Math.ceil((Date.parse(iso) - Date.now()) / (24 * 60 * 60_000));
  const money = (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`;
  const { plan, cost, projects, tokens, deploys, visitors, domains } = summary;
  return [
    {
      id: 'plan',
      text: plan
        ? `Plan: ${plan.name}${plan.price ? `, ${plan.price.currency} ${plan.price.amount} a ${plan.price.interval}` : ''}`
        : 'Plan: not read',
    },
    {
      id: 'cost',
      text:
        cost === null
          ? 'Cost: not read'
          : cost.length === 0
            ? 'Cost this billing period: none'
            : `Cost this billing period: ${cost.map((item) => `${money(item.amount, item.currency)}${item.estimated ? ' (estimated)' : ''}`).join(', ')}`,
    },
    {
      id: 'projects',
      text: `Projects: ${projects.count}${projects.failing.length > 0 ? `; failing deploys: ${projects.failing.join(', ')}` : ''}`,
    },
    {
      id: 'tokens',
      text:
        tokens === null
          ? 'Tokens: not read'
          : `Tokens: ${tokens.count}${tokens.nextExpiry ? `; the next expires in ${days(tokens.nextExpiry.expiresAt)} days (${tokens.nextExpiry.name})` : '; none expires'}`,
    },
    { id: 'unused', text: tokens === null ? 'Unused tokens: not read' : `Tokens unused for 90 days: ${tokens.unused}` },
    {
      id: 'deploys',
      text:
        deploys === null
          ? 'Deployments: not read'
          : `Deployments this month: ${deploys.deployments}; build minutes: ${deploys.buildMinutes}`,
    },
    {
      id: 'visitors',
      text:
        visitors === null
          ? 'Visitors: Web Analytics is off for every project'
          : `Visitors this month: ${visitors.visitors}; page views: ${visitors.pageViews}`,
    },
    { id: 'domains', text: domains === null ? 'Domains: not read' : `Domains: ${domains}` },
  ];
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    // The person's choice of fields stays on this computer across sessions.
    const kept = await $.store.get(FIELDS_KEY);
    if (isObject(kept)) {
      const chosen: Record<string, boolean> = {};
      for (const [id, value] of Object.entries(kept)) if (typeof value === 'boolean') chosen[id] = value;
      shown = { ...shown, ...chosen };
    }
    await $.command.register({ name: COMMAND, description: 'Open the Stackwarden panel' });
    void $.ui.open({ id: PANE, title: 'Stackwarden' });
    void reload($);
    $.clock.every(REFRESH_MS, () => {
      if (!busy) void reload($);
    });
    return next(e);
  });

  on('command.run', { command: COMMAND }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Stackwarden' });
    return { text: 'Stackwarden panel opened.' };
  }).catch(($, e, next) => (next.called ? next(e) : { text: 'The Stackwarden panel could not open.' }));

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e);
    if (!data) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text>Stackwarden: reading what this computer knows…</Text>
        </Box>
      );
    }
    const panel = data;
    const summary = panel.vercel;
    const lines = summary ? fieldLines(summary).filter((line) => shown[line.id]) : [];
    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="column">
          <Text bold>{statusText(panel)}</Text>
          {panel.organization ? <Text dimColor>Organization: {panel.organization}</Text> : null}
        </Box>
        {busy ? (
          <Text>{busy}</Text>
        ) : (
          <Button
            label={ACTION_LABELS[panel.status.action]}
            variant="primary"
            onPress={() => act($, panel.status.action)}
          />
        )}
        {note ? <Text dimColor>{note}</Text> : null}
        {summary ? (
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold>Vercel, {summary.account.name}</Text>
            <Text>{summary.projects.failing.length > 0 ? 'Needs attention' : 'Active'}</Text>
            {lines.map((line) => (
              <Text key={line.id}>{line.text}</Text>
            ))}
            <Box flexDirection="row" gap={1}>
              {busy ? null : <Button label="Refresh" onPress={() => act($, 'refresh')} />}
              <Button
                label={choosing ? 'Done choosing' : 'Choose what you see'}
                onPress={() => {
                  choosing = !choosing;
                  $.ui.invalidate('ui.render');
                }}
              />
            </Box>
            {choosing
              ? FIELDS.map((field) => (
                  <Button
                    key={field.id}
                    label={`${field.label}: ${shown[field.id] ? 'shown' : 'hidden'}`}
                    onPress={async () => {
                      shown = { ...shown, [field.id]: !shown[field.id] };
                      await $.store.set(FIELDS_KEY, shown);
                      $.ui.invalidate('ui.render');
                    }}
                  />
                ))
              : null}
          </Box>
        ) : null}
        {panel.repo ? (
          <Box flexDirection="column">
            <Text bold>This repo: {panel.repo.project.name}</Text>
            <Link href={panel.repo.project.url} label={panel.repo.project.url} />
            {panel.repo.unread.length > 0 ? <Text dimColor>Not read yet: {panel.repo.unread.join(', ')}</Text> : null}
          </Box>
        ) : (
          <Text dimColor>This repo isn't in Stackwarden yet: say "I want to use Stackwarden".</Text>
        )}
        <Link href={panel.links.connections} label="Open in Stackwarden" />
      </Box>
    );
  });
};
