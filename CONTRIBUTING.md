# Contributing

Thanks for your interest in Workbuddian!

## Development setup

Requirements: **Node.js 18+** (20 LTS recommended); **Obsidian 1.7.2+** for manual testing.

```bash
npm install        # install deps (node_modules is not committed)
npm run dev        # esbuild watch — rebuilds main.js on save
npm run build      # tsc typecheck + production bundle
npm test           # jest --coverage
npx jest tests/manager.test.ts        # a single test file
npx jest -t "substring of test name"  # tests matching a name
```

The distributable is three files at the repo root: `main.js` + `manifest.json` + `styles.css`. `main.js` is committed and is only correct after a build.

## Conventions

- **Keep new logic testable**: put pure logic in `core/` / `shared/` / `utils/` / `types/` (no `obsidian` import) and have the view layer call into it. Modules that `import ... from 'obsidian'` are not unit-tested.
- New user-facing strings go through `src/i18n` (`STRINGS` + `t()`). Prompts sent to the CLI and `[BB]` logs stay in Chinese.
- Follow TDD where practical — this repo has a full unit-test suite. Match the surrounding code style (4-space indent).
- See `CLAUDE.md` for a deeper architecture overview.

## Pull requests

- Branch from `main`; keep each PR focused.
- `npm run build` and `npm test` must pass (CI runs both).
- If you change source, rebuild (`npm run build`) and include the updated `main.js`.
- Describe what changed and how you tested it.
