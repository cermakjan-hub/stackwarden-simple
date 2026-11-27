// @ts-check
// The commands the setup skill and the panel run. Each prints one JSON object: `say`, what Claude
// tells the person, and `next`, what it does next. It never prints a key or a value. Of what a CLI or
// Stackwarden answered, it prints only names, cut short and quoted (`plain`, `shown`), counts,
// Stackwarden's own links, and a sign-in's address and code.
//
//   scan [dir]               look through the repo here, and say what's next; sends nothing
//   status [dir] [--vercel]  what's next: set up or sign in the Vercel CLI, connect, choose a team, read
//   install | login [wait]   how to install the Vercel CLI; its own sign-in, in the browser
//   connect [wait [secs]]    connect this computer to Stackwarden, in the browser
//   team <id>                the Vercel team to read, when the CLI sees several
//   read [dir] [--keep]      read Vercel here; send it only once the person has said yes to a first
//                            send, and never with --keep. Before that yes, the recipe's `later`
//                            steps go on in the background (`read --later`), and `send` waits for them
//   send [dir]               on the person's yes: what `read` kept, and the repo's scan
//   pair listen --nonce <n>  the connection listener `connect` starts in the background
//   link <id>|none [dir]     the person's pick of the repo's Vercel project
//   keys suggest [dir] | keys <project> [<token>…]   a project's tokens (ADR 0077)
//   view | inbox <id> approve|reject | panel [dir]   for the panel (ADR 0078)
//   hook                     at session start: read and send again once the last is 15 minutes old
//   autoupdate [on] | update the plugin's own updates (ADR 0079)

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findOnPath, run } from './cli.mjs';
import { connect, listen, openBrowser, waitForApproval } from './connect.mjs';
import { detect } from './detect.mjs';
import * as local from './local.mjs';
import { filedRepo, panelStatus, repoAt, repoKey, suggestedTokens, teamView } from './panel-data.mjs';
import {
  accounts,
  addLater,
  Failure,
  findCli,
  LATER,
  markLater,
  readAccount,
  recipe,
  signedIn,
  signIn,
  withLater,
} from './read.mjs';
import * as stackwarden from './stackwarden.mjs';

