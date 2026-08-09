<p align="center">
  <strong>Workbuddian</strong>
</p>

<p align="center">
  <a href="https://github.com/jiang198012/workbuddian/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/jiang198012/workbuddian?sort=semver"></a>
  <a href="https://github.com/jiang198012/workbuddian/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/jiang198012/workbuddian/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
</p>

<p align="center">
  <a href="./README.md">中文</a> | <strong>English</strong>
</p>

> **Primary audience is Chinese-speaking Obsidian users. The canonical README is in Simplified Chinese ([中文](./README.md)); this English page is a condensed entry point.**

Turn your local **CodeBuddy CLI** into an AI chat agent living inside your Obsidian vault — chat, reference notes, and edit your writing without ever switching windows.

> ⚠️ **Desktop only** (Windows / macOS), requires Obsidian 1.7.2+. Linux is not supported yet.

## Features

- **Streaming chat** in the sidebar or a full-width main-area tab, with collapsible thinking / tool-call cards and Markdown rendering.
- **`@` references anything** — subagents (`@Agent`), MCP servers (`@mcp`), notes (`@[[note]]`), or any file, from one dropdown.
- **Approvals in the bubble** — Write / Edit / Bash / MCP tools ask permission on a card; plan mode continues in the same turn.
- **Line-level diffs with one-click undo** for vault edits, guarded by three safety checks.
- **Conversation forking** and **two truly isolated panels** (sidebar + main area, separate sessions).
- **Visual MCP server management** with two-way JSON sync; custom subagents in JSON.
- **Bilingual UI** (中文 / English) with instant switching.

## Installation

**Prerequisites**: Obsidian 1.7.2+ (desktop), Windows or macOS, and the **WorkBuddy desktop app** (≥ 5.0.5) which bundles the CodeBuddy CLI.

1. In Obsidian: **Settings → Community plugins → Browse**.
2. Search **"Workbuddian"** → **Install** → **Enable**.

Or via [BRAT](https://github.com/TfTHacker/obsidian42-brat) with `jiang198012/workbuddian`.

## Quick Start

1. Click the **robot ribbon icon** or run **"Workbuddian: Open chat panel"**.
2. If the plugin can't find CodeBuddy / Node.js, run the environment-setup prompt once in WorkBuddy (full prompt in the [Chinese README](./README.md#快速开始)).
3. Send your first message.

> **Vault permissions**: send the full contents of `提示词-授予Vault读写权限.md` to WorkBuddy/CodeBuddy once, then fully quit and reopen it.

## Documentation

The complete documentation (usage, settings, auto-discovery, FAQ, changelog) is maintained in **Simplified Chinese**: [README.md](./README.md) — the canonical source.

## Support

File bugs or feature requests on [GitHub Issues](https://github.com/jiang198012/workbuddian/issues).

## License

MIT. See [LICENSE](LICENSE).
