# Stackwarden (simple)

The Stackwarden plugin for Claude Code: it keeps track of what each of your apps runs on, from your own Claude Code session (ADR 0076 and 0081 in the Stackwarden repo).

Say "I want to use Stackwarden" in a repo. Your Claude Code session then, on your computer:

1. looks through the repo for the services it uses, and sends nothing;
2. connects this computer to your Stackwarden organization: you approve it once in your browser, signing up with GitHub if you're new;
3. reads your Vercel team through the Vercel CLI you're signed in to, and keeps it here;
4. asks you once, then sends Stackwarden the reading and the repo's scan, and files the repo as a project, matched to its Vercel project.

From then on it reads Vercel again when a session starts, at most every 15 minutes, in the background and without using the chat.

A panel beside the chat shows your Stackwarden organization, as the dashboard does: Home with every project and service and a search, each project with its tasks and service cards, each service's detail, the tokens a project uses, and services waiting for your OK. `/stackwarden` opens it.

## What it does on your computer

This section is for you and for your Claude Code session, which can check every line against the code. The plugin is plain, readable source with no build step, no bundled packages and nothing minified: what you read in `scripts/`, `hooks/panel.tsx` and the skill is what runs, about 190 KB, roughly 50k tokens.

Everything runs in your own Claude Code session, on your computer. The plugin reads your repo, and your Vercel account through the Vercel CLI you installed and signed in to yourself. Nothing about your repo or your Vercel account goes to Stackwarden before you say yes in the chat. Connecting this computer, which comes first, sends its name.

### What it runs

- **Node.js scripts in `scripts/`**, started by the setup skill, by the panel, and by one hook at session start (`hooks/hooks.json`).
- **Your Vercel CLI**, found on your PATH (`scripts/cli.mjs`), with only the read commands its recipe lists (`scripts/connectors/vercel.json`): `vercel api` GETs of teams, your user, projects, deployments, domains, Web Analytics visits and billing charges; `vercel usage --json`; `vercel tokens list --json`. Every run gets `--non-interactive`, and a list of several pages gets `--paginate`, so the CLI fetches them all in one run. The Vercel CLI's own variables (`VERCEL_*`) are cleared, so no stray token reaches it. `scripts/read.mjs` refuses any flag that sends data, sets a method or header, or asks for a decrypted value. A reading runs at most four at once, across every CLI it reads (`scripts/cli.mjs`, `run`); a reading of a team with a few projects takes about 10 seconds.
- **`vercel login`**, only when you press "Sign in to Vercel" or ask Claude to sign in: Vercel's own sign-in, approved by you in your browser (`scripts/read.mjs`, `signIn`).
- **Your browser**, opened at Stackwarden's page to connect this computer, and only at the Stackwarden address this computer connects to (`scripts/sw.mjs`, `openBrowser`). "Switch account" in the panel connects it again: the new connection replaces this computer's key, the old one is revoked, and another organization gets nothing before your yes in the chat (`scripts/connect.mjs`, `keep`).
- **`claude plugin update`**, only when you press "Update now" in the panel (`scripts/sw.mjs`, `update`).
- **The panel** (`hooks/panel.tsx`), a Claude Code mod, which opens beside the chat in every session. To notice the plugin's own steps, it sees the text of each Bash and PowerShell command the session runs, and keeps none of it.
- **It installs nothing.** Without a Vercel CLI, Claude tells you the install command, `npm install --global vercel`, and runs it only on your yes.

### Background processes

- **The connection listener** (`scripts/connect.mjs`, `listen`): while you approve this computer, at most 12 minutes, it listens on `127.0.0.1` only, answers one exact address, and stops after one approval.
- **The session-start reading** (`scripts/sw.mjs`, `hook`): once you have said yes to a first send, when a Claude Code session starts and the last reading is 15 minutes old, it starts a reader in the background that reads Vercel and sends it, without the model and without using the chat.
- **The rest of the first reading** (`scripts/sw.mjs`, `read --later`): before your first yes, once the projects, domains, latest deploys, costs and tokens are read and Claude has asked you, it reads each project's deploys and visitors and the billing charges into the reading kept on this computer, so the question comes in seconds. It sends nothing; sending waits for it.
- **The Vercel sign-in** (`vercel login`), while it waits for your approval at Vercel.
- **The panel's refresh** (`hooks/panel.tsx`): in each session, when it opens and then every 10 minutes, the panel asks Stackwarden for what its dashboard shows (`scripts/sw.mjs`, `view`). After each step Claude runs of the plugin's script, it reads its own data folder again to show what changed. For the first 3 minutes of a session it also looks every 3 seconds at when two of its own files, `reader-state.json` and `panel-summary.json`, last changed, so the session-start reading shows as soon as it lands.

### What it reads

- **Your repo:** the Git repository that holds the folder Claude Code works in, from its top folder (`scripts/panel-data.mjs`, `repoAt`; `scripts/scan.mjs`). It reads:
  - package manifests (`package.json`, `requirements.txt`, `pyproject.toml`, `Pipfile`);
  - source files, for env var names and the hosts they call;
  - `.env.example`, for names only;
  - Dockerfiles and compose files, for images;
  - the config files in `scripts/catalog.json`;
  - `.git`, for the origin and the commit.

  It never opens a `.env` file, a key or certificate (`.pem`, `.key`, `id_rsa`…), a credentials file, or a folder named `secrets`, `.ssh`, `.aws` or `.gnupg` (`isPrivate`).
