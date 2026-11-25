# Stackwarden (simple)

A small version of the Stackwarden plugin for Claude Code, built to prove one path before anything is added (ADR 0076 in the Stackwarden repo).

Say "I want to use Stackwarden" in a repo. Claude Code then:

1. scans the repo on this computer for the services it runs on, and sends nothing;
2. sets up the Vercel CLI if there is none, and signs it in if it is signed out: Vercel's own sign-in opens in your browser;
3. connects this computer to one Stackwarden organization: you approve it once in your browser;
4. reads your Vercel team through the Vercel CLI and sends it to Stackwarden;
5. asks you once, then files the repo as a project with the services it found;
6. proposes which of the team's tokens this app uses, for you to confirm; Stackwarden keeps them with the app's Vercel project.

A panel beside the chat shows this repo and its Vercel card. The card has a General section for the team: its plan, cost, projects, and the tokens no project uses. It also has a Project section for this repo's Vercel project: its deploy, its keys, its production URL, and its last 30 days. You choose the fields. The team's other projects are a click away, and you can choose any project's keys there. `/stackwarden` opens the panel where it doesn't open by itself.

## What it runs

- `scripts/sw.mjs`, built from `packages/reader`, and `scripts/scan.mjs`, the scanner, built from `packages/scanner`.
- The Vercel CLI, with only the read commands its connector lists (`vercel api` GETs, `vercel tokens list`, `vercel usage`), and `vercel login` when you are signed out.
- At session start, a hook that reads Vercel in the background at most once a day.

## What it sends

- **To Stackwarden, from the Vercel CLI:** projects with their status and usage, the plan, costs, and the names and dates of tokens. Never a value, never an env var's value.
- **To Stackwarden, after your OK:** the repo's name and Git address, the services found, and the names of their settings with the files and lines that use them. Never code or values.
- **To Stackwarden, when you choose them:** which of the team's tokens a Vercel project uses, by the IDs Vercel lists them under.
- **Nothing anywhere else.** The CLI talks to Vercel as it always does.

## Install

In Claude Code 2.1.330 or newer:

```bash
/plugin install stackwarden-simple --marketplace cermakjan-hub/stackwarden-simple
```

For a Stackwarden on this computer, start Claude Code with `STACKWARDEN_URL=http://localhost:3000`.
