<h1 align="center">Workbuddian</h1>

<p align="center">
  <a href="https://github.com/jiang198012/workbuddian/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/jiang198012/workbuddian?sort=semver"></a>
  <a href="https://github.com/jiang198012/workbuddian/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/jiang198012/workbuddian/total"></a>
  <a href="https://github.com/jiang198012/workbuddian/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/jiang198012/workbuddian/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://obsidian.md/plugins?id=workbuddian"><img alt="Obsidian plugin" src="https://img.shields.io/badge/Obsidian-plugin-market-blue"></a>
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
</p>

<p align="center">
  <a href="./README.md">中文</a> | <strong>English</strong>
</p>

> **Primary audience is Chinese-speaking Obsidian users. The canonical README is in Simplified Chinese ([中文](./README.md)); this English page is a condensed entry point.**

**Workbuddian** is an **Obsidian community plugin** that turns your local **CodeBuddy CLI** or **Hermes agent** into an **AI chat agent** living inside your vault — chat, reference notes with `@`, stream replies, and edit your writing without ever switching windows. Dual backends, one panel.

> ⚠️ **Desktop only** (Windows / macOS), requires Obsidian 1.7.2+. Linux is not supported yet.

## Features

- **Dual backends** — local CodeBuddy CLI or **Hermes agent**, both with full agent features (tools / approval cards / thinking / usage / forking) over ACP. Hermes falls back to a plain-chat HTTP lite mode when the local CLI is missing or a remote gateway is configured; auto-discovers gateway URL + API key from `~/.hermes`.
- **Streaming chat** in the sidebar or a full-width main-area tab, with collapsible thinking / tool-call cards and Markdown rendering.
- **`@` references anything** — subagents (`@Agent`), MCP servers (`@mcp`), notes (`@[[note]]`), or any file, from one dropdown.
- **Approvals in the bubble** — Write / Edit / Bash / MCP tools ask permission on a card; plan mode continues in the same turn.
- **Line-level diffs with one-click undo** for vault edits, guarded by three safety checks.
- **Conversation forking** and **two truly isolated panels** (sidebar + main area, separate sessions).
- **Visual MCP server management** with two-way JSON sync; custom subagents in JSON.
- **Installed Skills** — discover skills from `~/.workbuddy/skills`, `~/.codebuddy/skills`, and vault-local skill folders; type `/` to choose and invoke one.
- **Bilingual UI** (中文 / English) with instant switching.
- **Beyond using the CLI directly** — visual interface, approval cards, one-click undo, and panel integration all live inside Obsidian.

## Installation

**Prerequisites**: Obsidian 1.7.2+ (desktop), Windows or macOS, and an installed, logged-in **WorkBuddy desktop app** (≥ 5.0.5), which bundles the CodeBuddy CLI. The 2.6.14 native route was tested on macOS with WorkBuddy 5.7.7; older compatibility notes follow.

1. In Obsidian: **Settings → Community plugins → Browse**.
2. Search **"Workbuddian"** → **Install** → **Enable**.

