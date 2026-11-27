# Stackwarden (simple) for Claude Code

A small version of the Claude Code plugin for [Stackwarden](https://stackwarden.vercel.app), being tried out before it replaces the main one. Say "I want to use Stackwarden" in a repo: it finds what the repo runs on, reads your Vercel account through the Vercel CLI you're signed in to, and files the repo as a project, with one approval in your browser and no key to paste. A panel beside the chat shows your Stackwarden organization.

What it runs, reads, writes, connects to and sends, each with the file that does it: [plugin-simple/README.md, "What it does on your computer"](plugin-simple/README.md#what-it-does-on-your-computer). The plugin is readable source, with no build step and no third-party packages.

Stackwarden is in early access: signing in works for invited accounts only.

## Install

In Claude Code 2.1.330 or newer, in a terminal session:

```bash
/plugin install stackwarden-simple --marketplace cermakjan-hub/stackwarden-simple
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `cermakjan-hub/stackwarden-simple`, then Add plugin.

## Updates

Claude Code leaves auto-update off for this marketplace. The Stackwarden panel offers to turn it on with one click. It sets `autoUpdate` on this marketplace in your `~/.claude/settings.json`, adding the marketplace's entry with the source Claude Code recorded when there is none, and changes nothing else. You can do the same in `/plugin`, Marketplaces, stackwarden-simple. Without it, the panel says when a new version is out and updates it with "Update now".

## This repo

Each version is published here from Stackwarden's private repository, so a change made here directly is overwritten by the next one. Report problems as issues here; for a security problem, see [plugin-simple/SECURITY.md](plugin-simple/SECURITY.md).

## License

Apache License 2.0; see [LICENSE](LICENSE).
