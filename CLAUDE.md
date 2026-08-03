# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Workbuddian is a **desktop-only Obsidian community plugin** (`isDesktopOnly: true`, Obsidian ≥ 1.7.2) that embeds the local **WorkBuddy / CodeBuddy CLI** as an AI chat agent inside a vault. Its UI references Claudian (MIT). Windows + macOS only; Linux is unsupported. Logs are prefixed `[WB]`.

## Commands

```bash
npm install            # required first — node_modules is not checked in
npm run dev            # esbuild watch build (rebuilds main.js on save)
npm run build          # tsc -noEmit typecheck THEN esbuild production bundle
npm test               # jest --coverage
npm run test:watch     # jest watch mode
npx jest tests/manager.test.ts     # run a single test file
npx jest -t "substring of test name"   # run tests matching a name
```

`npm run build` runs `tsc -noEmit -skipLibCheck` purely as a typecheck gate — the actual bundle is produced by esbuild, not tsc. There is no separate lint step.

## Build & distribution model

- Entry point `src/main.ts` (default export `WorkbuddianPlugin`) is bundled by `esbuild.config.mjs` into a single **`main.js` at the repo root**. `obsidian`, `electron`, CodeMirror packages, and Node builtins are marked `external`.
- **`main.js` is committed** — `.gitignore` ignores all `*.js` but re-includes `!main.js`. The distributable plugin is the three files `main.js` + `manifest.json` + `styles.css`. When you change source, the committed `main.js` is only correct after a build.
- Two versions coexist and can drift: `package.json` (`1.0.13`, npm/dev) vs `manifest.json` (`0.1.0`, the Obsidian-facing plugin version). `version-bump.mjs` (via `npm version`) syncs `manifest.json` + `versions.json`.

## Architecture

Layered, single-responsibility modules under `src/`. The flow of a message: `features/chat/input.ts` → `core/context/assembleContext.ts` → `providers/codebuddy` (ACP persistent process) → streams `StreamChunk`s back into the DOM and into `core/session/manager.ts` for persistence.

- **`providers/codebuddy/` — the ACP bridge (v2).** `CodebuddyProvider.sendMessage()` is an **async generator** over a single long-lived `codebuddy --acp` process (stdio ndjson JSON-RPC, multi-session). `index.ts` is a thin shell preserving the v1 contract (`StreamChunk { type: 'thinking'|'text'|'tool'|'error'|'done' }`, public method signatures, errors thrown not yielded). The `acp/` submodules are pure Node, no Obsidian imports: `client.ts` (lazy spawn + 10s handshake + preflight tiers + id-matched request dispatch + death detection), `session.ts` (per-session state machine `idle → prompting → (awaitingPermission → prompting)* → idle`, lazy `session/load`/`session/new` with `Conversation.acpSessionId` write-back, `SessionRegistry`), `events.ts` (ACP `session/update` → `StreamChunk` pure mapping), `permission.ts` (`session/request_permission` → approval-card data pure mapping). Permission/usage/config flow via side-channel callbacks (`onPermissionRequest`/`onUsage`/`onConfigUpdate` registered per conversation key by the view); `cancel(sessionId?)` is targeted per session (dual-panel safe); process death fails in-flight turns and the next send auto-restarts + `session/load`s context back.

- **`utils/cliPath.ts` — cross-platform auto-discovery.** `resolveCodebuddyPath()` and `findNodeExecutable()` probe a long list of Windows/macOS install locations (WorkBuddy `app.asar.unpacked/cli/bin`, npm global, PATH, `~/.workbuddy/binaries/node/versions/*`, Homebrew, nvm/volta). Falls back to the bare string `'codebuddy'` / `'node'` so the OS resolves it via PATH. This is pure Node (`fs`/`path`/`process`) with no Obsidian imports.

- **`core/session/manager.ts` — `ConversationManager`.** In-memory `Map<id, Conversation>` with a `persistCallback` wired up in `main.ts` (writes through Obsidian's `saveData`). Note the deliberate design: **one shared manager instance backs both the sidebar view and the main-pane view** (created once in `onload`) so the two panels never clobber each other's state with stale snapshots. Views therefore track their own `activeConvId` and read via `getById()`, NOT the manager's internal `getActive()`. `hasConversations()` lets a second view reuse already-loaded memory instead of re-reading from disk.

- **`core/context/assembleContext.ts` — prompt assembly.** `assembleContextText()` composes the user text with optional blocks separated by `---`: vault-path preamble (when `injectVaultContext`), current-note link (when `injectCurrentNoteLink`), and an `@`-reference block. Pure function, unit-tested.

- **`features/chat/` — the Obsidian view layer.** `view.ts` (`WorkbuddianChatView extends ItemView`, `VIEW_TYPE_CHAT = "workbuddian-panel"`) builds the DOM; `input.ts` owns `sendMessage()` (the streaming loop that mutates the assistant bubble live and calls `manager.updateMessage(..., skipSave=true)` during the stream, then `manager.flush()` once at the end); `render.ts` renders messages via Obsidian's `MarkdownRenderer`; `tabs.ts` handles tab bar, rename, delete, search, and the export context menu.

- **`shared/` — pure helpers.** `atReferences.ts` parses `@[[note]]` references; `export.ts` formats a conversation as Markdown.

- **`types/index.ts` — shared types + safety + migration.** Type guards (`isObject`/`getString`/`getNumber`/`getBoolean`), `generateId`, and the **settings migration pipeline**: `normalizePersistedData()` (splits `{ conversations, settings }`) and `migrateSettings()` (upgrades to `CURRENT_SETTINGS_VERSION`, currently 4, filling defaults for missing/invalid fields). Always route persisted data through these — raw `loadData()` output is untrusted.

- **`features/settings/tab.ts`** — settings UI; selectable models come from the ACP handshake (`session/new` result), with `FALLBACK_MODEL_OPTIONS` (`shared/cliOptions.ts`) as the pre-handshake fallback.

Empty `.gitkeep`-only dirs (`core/providers`, `core/runtime`, `core/security`, `features/inline-edit`, `i18n`, `style`) are placeholders for the roadmap (`ROADMAP.md`), not live code.

## Testing conventions

- Jest + ts-jest (`jest.config.js`, `testEnvironment: node`). Coverage is on by default.
- **Tests deliberately cover only the Obsidian-free logic modules** — `providers/codebuddy`, `utils/cliPath`, `core/session`, `core/context`, `shared`, `types`. There is **no `moduleNameMapper` for `obsidian`**, so any module that `import ... from 'obsidian'` (all of `features/chat/*` and `features/settings/*`) is untestable as-is and no test imports it. `tests/mocks/obsidian.ts` exists but is currently unreferenced.
- **Keep new logic testable by keeping it out of `obsidian`-importing files** — put pure logic in `core`/`shared`/`utils`/`types` and have the view layer call into it, mirroring the existing split (e.g. `input.ts` delegates to `assembleContext.ts` and `atReferences.ts`).
- `tests/acpClient.test.ts` mocks `child_process` (`jest.mock('child_process')`) to drive the ACP transport without a real CLI; `tests/api.test.ts` / `tests/providerCallbacks.test.ts` instead mock `providers/codebuddy/acp/client` (shared harness: `tests/helpers/fakeAcpClient.ts`) to pin the generator contract. `scripts/acp-smoke.mjs` runs a manual regression against the real CLI (not part of jest).