const SELF = fileURLToPath(import.meta.url);
const VERCEL = recipe('vercel');
const FRESH_MS = 15 * 60_000;
const print = (/** @type {unknown} */ value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const answer = (/** @type {string} */ say, /** @type {string} */ next, data = {}) => print({ say, next, ...data });
const list = (/** @type {string[]} */ names) =>
  names.length > 5 ? `${names.slice(0, 5).join(', ')} and ${String(names.length - 5)} more` : names.join(', ');
/**
 * A name from Vercel or Stackwarden, which anyone in a team can choose: at most 48 letters, digits,
 * spaces and plain punctuation. `shown` puts it in quotes for `say`, so it never reads as the
 * plugin's own words.
 */
const plain = (/** @type {unknown} */ name) => {
  const text = String(name ?? '')
    .replace(/[^\p{L}\p{N} ._&'()+@/-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 48 ? `${text.slice(0, 47)}…` : text || '?';
};
const shown = (/** @type {unknown} */ name) => `“${plain(name)}”`;
const named = (/** @type {{ name?: unknown } | null | undefined} */ organization) =>
  organization?.name ? shown(organization.name) : 'Stackwarden';
/** @param {{ id: string, name: string }[]} seen */
const plainTeams = (seen) => seen.map((each) => ({ id: each.id, name: plain(each.name) }));
const OFFLINE = { say: "This computer isn't connected to Stackwarden yet.", next: 'connect' };

const argv = process.argv.slice(2);
const at = argv.indexOf('--data');
const folder = local.dataFolder(at === -1 ? process.env.CLAUDE_PLUGIN_DATA : argv[at + 1]);
const args = at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)];
const [command, ...rest] = args;
const flag = (/** @type {string} */ name) => rest.includes(name);
const valueOf = (/** @type {string} */ name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
// The repo folder: the first plain argument, or the second after `link <id>` and `keys suggest`.
const positional = rest.filter((part, index) => !part.startsWith('--') && !rest[index - 1]?.startsWith('--'));
const dir = resolve(
  (command === 'link' || command === 'keys'
    ? positional[1]
    : ['scan', 'status', 'read', 'send', 'panel'].includes(String(command))
      ? positional[0]
      : undefined) ?? '.',
);

/** @param {string} data */
async function main(data) {
  let config = local.config(data);
  let base = stackwarden.stackwardenUrl(config);
  let organization = config?.organizations[0] ?? null;
  const place = repoAt(dir);
  const key = repoKey(place);

  /** How far the Vercel CLI here is, without setting anything up. */
  const vercelHere = async () => {
    const cli = await findCli(VERCEL, data);
    if ('problem' in cli)
      return { cli: null, state: 'not_set_up', problem: cli.problem, onPath: cli.onPath, seen: null };
    try {
      return { cli, state: 'signed_in', seen: await accounts(cli) };
    } catch (error) {
      return { cli, state: error instanceof Failure && error.status === 401 ? 'signed_out' : 'unchecked', seen: null };
    }
  };

  /** The next step, in the order the person meets them. */
  const next = async (/** @type {Awaited<ReturnType<typeof vercelHere>> | null} */ here) => {
    const usesVercel = flag('--vercel') || (local.panelFile(data).scanned[key]?.usesVercel ?? true);
    if (usesVercel) {
      here ??= await vercelHere();
      if (here.state === 'not_set_up') return { say: here.problem ?? '', next: 'install_cli', install: VERCEL.install };
      if (here.state === 'signed_out') return { say: 'Your Vercel CLI here is signed out.', next: 'login' };
    }
    if (!organization) return OFFLINE;
    if (!usesVercel) return { say: `Connected to ${named(organization)}.`, next: 'confirm_send' };
    const chosen = Object.keys(config?.accounts.vercel ?? {});
    const seen = here?.seen ?? [];
    if (chosen.length === 0 && seen.length > 1) {
      return { say: 'Your Vercel CLI sees several teams.', next: 'team', teams: plainTeams(seen) };
    }
    return { say: `Connected to ${named(organization)}, with your Vercel CLI signed in.`, next: 'read' };
  };

  /** Reads Vercel here; sends only when `send` is set, as the session-start reading does. */
  const readVercel = async (/** @type {boolean} */ send) => {
    const cli = await findCli(VERCEL, data);
    if ('problem' in cli) return { say: cli.problem, next: 'install_cli', install: VERCEL.install };
    if (!organization) return OFFLINE;
    // With a team chosen, the reading's own answers name it; the CLI is asked for its teams first only
    // when there is a choice to make.
    const chosen = Object.keys(config?.accounts.vercel ?? {})[0];
    /** @type {{ id: string, name: string }[]} */
    let seen = [];
    let reading;
    try {
      if (!chosen) seen = await accounts(cli);
      const account = chosen ?? (seen.length === 1 ? seen[0]?.id : undefined);
      if (!account) return { say: 'Your Vercel CLI sees several teams.', next: 'team', teams: plainTeams(seen) };
      // Before the yes, the steps read later go on in the background, so the question comes sooner.
      reading = await readAccount(cli, account, new Date(), send ? undefined : 'first');
      if (chosen) seen = await accounts(cli, reading.answers);
    } catch (error) {
      if (error instanceof Failure && error.status === 401) return signedOut();
      throw error;
    }
    const account = reading.account;
    local.writeJson(join(data, 'reading.json'), reading);
    if (!send) {
      // Marked first, so the run finds its reading waiting; then with the run's process ID.
      markLater(data, reading.readAt, null);
      const later = spawn(process.execPath, [SELF, 'read', '--later', '--data', data], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd: data,
      });
      markLater(data, reading.readAt, later.pid ?? null);
      later.unref();
    }
    const name = shown(seen.find((each) => each.id === account)?.name ?? account);
    const projects = reading.answers
      .filter((each) => each.args[1]?.startsWith('/v10/projects'))
      .flatMap((each) => /** @type {any} */ (each.body)?.projects ?? []).length;
    const tokens = reading.answers
      .filter((each) => each.args[0] === 'tokens')
      .flatMap((each) => /** @type {any} */ (each.body)?.tokens ?? []).length;
    const read = `I read your Vercel team ${name} through your Vercel CLI: ${String(projects)} projects, their deploys, domains and costs, and the names of ${String(tokens)} tokens.`;
    if (!send) {
      return {
        say: `${read} Nothing has been sent yet.`,
        next: 'confirm_send',
        confirm: `Send Stackwarden what I read of the Vercel team ${name}: all ${String(projects)} of its projects, not only this repo's, with their deploys, domains, visitors, usage and costs, and its tokens' names, scopes and dates?`,
      };
    }
    return { say: `${read} ${await sendReading(name)}`, next: 'done' };
  };

  const signedOut = () => {
    round({ outcome: 'failed', signedOut: true, message: 'Your Vercel CLI is signed out.' });
    return { say: 'Your Vercel CLI here is signed out.', next: 'login' };
  };

  /** @param {{ outcome: string, signedOut: boolean, message: string }} last */
  const round = (last) =>
    local.updatePanelFile(data, (file) => ({
      ...file,
      rounds: { ...file.rounds, vercel: { ...last, at: new Date().toISOString() } },
    }));

  /**
   * Sends the reading `read` kept, and keeps what Stackwarden answered for the panel. Without the
   * team's name, as from `send`, it names the team Stackwarden's answer names.
   * @param {string} [team]
   */
  const sendReading = async (team) => {
    const reading = local.readJson(join(data, 'reading.json'));
    if (!reading || !organization) return '';
    const stored = await stackwarden.sendReading(base, organization.key, reading);
    local.rmQuietly(join(data, 'reading.json'));
    local.rmQuietly(join(data, LATER));
    const now = new Date().toISOString();
    local.updatePanelFile(data, (file) => ({
      ...file,
      summaries: stored?.summary ? { ...file.summaries, vercel: stored.summary } : file.summaries,
      answers: { ...file.answers, vercel: { account: reading.account, at: now, resources: stored?.resources ?? [] } },
    }));
    round({ outcome: 'sent', signedOut: false, message: 'Read and sent.' });
    const state = local.state(data);
    local.saveState(data, { providers: { ...state.providers, vercel: { sentAt: now, triedAt: now, problem: null } } });
    await keepView();
    const answered = stored?.summary?.account?.name;
    return `I sent Stackwarden what I read of ${team ?? (answered ? shown(answered) : 'your Vercel team')}.`;
  };

  const keepView = async () => {
    if (!organization) return;
    try {
      const view = await stackwarden.getView(base, organization.key);
      local.updatePanelFile(data, (file) => ({ ...file, view }));
    } catch {
      // The panel shows what it had.
    }
  };

  switch (command) {
    case 'scan': {
      const report = detect(place.root);
      const here = await vercelHere();
      const found = report.findings.some((finding) => finding.service === 'vercel');
      const usesVercel = found || here.state !== 'not_set_up' || Boolean(here.onPath);
      const cards = report.findings.filter((finding) => finding.service !== 'vercel').map((finding) => finding.name);
      const vercelLine = !usesVercel
        ? "Vercel isn't in this repo and there's no Vercel CLI here, so nothing connects yet. If this app runs on Vercel, say so."
        : here.state === 'signed_in'
          ? `Connects from this computer: Vercel, through your Vercel CLI, signed in to ${list((here.seen ?? []).map((each) => shown(each.name)))}.`
          : here.state === 'signed_out'
            ? 'Connects from this computer: Vercel, through your Vercel CLI, once you sign it in to Vercel in your browser.'
            : here.state === 'not_set_up'
              ? `Connects from this computer: Vercel, through the Vercel CLI, once it's installed: ${VERCEL.install}`
              : 'Connects from this computer: Vercel, through your Vercel CLI.';
      local.updatePanelFile(data, (file) => ({
        ...file,
        scanned: { ...file.scanned, [key]: { usesVercel, at: new Date().toISOString(), vercelTokens: [] } },
      }));
      const step = await next(here);
      print({
        say: [
          'I looked through this repo here on your computer; nothing was sent.',
          vercelLine,
          cards.length > 0
            ? `Each gets its own card in Stackwarden, without a connection: ${list(cards)}.`
            : 'I found no other services in this repo.',
        ].join('\n'),
        next: step.next,
        ...('teams' in step ? { teams: step.teams } : {}),
        services: report.findings.map((finding) => ({ name: finding.name, kind: finding.kind })),
        confirm:
          "Send Stackwarden this repo's scan: its name, Git address and commit, the services above with the file and line that show each, and the names of their settings with where the code uses them?",
      });
      return;
    }
    case 'status': {
      if (flag('--vercel')) {
        local.updatePanelFile(data, (file) =>
          file.scanned[key]
            ? { ...file, scanned: { ...file.scanned, [key]: { ...file.scanned[key], usesVercel: true } } }
            : file,
        );
      }
      const step = await next(null);
      print(step);
      return;
    }
    case 'install': {
      const cli = await findCli(VERCEL, data);
      if ('problem' in cli)
        answer(`${cli.problem} Tell me once it's installed, or say yes and I'll run that for you.`, 'install_cli', {
          install: VERCEL.install,
        });
      else answer(`Your Vercel CLI ${cli.version} is ready.`, 'status');
      return;
    }
    case 'login': {
      const cli = await findCli(VERCEL, data);
      if ('problem' in cli) return answer(cli.problem, 'install_cli', { install: VERCEL.install });
      if (rest[0] === 'wait') {
        const seen = await signedIn(cli);
        if (seen)
          return answer(`Your Vercel CLI is signed in (${list(seen.map((each) => shown(each.name)))}).`, 'status');
        return seen === null
          ? answer('The sign-in ended without signing in. It can be started again.', 'login')
          : answer('Not signed in yet.', 'login_wait');
      }
      const started = await signIn(cli);
      answer(
        started.url
          ? `Your browser opens at Vercel: approve the Vercel CLI's sign-in there${started.code ? `, checking the code is ${started.code}` : ''}. If it doesn't open: ${started.url}`
          : "Your browser opens at Vercel: approve the Vercel CLI's sign-in there.",
        'login_wait',
        { url: started.url, code: started.code },
      );
      return;
    }
    case 'connect': {
      if (rest[0] === 'wait') {
        const seconds = Math.min(Number(rest[1] ?? '90') || 90, 540);
        const result = await waitForApproval(data, base, seconds);
        if (result === 'waiting')
          return answer('Not approved yet: click Connect this computer in the browser.', 'connect_wait');
        if (result !== 'approved') return answer("Connecting didn't go through. It can be started again.", 'connect');
        // Connected: go straight on to reading Vercel here, so the person's one question comes next.
        config = local.config(data);
        organization = config?.organizations[0] ?? null;
        base = stackwarden.stackwardenUrl(config);
        const after = `This computer is connected to ${named(organization)}.`;
        const step = await next(null);
        const then = step.next === 'read' ? await readVercel(false) : step;
        return print({ ...then, say: `${after} ${then.say}` });
      }
      const started = await connect(data, SELF, base);
      if ('error' in started) return answer(started.error, 'stop');
      openBrowser(started.url, base);
      answer(
        `Now connect this computer to Stackwarden, once. I opened its page in your browser: sign up or sign in with GitHub, then click Connect this computer. If it didn't open: ${started.url}`,
        'connect_wait',
        { url: started.url },
      );
      return;
    }
    case 'pair':
      if (rest[0] === 'listen') await listen(data, base, String(valueOf('--nonce')));
      return;
    case 'team': {
      const id = rest[0];
      if (!config || !organization || !id || !/^[A-Za-z0-9_-]{1,100}$/.test(id))
        return answer('Name a team by its ID, as status listed it.', 'team');
      local.saveConfig(data, { ...config, accounts: { ...config.accounts, vercel: { [id]: [organization.id] } } });
      return answer('I read that Vercel team from now on.', 'read');
    }
    case 'read': {
      // Read here and keep it until the person's yes in the chat. Once they have said yes to a first
      // send, the panel's "Read again" and the session-start reading send too; before that, only `send`
      // sends anything about Vercel, whoever runs `read`. `--keep` keeps it even then.
      if (flag('--later')) {
        const cli = await findCli(VERCEL, data);
        if (!('problem' in cli)) await addLater(cli, data);
        return;
      }
      const owner = valueOf('--stale');
      const agreed = Boolean(local.state(data).providers.vercel?.sentAt);
      try {
        const step = await readVercel(agreed && !flag('--keep'));
        if (owner === undefined) print(step);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Reading failed.';
        round({ outcome: 'failed', signedOut: false, message });
        if (owner === undefined) throw error;
        const state = local.state(data);
        local.saveState(data, {
          providers: {
            ...state.providers,
            vercel: {
              sentAt: state.providers.vercel?.sentAt ?? null,
              triedAt: new Date().toISOString(),
              problem: message,
            },
          },
        });
      } finally {
        if (owner !== undefined) local.releaseLock(data, owner);
      }
      return;
    }
    case 'send': {
      if (!config || !organization) return print(OFFLINE);
      if (existsSync(join(data, 'reading.json'))) {
        const cli = await findCli(VERCEL, data);
        // What the background run read since; without it, the reading goes as it is.
        if (!('problem' in cli)) await withLater(cli, data).catch(() => undefined);
      }
      const vercelSent = await sendReading();
      const report = detect(place.root);
      const filed = await stackwarden.sendScan(base, organization.key, {
        repo: report.repo,
        linkedIds: report.linkedIds,
        findings: report.findings,
        scannerVersion: report.scannerVersion,
      });
      const unread = report.findings.filter((finding) => finding.service !== 'vercel').map((finding) => finding.name);
      local.updatePanelFile(data, (file) => ({
        ...file,
        repos: {
          ...file.repos,
          [key]: {
            remote: report.repo.remote,
            project: { name: filed.project.name, url: filed.project.url },
            vercel: filed.vercel.map((/** @type {any} */ each) => each.externalId),
            unread,
          },
        },
      }));
      await keepView();
      const project = `${shown(filed.project.name)} is now a project in Stackwarden: ${filed.project.url}`;
      const matched =
        filed.vercel.length > 0
          ? ` I matched it to your Vercel project ${list(filed.vercel.map((/** @type {any} */ each) => shown(each.name)))} by its Git address.`
          : '';
      const sent = vercelSent ? ` ${vercelSent}` : '';
      const usesVercel = local.panelFile(data).scanned[key]?.usesVercel ?? false;
      if (
        usesVercel &&
        filed.vercel.length === 0 &&
        filed.pick.length > 0 &&
        report.repo.remote &&
        !local.noVercelFor(data, report.repo.remote)
      ) {
        return answer(`${project}.${sent} No Vercel project matched this repo by its Git address.`, 'pick', {
          pick: filed.pick.map((/** @type {any} */ each) => ({ externalId: each.externalId, name: plain(each.name) })),
          question: 'Which of these Vercel projects is this app?',
        });
      }
      return answer(`${project}.${matched}${sent}`, 'done');
    }
    case 'link': {
      const filed = filedRepo(local.panelFile(data), place);
      const choice = rest[0];
      if (!config || !organization || !filed?.remote || !choice)
        return answer('Send the repo to Stackwarden first.', 'send');
      if (choice === 'none') {
        local.rememberNoVercel(data, filed.remote);
        return answer('OK: this app has no Vercel project.', 'done');
      }
      const linked = await stackwarden.sendLink(base, organization.key, {
        remote: filed.remote,
        provider: 'vercel',
        externalId: choice,
      });
      local.updatePanelFile(data, (file) => ({
        ...file,
        repos: {
          ...file.repos,
          [key]: { ...filed, vercel: [...new Set([...filed.vercel, linked.linked.externalId])] },
        },
      }));
      await keepView();
      return answer(
        `I matched ${shown(linked.project.name)} to your Vercel project ${shown(linked.linked.name)}: ${linked.project.url}`,
        'done',
      );
    }
    case 'keys':
      return keys(data, config, base, place, keepView);
    case 'view':
      if (!organization) return print(OFFLINE);
      await keepView();
      return answer('The panel shows the latest from Stackwarden.', 'done');
    case 'inbox': {
      const [id, decision] = rest;
      if (!organization || !id || (decision !== 'approve' && decision !== 'reject'))
        return answer('Name a waiting service by its ID, and approve or reject.', 'stop');
      const waiting = local.panelFile(data).view?.suggestions?.find((/** @type {any} */ each) => each.id === id);
      const name = waiting ? shown(waiting.name) : 'The service';
      const decided = await stackwarden.sendInbox(base, organization.key, { id, decision });
      await keepView();
      if (!decided?.decided) return answer(`${name} was decided already.`, 'done');
      return answer(
        decision === 'reject'
          ? `${name} is dismissed.`
          : `${name} is in ${decided.project?.name ? shown(decided.project.name) : 'its project'} now.`,
        'done',
      );
    }
    case 'panel': {
      const file = local.panelFile(data);
      const summary = file.summaries.vercel ?? null;
      const hasCli = findOnPath('vercel') !== null;
      const filed = filedRepo(file, place);
      const from = local.marketplaceOf(SELF);
      print({
        status: panelStatus({
          connected: organization !== null,
          hasCli,
          last: file.rounds.vercel,
          summary,
          waiting: existsSync(join(data, 'reading.json')),
        }),
        organization: organization?.name ?? null,
        repo: {
          name: place.remote?.split('/').at(-1) ?? place.root.split(/[\\/]/).at(-1),
          remote: place.remote,
          filed: filed ? { project: filed.project, unread: filed.unread } : null,
        },
        team: summary ? teamView(summary, file.answers.vercel, filed, place.remote) : null,
        view: file.view,
        plugin: { autoUpdate: from ? local.autoUpdateState(from.marketplace) : null },
        links: {
          connections: new URL('/settings/connections', base).toString(),
          tokens: 'https://vercel.com/account/tokens',
        },
        start: '/stackwarden-simple:start',
      });
      return;
    }
    case 'hook':
      return hook(data, config);
    case 'autoupdate': {
      const from = local.marketplaceOf(SELF);
      if (!from)
        return answer(
          "This Stackwarden wasn't installed from a marketplace, so it has no auto-update to turn on.",
          'done',
        );
      if (rest[0] === 'on') {
        const result = local.turnOnAutoUpdate(from.marketplace);
        if (result === 'on')
          return answer(
            'Auto-update is on: new versions of Stackwarden arrive by themselves, from the next start of Claude Code.',
            'done',
          );
        return answer(`Turn on auto-update in /plugin: Marketplaces, ${from.marketplace}.`, 'stop');
      }
      return local.autoUpdateState(from.marketplace)
        ? answer('Auto-update is on: new versions of Stackwarden arrive by themselves.', 'done')
        : answer('New versions of Stackwarden arrive by themselves only with auto-update on.', 'offer_auto_update');
    }
    case 'update': {
      const from = local.marketplaceOf(SELF);
      const claude = findOnPath('claude');
      const elsewhere = 'Update it in /plugin: Installed, Stackwarden.';
      if (!from || !claude) return answer(elsewhere, 'stop');
      const result = await run(claude, ['plugin', 'update', from.plugin], { cwd: data, clear: [], set: {} });
      return result.exitCode === 0
        ? answer('Stackwarden is updated. Run /reload-plugins to use the new version now.', 'reload')
        : answer(`The update didn't finish. ${elsewhere}`, 'stop');
    }
    default:
      print({
        error:
          'Commands: scan, status, install, login [wait], connect [wait], team <id>, read, send, link <id>|none, keys, view, inbox, panel, hook, autoupdate [on], update',
      });
  }
}

/**
 * `keys suggest`: the team's tokens, with those whose name looks like the repo's. `keys <project>
 * [<token>…]`: exactly the tokens that Vercel project uses (ADR 0077).
 * @param {string} data @param {local.Config | null} config @param {string} base @param {{ root: string, remote: string | null }} place @param {() => Promise<void>} keepView
 */
async function keys(data, config, base, place, keepView) {
  const file = local.panelFile(data);
  const summary = file.summaries.vercel;
  const [first, ...chosen] = rest;
  if (first === 'suggest') {
    const team = summary ? teamView(summary, file.answers.vercel, filedRepo(file, place), place.remote) : null;
    const projects = team?.projects.filter((/** @type {any} */ project) => project.thisRepo) ?? [];
    if (!team?.tokens?.length || projects.length === 0)
      return answer('There are no Vercel tokens to choose for this app.', 'done');
    const assigned = new Set(projects.flatMap((/** @type {any} */ project) => project.keys));
    const names = [
      place.remote?.split('/').at(-1) ?? '',
      ...projects.map((/** @type {any} */ project) => project.name),
    ];
    const suggested =
      assigned.size > 0
        ? team.tokens.filter((/** @type {any} */ token) => assigned.has(token.id))
        : suggestedTokens(team.tokens, names);
    const entry = (/** @type {any} */ each) => ({ id: each.id, name: plain(each.name) });
    return answer('A Vercel token reaches the whole team, so only you know which ones this app uses.', 'confirm_keys', {
      projects: projects.map(entry),
      suggested: suggested.map(entry),
      tokens: team.tokens.map(entry),
      question:
        suggested.length > 0
          ? `Which of the team's tokens does this app use? These look like its own: ${list(suggested.map((/** @type {any} */ token) => shown(token.name)))}.`
          : "Which of the team's tokens does this app use, if any?",
    });
  }
  const organization = config?.organizations[0];
  const project = summary?.projects.find((/** @type {any} */ each) => each.id === first);
  if (!config || !organization || !summary || !project)
    return answer('Read Vercel first, then choose the tokens of one of its projects.', 'read');
  const names = new Map((summary.tokens ?? []).map((/** @type {any} */ token) => [token.id, token.name]));
  const set = await stackwarden.sendKeys(base, organization.key, {
    provider: 'vercel',
    account: summary.account.id,
    project: project.id,
    keys: chosen.filter((id) => names.has(id)),
  });
  local.updatePanelFile(data, (kept) => {
    const known = kept.answers.vercel;
    if (known?.account !== summary.account.id) return kept;
    const resources = known.resources.some((/** @type {any} */ each) => each.externalId === set.resource.externalId)
      ? known.resources.map((/** @type {any} */ each) =>
          each.externalId === set.resource.externalId ? set.resource : each,
        )
      : [...known.resources, set.resource];
    return { ...kept, answers: { ...kept.answers, vercel: { ...known, resources } } };
  });
  await keepView();
  const used = set.resource.keys.map((/** @type {string} */ id) => shown(names.get(id) ?? id));
  return answer(
    used.length > 0
      ? `${shown(project.name)} uses ${list(used)}.`
      : `${shown(project.name)} uses none of the team's tokens.`,
    'done',
    { keys: set.resource.keys },
  );
}

/**
 * At session start: say a problem from the last background reading once, then read and send again in
 * the background, without the model, when the last reading is 15 minutes old.
 * @param {string} data @param {local.Config | null} config
 */
function hook(data, config) {
  if (!config?.organizations[0]) return;
  const state = local.state(data);
  const problems = Object.values(state.providers).flatMap((each) => (each.problem ? [each.problem] : []));
  if (problems.length > 0) {
    print({ systemMessage: `Stackwarden: ${problems.join(' ')}` });
    local.saveState(data, {
      providers: Object.fromEntries(
        Object.entries(state.providers).map(([id, each]) => [id, { ...each, problem: null }]),
      ),
    });
  }
  // Only once the person said yes to the first send, in the setup: before that, nothing leaves by itself.
  const last = state.providers.vercel;
  const due = (/** @type {string | null | undefined} */ at) => !at || Date.now() - Date.parse(at) >= FRESH_MS;
  if (!last?.sentAt || !due(last.sentAt) || !due(last.triedAt)) return;
  const owner = `${String(process.pid)}-${String(Date.now())}`;
  if (!local.takeLock(data, owner)) return;
  local.saveState(data, {
    providers: {
      ...local.state(data).providers,
      vercel: { sentAt: last?.sentAt ?? null, triedAt: new Date().toISOString(), problem: null },
    },
  });
  spawn(process.execPath, [SELF, 'read', '--stale', owner, '--data', data], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: data,
  }).unref();
}

if (!folder) {
  if (command !== 'hook') print({ error: "Run from the Stackwarden plugin, with the plugin's own data folder." });
} else {
  main(folder).catch((/** @type {unknown} */ error) => {
    if (command !== 'hook' && !flag('--stale'))
      print({ say: error instanceof Error ? error.message : 'Stackwarden stopped.', next: 'stop' });
    process.exitCode = 1;
  });
}
