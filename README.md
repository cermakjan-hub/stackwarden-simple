# Stackwarden (simple) for Claude Code

A small version of the Claude Code plugin for [Stackwarden](https://stackwarden.vercel.app), being tried out before it replaces the main one. Say "I want to use Stackwarden" in a repo: it finds what the repo runs on, reads your Vercel account through the Vercel CLI you're signed in to, and files the repo as a project, with one approval in your browser and no key to paste. A panel beside the chat shows whether Vercel is connected. What it runs and what it sends: [plugin-simple/README.md](plugin-simple/README.md).

Stackwarden is in early access: signing in works for invited accounts only.

## Install

In Claude Code 2.1.330 or newer, in a terminal session:

```bash
/plugin install stackwarden-simple --marketplace cermakjan-hub/stackwarden-simple
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `cermakjan-hub/stackwarden-simple`, then Add plugin.

## This repo

Each version is published here from Stackwarden's private repository, so a change made here directly is overwritten by the next one. Report problems as issues here.

## License

Apache License 2.0; see [LICENSE](LICENSE). The scripts bundle third-party packages, listed with their licenses in [plugin-simple/THIRD_PARTY_NOTICES.md](plugin-simple/THIRD_PARTY_NOTICES.md).
