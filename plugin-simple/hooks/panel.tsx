import type { EngineInterface, Register, RenderChildren } from 'claude-code';

// The Stackwarden panel beside the chat (ADR 0076, ADR 0077): the repo the session is in, and its
// Vercel card as the dashboard draws one, with a General section for the team and a Project section
// for the repo's Vercel project. The team's other projects are a click away, and back. It only shows
// what `sw.mjs panel` reads on this computer, and acts only through `sw.mjs`: the path works the same
// without it, in words in the chat.

const PANE = 'stackwarden';
const COMMAND = 'stackwarden';
const REFRESH_MS = 10 * 60_000;
const FIELDS_KEY = 'fields';
const LONG_MS = 10 * 60_000;
const SHORT_MS = 30_000;
const DAY_MS = 24 * 60 * 60_000;
const SHOWN_UNREAD = 30;

type FieldId =
  | 'plan'
  | 'cost'
  | 'projects'
  | 'unassigned'
  | 'status'
  | 'keys'
  | 'production'
  | 'activity'
  | 'visitors'
  | 'framework';

const FIELDS: readonly { id: FieldId; section: 'General' | 'Project'; label: string; initial: boolean }[] = [
  { id: 'plan', section: 'General', label: 'Plan', initial: true },
  { id: 'cost', section: 'General', label: 'Cost', initial: true },
  { id: 'projects', section: 'General', label: 'Projects', initial: true },
  { id: 'unassigned', section: 'General', label: 'Tokens in no project', initial: true },
  { id: 'status', section: 'Project', label: 'Status', initial: true },
  { id: 'keys', section: 'Project', label: 'Keys', initial: true },
  { id: 'production', section: 'Project', label: 'Production', initial: true },
  { id: 'activity', section: 'Project', label: 'Last 30 days', initial: true },
  { id: 'visitors', section: 'Project', label: 'Visitors, 30 days', initial: false },
  { id: 'framework', section: 'Project', label: 'Framework and branch', initial: false },
];

type Action = 'refresh' | 'sign_in' | 'connect' | 'set_up';

const ACTION_LABELS: Record<Action, string> = {
  refresh: 'Read again',
  sign_in: 'Sign in to Vercel',
  connect: 'Connect this computer',
  set_up: 'Set up the Vercel CLI',
};

const BUSY: Record<Action | 'keys', string> = {
  refresh: 'Reading Vercel…',
  sign_in: 'Approve the sign-in in your browser, at Vercel…',
  connect: 'Approve this computer in your browser, at Stackwarden…',
  set_up: 'Setting up the Vercel CLI, about two minutes…',
  keys: 'Saving the keys…',
};

// What `sw.mjs panel` prints: see packages/reader/src/panel-view.ts.
interface Money {
  amount: number;
  currency: string;
}
interface Token {
  id: string;
  name: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}
type DeployState = 'ready' | 'failed' | 'building' | 'canceled' | 'paused' | 'none' | 'unknown';
interface TeamProject {
  id: string;
  name: string;
  url: string | null;
  domains: number | null;
  repo: string | null;
  framework: string | null;
  branch: string | null;
  deploy: { state: DeployState; at: string | null };
  activity: {
    deployments: number;
    buildMinutes: number;
    cost: Money[] | null;
    visitors: { visitors: number; pageViews: number } | null;
  } | null;
  stackwarden: { name: string; url: string } | null;
  keys: string[];
  thisRepo: boolean;
}
interface Team {
  account: { id: string; name: string };
  readAt: string;
  plan: { name: string; price: { amount: string; currency: string; interval: string } | null } | null;
  cost: { since: string; period: boolean; totals: (Money & { estimated: boolean })[] } | null;
  tokens: Token[] | null;
  unassigned: Token[];
  projects: TeamProject[];
}
interface PanelData {
  status: { state: string; action: Action; text: string; readAt: string | null };
  organization: string | null;
  repo: {
    name: string;
    remote: string | null;
    filed: { project: { name: string; url: string }; unread: string[] } | null;
  };
  team: Team | null;
  links: { connections: string; tokens: string };
}

interface Answer {
  say: string;
  next: string;
}

type View = { kind: 'repo' } | { kind: 'team' } | { kind: 'project'; id: string };