Or via [BRAT](https://github.com/TfTHacker/obsidian42-brat) with `jiang198012/workbuddian`.

## Quick Start

**2.6.16 optional-connector recovery**: a failed or incompatible old connector, or warmup without an actual sidecar, no longer blocks the original account route. Independently authenticate the native broker only when the sidecar is absent and no worker has been submitted. Cancellation, untrusted sidecars and invalid account proofs still fail closed; prompts are not automatically replayed. See the [recovery report](docs/issue-10-connector-recovery-2026-10-09.md). Native transport limits remain; this is not full high-availability acceptance.

**2.6.15 startup fixes**: existing sidecars also use the bundled desktop runtime; bundled CLI symlinks are resolved before runtime detection. Wait up to about 30 seconds for a delayed account request channel, with cancellation and without restarting an active host. Native fallback after a broken or incompatible optional connector is still pending; this patch is not full zero-setup acceptance. See the [follow-up report](docs/issue-10-zero-setup-followup-2026-10-09.md).

**2.6.14 native account route**: install and log in to WorkBuddy, then send a message in Obsidian. When no connector is available, the plugin delegates requests to the host's native account broker. It can normally open an identified installation when the desktop app is not running, without restarting an active host. No connector, extra Node installation, separate account or API key is required. Existing sidecar connections retain their previous route. Known `WorkBuddy AI` product identifiers are also accepted.

**Native route limits**: WorkBuddy 5.7.7 currently buffers each HTTP response, with an approximately 50-second host deadline and approximately 640 KiB request/response limit. Model tokens arrive after the complete response, not as an immediate token stream. Large attachments, long output and very large context may exceed these limits. Core macOS flows passed; **Windows hardware, prolonged operation and billing deltas remain unverified, so #10 stays open**. See the [acceptance report](docs/issue-10-zero-setup-2026-10-09.md).

**Optional connector route in 2.6.13**: for WorkBuddy 5.7.6 missing-sidecar errors, explicitly install the local connector from the command palette and normally restart WorkBuddy after saving tasks. Version 2.6.14 does not require this for its native route. The connector only invokes a fixed host warmup method and does not read login credentials or send model prompts. See the [previous cold-start report](docs/issue-10-cold-start-diagnosis-2026-10-07.md).

**WorkBuddy 5.6.2 compatibility ([#10](https://github.com/jiang198012/workbuddian/issues/10))**: **2.6.12** creates a dedicated Vault worker through WorkBuddy's own sidecar. Keep the original desktop app running and logged in; the worker uses the same account and quota. Older WorkBuddy versions without bootstrap retain stdio. Original-account chat, Vault read/write and conversation recovery after plugin reload have been tested on macOS; **Windows hardware validation is pending**, so #10 remains open for feedback. This uses internal IPC, not an officially guaranteed public API. Version 2.6.10 and earlier do not include this adaptation. See the [acceptance report](docs/issue-10-host-acceptance-2026-09-29.md).

An unavailable host credential channel does not mean WorkBuddy is logged out, and logging in again is not a guaranteed remedy. Automatic detection only selects WorkBuddy and never switches to a standalone CodeBuddy account or quota. Explicit paths and `CODEBUDDY_PATH` are preserved, including when unavailable. A manually selected alternative CLI uses its own authentication and quota. The plugin does not read, copy, or decrypt WorkBuddy login credentials. See the [Chinese compatibility notes](./README.md#快速开始).

1. Click the **robot ribbon icon** or run **"Workbuddian: Open chat panel"**.
2. Confirm WorkBuddy is installed and logged in; the 2.6.14 native route uses its bundled runtime. If a custom installation is not detected, select its bundled CLI path in settings. Older or explicitly selected alternative CLIs may still need the environment-setup prompt in the [Chinese README](./README.md#快速开始).
3. Send your first message.

> **Vault permissions**: send the full contents of `提示词-授予Vault读写权限.md` to WorkBuddy/CodeBuddy once, then fully quit and reopen it.

## Documentation

The complete documentation (usage, settings, auto-discovery, FAQ, changelog) is maintained in **Simplified Chinese**: [README.md](./README.md) — the canonical source.

## What's New

**Latest version 2.6.16**

- **2.6.16 — Optional-connector recovery**: restore the independently authenticated original account route after old connector failures or warmup without a sidecar. Retain cancellation and endpoint validation. Synthetic-Vault approval/rejection, chat after rejection, owned-session reconnection and small PNG protocol checks passed. **Native limits, Windows hardware and prolonged operation remain unresolved or unverified; #10 stays open.**

- **2.6.15 — Startup reliability**: reuse the bundled runtime for existing sidecars, recognize bundled CLI symlinks and wait for delayed account channel recovery with cancellation. **Native limits and the broken-connector fallback gap remain; Windows hardware and broader acceptance are pending, #10 stays open.**

- **2.6.14 — Native account access without a connector**: delegate to the original WorkBuddy account, normally open an inactive host and reuse the bundled runtime. Recognize `WorkBuddy AI` identifiers. macOS first use, automatic launch and chat after cancellation passed. **Native responses are buffered, limited to about 50 seconds / 640 KiB; Windows hardware remains unverified and #10 stays open.**

- **2.6.13 — WorkBuddy cold start and recovery**: an explicitly confirmed local connector fixes the missing-sidecar startup path in 5.7.6. Add startup timeout, cancellation, duplicate-send and worker-cleanup guards without replaying prompts. Cold start and host-restart recovery passed in demo-vault on macOS; **Windows and long-running validation pending, #10 remains open**.

- **2.6.12 — Original WorkBuddy account restored**: adapt the 5.6.2 host credential channel, filter stale reply replays and fix worker cleanup on reconnect. No automatic switch to a standalone account. Core flows verified on macOS; **Windows hardware validation pending, #10 remains open**. The 2.6.11 tag did not produce a Release because of a Linux test-fixture path mismatch; 2.6.12 corrects the fixture without rewriting that tag.
- **2.6.10 — Input sizing and path protection**: configurable min/max input height, automatic shrinking and safer Vault path boundaries.

- **v2.6.5 — Skill invocation**: discover installed WorkBuddy/CodeBuddy skills and invoke one from the `/` completion list.

## Support

File bugs or feature requests on [GitHub Issues](https://github.com/jiang198012/workbuddian/issues).

## License

MIT. See [LICENSE](LICENSE).
