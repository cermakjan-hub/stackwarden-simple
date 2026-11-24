# Stackwarden (simple)

A small version of the Stackwarden plugin for Claude Code, built to prove one path before anything is added (ADR 0076 in the Stackwarden repo).

Say "I want to use Stackwarden" in a repo. Claude Code then:

1. scans the repo on this computer for the services it runs on, and sends nothing;
2. sets up the Vercel CLI if there is none, and signs it in if it is signed out: Vercel's own sign-in opens in your browser;
3. connects this computer to one Stackwarden organization: you approve it once in your browser;
4. reads your Vercel team through the Vercel CLI and sends it to Stackwarden;
5. asks you once, then files the repo as a project with the services it found.

A panel beside the chat shows whether Vercel is connected, a short Vercel card whose fields you choose, and a Refresh button. `/stackwarden` opens it where it doesn't open by itself.

## What it runs

- `scripts/sw.mjs`, built from `packages/reader`, and `scripts/scan.mjs`, the scanner, built from `packages/scanner`.
- The Vercel CLI, with only the read commands its connector lists (`vercel api` GETs, `vercel tokens list`, `vercel usage`), and `vercel login` when you are signed out.
- At session start, a hook that reads Vercel in the background at most once a day.

## What it sends

- **To Stackwarden, from the Vercel CLI:** projects with their status and usage, the plan, costs, and the names and dates of tokens. Never a value, never an env var's value.
- **To Stackwarden, after your OK:** the repo's name and Git address, the services found, and the names of their settings with the files and lines that use them. Never code or values.
- **Nothing anywhere else.** The CLI talks to Vercel as it always does.

## Install

In Claude Code 2.1.330 or newer:

```bash
/plugin install stackwarden-simple --marketplace cermakjan-hub/stackwarden-simple
```

For a Stackwarden on this computer, start Claude Code with `STACKWARDEN_URL=http://localhost:3000`.