// The module's own state: it starts over at a reload, and session.start reads it again.
let data: PanelData | null = null;
let busy: string | null = null;
let note: string | null = null;
let view: View = { kind: 'repo' };
let choosingFields = false;
let showUnread = false;
/** The project whose keys are being chosen, and the choice so far. */
let choosingKeys: { project: string; keys: Set<string> } | null = null;
let shown: Record<string, boolean> = Object.fromEntries(FIELDS.map((field) => [field.id, field.initial]));

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function asPanel(value: unknown): PanelData | null {
  if (!isObject(value) || !isObject(value.status) || !isObject(value.links) || !isObject(value.repo)) return null;
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
  $.ui.status(data ? statusLine(data) : undefined);
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

async function act($: EngineInterface, action: Action | 'keys', args: string[] = []): Promise<void> {
  if (busy) return;
  busy = BUSY[action];
  note = null;
  $.ui.invalidate('ui.render');
  try {
    const answer =
      action === 'refresh'
        ? asAnswer(await sw($, ['read', await $.session.cwd()], LONG_MS))
        : action === 'keys'
          ? asAnswer(await sw($, ['keys', ...args], SHORT_MS))
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

function redraw($: EngineInterface, change: () => void): void {
  change();
  $.ui.invalidate('ui.render');
}

// Words and numbers, as the dashboard says them.

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

function money(amounts: readonly Money[]): string {
  return amounts.map((item) => `${item.currency} ${item.amount.toFixed(2)}`).join(', ');
}

function day(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function host(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const DEPLOY_WORDS: Record<DeployState, { mark: string; word: string; color?: 'success' | 'error' | 'warning' }> = {
  ready: { mark: '✓', word: 'Ready', color: 'success' },
  failed: { mark: '✕', word: 'Failed', color: 'error' },
  building: { mark: '◌', word: 'Building', color: 'warning' },
  canceled: { mark: '–', word: 'Canceled' },
  paused: { mark: '‖', word: 'Paused', color: 'warning' },
  none: { mark: '–', word: 'No production deploy' },
  unknown: { mark: '?', word: 'Unknown' },
};

function statusLine(panel: PanelData): string {
  const { status } = panel;
  return status.state === 'connected' && status.readAt
    ? `Stackwarden: Vercel ✓ · read ${ago(status.readAt)}`
    : `Stackwarden: ${status.text}`;
}

// Vercel's mark in a dark square, so it reads on a light and a dark theme alike.
const VERCEL_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="#111"/><path d="M14 8l7 12H7z" fill="#fff"/></svg>';

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
          <Text dimColor>Stackwarden: reading what this computer knows…</Text>
        </Box>
      );
    }
    const panel = data;
    const { team, repo } = panel;
    // A drawing where the surface draws one, a triangle in a terminal and the editor.
    let vercelMark = <Text bold>▲</Text>;
    if (e.surface === 'desktop' || e.surface === 'mobile') {
      const { Svg } = $.ui.resolve(e);
      vercelMark = <Svg source={VERCEL_MARK} alt="Vercel" width={28} height={28} />;
    }

    /** One field: a dim label over its value. */
    const field = (id: FieldId, label: string, value: RenderChildren) =>
      shown[id] ? (
        <Box key={id} flexDirection="column">
          <Text size="footnote" dimColor>
            {label}
          </Text>
          {value}
        </Box>
      ) : null;

    const heading = (title: string, detail: string | null) => (
      <Box flexDirection="row" gap={1}>
        <Text size="caption" weight="semibold" dimColor>
          {title.toUpperCase()}
        </Text>
        {detail ? (
          <Text size="caption" dimColor>
            {detail}
          </Text>
        ) : null}
      </Box>
    );

    const keysValue = (project: TeamProject) => {
      const tokens = team?.tokens ?? [];
      if (choosingKeys?.project === project.id) {
        const draft = choosingKeys.keys;
        return (
          <Box flexDirection="column" gap="xs">
            <Text dimColor>The tokens {project.name} uses:</Text>
            {tokens.map((token) => (
              <Button
                key={`token-${token.id}`}
                plain
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
              <Button
                key="save-keys"
                label="Save"
                variant="primary"
                onPress={() => {
                  const chosen = [...draft];
                  choosingKeys = null;
                  void act($, 'keys', [project.id, ...chosen]);
                }}
              />
              <Button key="cancel-keys" label="Cancel" onPress={() => redraw($, () => (choosingKeys = null))} />
            </Box>
          </Box>
        );
      }
      const own = tokens.filter((token) => project.keys.includes(token.id));
      return (
        <Box flexDirection="column">
          {own.length === 0 ? (
            <Text dimColor>None chosen: a team token reaches every project.</Text>
          ) : (
            own.map((token) => (
              <Text key={token.id}>
                🔒 {token.name} <Text dimColor>· {expiry(token)}</Text>
              </Text>
            ))
          )}
          {busy || tokens.length === 0 ? null : (
            <Button
              plain
              key={`choose-keys-${project.id}`}
              label="Choose keys"
              onPress={() => redraw($, () => (choosingKeys = { project: project.id, keys: new Set(project.keys) }))}
            />
          )}
        </Box>
      );
    };

    const projectSection = (project: TeamProject, title: string) => {
      const deploy = DEPLOY_WORDS[project.deploy.state];
      const { activity } = project;
      return (
        <Box key={project.id} flexDirection="column" gap="sm">
          {heading(title, project.name)}
          {field(
            'status',
            'Status',
            <Text color={deploy.color}>
              {deploy.mark} {deploy.word}
              {project.deploy.at ? <Text dimColor> · deployed {ago(project.deploy.at)}</Text> : null}
            </Text>,
          )}
          {field('keys', 'Keys', keysValue(project))}
          {field(
            'production',
            'Production',
            project.url ? (
              <Box flexDirection="row" gap={1} flexWrap="wrap">
                <Link href={project.url} label={host(project.url)} />
                {project.domains && project.domains > 1 ? (
                  <Text dimColor>· {plural(project.domains - 1, 'more domain')}</Text>
                ) : null}
              </Box>
            ) : (
              <Text dimColor>No production URL</Text>
            ),
          )}
          {field(
            'activity',
            'Last 30 days',
            activity ? (
              <Text tabular>
                {plural(activity.deployments, 'deploy')} · {activity.buildMinutes} build min
                {activity.cost && activity.cost.length > 0 ? ` · ${money(activity.cost)} usage` : ''}
              </Text>
            ) : (
              <Text dimColor>Not read</Text>
            ),
          )}
          {field(
            'visitors',
            'Visitors, 30 days',
            activity?.visitors ? (
              <Text tabular>
                {activity.visitors.visitors} visitors · {activity.visitors.pageViews} page views
              </Text>
            ) : (
              <Text dimColor>Web Analytics is off</Text>
            ),
          )}
          {field(
            'framework',
            'Framework and branch',
            <Text>
              {project.framework ?? 'No framework set'}
              {project.branch ? <Text dimColor> · {project.branch}</Text> : null}
            </Text>,
          )}
          {project.thisRepo ? null : project.stackwarden ? (
            <Link href={project.stackwarden.url} label={`In Stackwarden as ${project.stackwarden.name} ↗`} />
          ) : (
            <Text dimColor>Not in Stackwarden</Text>
          )}
        </Box>
      );
    };

    const generalSection = (current: Team) => (
      <Box flexDirection="column" gap="sm">
        {heading('General', current.account.name)}
        {field(
          'plan',
          'Plan',
          current.plan ? (
            <Text>
              {current.plan.name}
              {current.plan.price ? (
                <Text dimColor>
                  {' '}
                  · {current.plan.price.currency} {current.plan.price.amount} a {current.plan.price.interval}
                </Text>
              ) : null}
            </Text>
          ) : (
            <Text dimColor>Not read</Text>
          ),
        )}
        {field(
          'cost',
          current.cost?.period ? 'Cost this billing period' : 'Cost this month',
          current.cost ? (
            <Text tabular>
              {current.cost.totals.length > 0 ? money(current.cost.totals) : 'None yet'}
              <Text dimColor>
                {' '}
                · since {day(current.cost.since)}
                {current.cost.totals.some((total) => total.estimated) ? ', estimated' : ''}
              </Text>
            </Text>
          ) : (
            <Text dimColor>Not read</Text>
          ),
        )}
        {field(
          'projects',
          'Projects',
          <Button
            plain
            key="team"
            label={`${plural(current.projects.length, 'project')} in the team ›`}
            onPress={() => redraw($, () => (view = { kind: 'team' }))}
          />,
        )}
        {field(
          'unassigned',
          'Tokens in no project',
          current.tokens === null ? (
            <Text dimColor>Not read</Text>
          ) : current.unassigned.length === 0 ? (
            <Text dimColor>None</Text>
          ) : (
            <Text>{current.unassigned.map((token) => token.name).join(', ')}</Text>
          ),
        )}
      </Box>
    );

    const fieldPicker = choosingFields ? (
      <Box flexDirection="column" gap="xs">
        {FIELDS.map((each) => (
          <Button
            key={`field-${each.id}`}
            plain
            label={`${shown[each.id] ? '☑' : '☐'} ${each.section}: ${each.label}`}
            onPress={async () => {
              shown = { ...shown, [each.id]: !shown[each.id] };
              await $.store.set(FIELDS_KEY, shown);
              $.ui.invalidate('ui.render');
            }}
          />
        ))}
      </Box>
    ) : null;

    /** The card: Vercel's mark and title, its sections, and the footer with when it was read. */
    const card = (title: string, sections: RenderChildren) => (
      <Box flexDirection="column" gap={1} borderStyle="round" paddingX={1} paddingY="xs">
        <Box flexDirection="row" gap={1} alignItems="center" justifyContent="space-between">
          <Box flexDirection="row" gap={1} alignItems="center">
            {vercelMark}
            <Box flexDirection="column">
              <Text size="footnote" dimColor>
                Hosting
              </Text>
              <Text bold>{title}</Text>
            </Box>
          </Box>
          <Button
            plain
            key="fields"
            label={choosingFields ? 'Done' : 'Fields'}
            onPress={() => redraw($, () => (choosingFields = !choosingFields))}
          />
        </Box>
        {fieldPicker}
        {sections}
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text size="footnote" dimColor>
            {team ? `Read through your CLI · ${ago(team.readAt)}` : 'Not read yet'}
          </Text>
          {busy ? null : <Button key="refresh" label="Refresh" onPress={() => act($, 'refresh')} />}
        </Box>
      </Box>
    );

    const back = (
      <Button key="back" plain label="‹ Back to this repo" onPress={() => redraw($, () => (view = { kind: 'repo' }))} />
    );

    const status =
      panel.status.state === 'connected' ? null : (
        <Box flexDirection="column" gap="xs">
          <Text color="warning">{panel.status.text}</Text>
          {busy ? null : (
            <Button
              key="action"
              label={ACTION_LABELS[panel.status.action]}
              variant="primary"
              onPress={() => act($, panel.status.action)}
            />
          )}
        </Box>
      );

    const notes =
      busy || note ? (
        <Box flexDirection="column">
          {busy ? <Text dimColor>{busy}</Text> : null}
          {note ? <Text dimColor>{note}</Text> : null}
        </Box>
      ) : null;

    // Another project of the team, opened from the team view.
    if (view.kind === 'project' && team) {
      const id = view.id;
      const project = team.projects.find((each) => each.id === id);
      if (project) {
        return (
          <Box flexDirection="column" gap={1} paddingX={1}>
            <Box flexDirection="row" gap={2}>
              {back}
              <Button
                key="all-projects"
                plain
                label="All projects"
                onPress={() => redraw($, () => (view = { kind: 'team' }))}
              />
            </Box>
            {notes}
            {card(`Vercel · ${project.name}`, projectSection(project, 'Project'))}
          </Box>
        );
      }
    }

    // Every project of the team.
    if (view.kind !== 'repo' && team) {
      return (
        <Box flexDirection="column" gap={1} paddingX={1}>
          {back}
          <Box flexDirection="column">
            <Text bold size="heading">
              {team.account.name}
            </Text>
            <Text dimColor>{plural(team.projects.length, 'Vercel project')}</Text>
          </Box>
          <Box flexDirection="column" gap="sm">
            {team.projects.map((project) => {
              const deploy = DEPLOY_WORDS[project.deploy.state];
              const where = project.thisRepo
                ? 'this repo'
                : project.stackwarden
                  ? `in ${project.stackwarden.name}`
                  : 'not in Stackwarden';
              return (
                <Button
                  key={`project-${project.id}`}
                  plain
                  label={`${deploy.mark} ${project.name} · ${where} · ${plural(project.keys.length, 'key')} ›`}
                  onPress={() => redraw($, () => (view = { kind: 'project', id: project.id }))}
                />
              );
            })}
          </Box>
        </Box>
      );
    }

    // This repo: its name, its project, and its Vercel card.
    const mine = team?.projects.filter((project) => project.thisRepo) ?? [];
    const unread = repo.filed?.unread ?? [];
    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text bold size="heading">
              {repo.name}
            </Text>
            {panel.organization ? <Text dimColor>· {panel.organization}</Text> : null}
          </Box>
          {repo.filed ? (
            <Link href={repo.filed.project.url} label={`Open ${repo.filed.project.name} in Stackwarden ↗`} />
          ) : (
            <Text dimColor>This repo isn't in Stackwarden yet: say "I want to use Stackwarden".</Text>
          )}
        </Box>
        {status}
        {notes}
        {team
          ? card(
              'Vercel',
              <Box flexDirection="column" gap={1}>
                {generalSection(team)}
                {mine.length > 0 ? (
                  mine.map((project) => projectSection(project, 'Project'))
                ) : (
                  <Box flexDirection="column">
                    {heading('Project', null)}
                    <Text dimColor>
                      {repo.filed
                        ? 'No Vercel project of this team is in this repo yet: say "add my Vercel project".'
                        : 'File this repo first to see its Vercel project here.'}
                    </Text>
                  </Box>
                )}
              </Box>,
            )
          : null}
        {unread.length > 0 ? (
          <Box flexDirection="column">
            <Button
              plain
              key="unread"
              label={`${showUnread ? '▾' : '▸'} ${plural(unread.length, 'more service')} in this repo, not read yet`}
              onPress={() => redraw($, () => (showUnread = !showUnread))}
            />
            {showUnread ? <Text dimColor>{unread.slice(0, SHOWN_UNREAD).join(', ')}</Text> : null}
          </Box>
        ) : null}
      </Box>
    );
  });
};