- **Your Vercel account,** through the Vercel CLI, as listed above. From each answer it keeps only the fields the recipe names, and drops everything else before anything is sent (`scripts/read.mjs`, `keep`). Vercel's answer for projects can hold environment variable values: none of them is kept.
- **Claude Code's settings** (`~/.claude/settings.json` and `plugins/known_marketplaces.json`), to show whether auto-update is on (`scripts/local.mjs`, `autoUpdateState`).

### What it writes

- **Its own data folder,** `~/.claude/plugins/data/stackwarden-simple-…` (`scripts/local.mjs`). It holds:
  - this computer's key for Stackwarden, in `reader.json`, with mode 0600 (on Windows, your user folder's own permissions apply);
  - when Vercel was last read, and what the panel shows;
  - the reading waiting for your yes;
  - the Vercel CLI's sign-in log, while it runs.
- **One setting of Claude Code's,** only when you press "Turn on auto-update" (`scripts/local.mjs`, `turnOnAutoUpdate`):
  - It sets `autoUpdate: true` on the entry of the marketplace this plugin came from, so every plugin from that marketplace updates by itself. Stackwarden's marketplace holds only this one.
  - When `settings.json` has no entry for that marketplace yet, it adds one, with the source Claude Code recorded when you added the marketplace.
  - Nothing else in the file changes.
- **Nothing in your repo.**

### Where it connects

Only to Stackwarden: `https://stackwarden.vercel.app`, or a Stackwarden on this computer (`localhost`, `127.0.0.1` or `[::1]`) when you set `STACKWARDEN_URL` to one (`scripts/stackwarden.mjs`, `trustedServer`). Every request is in that one file. The Vercel CLI connects to Vercel itself, as it always does.

### What it sends

All of it in `scripts/stackwarden.mjs`. Once this computer is connected, every request carries its key, so Stackwarden knows which computer and organization it comes from.

- **To connect this computer,** before any yes:
  - hashes of a new key and of a one-time secret;
  - this computer's name, as you see it under API keys;
  - the `127.0.0.1` address the browser returns to.

  Stackwarden keeps only the key's hash; later requests carry the key itself.
- **Your Vercel account,** after your yes, then at each session start and on the panel's "Read again". Every project of the team goes, not only this repo's. With each answer go the command the CLI ran and the Vercel CLI's version. The recipe keeps:
  - each team's ID, slug and name, its plan, billing status and currency, its trial and billing period dates, and the price and quantity of its Pro plan and seats;
  - your user's ID and username, and, if Vercel paused the account, when, why, for what overuse and until when;
  - each project's ID, name, framework, Git provider, owner and repository, production branch, and last change;
  - its latest production deploy and each deploy of the last 32 days: ID, address, state, and when it was created, started building and was ready;
  - its domains: each name, whether it's verified, and where it redirects;
  - its visitors and page views a day, where Web Analytics is on;
  - billed quantities and costs a day, with their currency, by project, service, category and unit, summed here, so Stackwarden can tell each project's share of the costs;
  - the billing period's costs a day, by service;
  - your tokens: each ID and name, the first and last characters Vercel shows of it, its scopes and the teams they reach, how it was made, and when it was made, last used, expires and was revoked.
- **Your repo's scan,** after your yes:
  - the repo's name, Git address and commit;
  - each service found, with the file, line and name that show it: a package, a setting's name, a config file, an image, a host, or a project ID that a config file names (`.vercel/project.json`, `supabase/.temp/project-ref`, `.neon`, `wrangler.json`…);
  - the names of the settings each service uses, with where;
  - the Vercel project and team IDs that `.vercel/project.json` names;
  - the scanner's version.
- **What you choose in the panel or the chat:**
  - which Vercel project is this repo's, as the project's ID and the repo's Git address;
  - a project's tokens, by their IDs;
  - your answer to a service waiting for your OK.
- **Requests that only ask:** what the dashboard shows, for the panel, and whether you approved this computer yet.

### What it never does

- It never sends code, a file's contents, or the value of a key or variable from your repo or your Vercel account.
- It never asks for a token, key or password, and never stores one but its own key for Stackwarden.
- It never runs a command that changes anything at Vercel.
- It never takes instructions from your repo, Vercel or Stackwarden. The names it passes to Claude are cut short and quoted, and Claude reads them as data (`scripts/sw.mjs`, `shown`).

## Install

In Claude Code 2.1.330 or newer, with Node.js 22 or newer:

```bash
/plugin install stackwarden-simple --marketplace cermakjan-hub/stackwarden-simple
```

For a Stackwarden on this computer, start Claude Code with `STACKWARDEN_URL=http://localhost:3000`.

Privacy: https://stackwarden.vercel.app/legal/privacy. Problems: https://github.com/cermakjan-hub/stackwarden-simple/issues. Security: [SECURITY.md](SECURITY.md).
