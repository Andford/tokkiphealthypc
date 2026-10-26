# Tokkip Healthy PC

Andy's fork of Kudu (MIT, Advent Development): a system cleaner and optimizer
for Windows (and Linux/macOS) built with Electron, with Tokkip's look and Tokkip
himself showing how the PC feels. Part of the Tokkip family (Tokkip on Android
and Wear OS, Tokkip Notas, Tokkip PC — all in Andford/coucousaltymod).

## Rules for this fork

- No Kudu Cloud and no network calls to Kudu: everything stays on the PC.
  Network only for what the user asks (software and driver updates, the app's
  own updates from Andford/tokkiphealthypc releases).
- Keep Kudu's MIT notice (LICENSE) and the credit in About.
- English and Spanish only. Spanish speaks with "tú", like Tokkip.
- Tokkip's pieces live in `src/renderer/src/tokkip/` (drawing, health, party,
  sounds, shapes, theme in `tokkip.css`). Tokkip PC hears this app through
  `%APPDATA%/Tokkip/shared/healthy-pc.json` (`src/main/services/tokkip-notice.ts`).
- Everything is named Tokkip, inside too (`window.tokkip`, `AppSettings`, CSS
  classes `tokkip-*`, logs, temp folders). Kudu's name stays only in LICENSE,
  the About credit and README's credits. Kudu's fixes are ported by hand.
- What 0.1.0 saved under Kudu's name is read once and never written: the
  `KuduStartup` task (deleted when startup is set), `HKLM\SOFTWARE\Kudu\
  RegistryBackupSeals` (read and cleaned in `registry-backup-seal.ts`), the
  `Kudu … Recovery-` folders, and `kudu…` localStorage keys
  (`src/renderer/src/tokkip/legacy.ts`). Keep these until nobody has 0.1.0.
- Builds: `.github/workflows/build.yml` (Windows installer and portable on every
  push; a `v*` tag publishes a release the updater reads).

## Releasing

`npm run release -- patch|minor|major` bumps the version, writes the changelog,
tags and pushes; the tag's build publishes the release.

`conventional-changelog-angular` is pinned to `^8` as a direct devDependency even
though nothing imports it. This is deliberate: commitlint depends on `^9`, which
npm hoists to the top of `node_modules`, where `conventional-changelog`'s preset
loader picks it up instead of the `^8` it needs — and v9 exports a shape v8's
loader can't read, so changelog generation silently produces empty sections.
Pinning `^8` as a direct dependency keeps the right version hoisted and pushes
commitlint's copy into a nested folder. Don't remove it as unused. `npm ls
conventional-changelog-angular` should show `8.x` at the top level.

## Testing

```
npm run check          # everything CI runs: typecheck, lint, format, rules, tests
npm test               # run all tests once (vitest run)
npm run test:watch     # run tests in watch mode
npm run typecheck      # tsc across main + renderer (test files excluded for now)
npm run lint           # eslint
npm run format         # prettier --write
npm run validate:rules # validate rule JSON files against schema
```

PRs are squash-merged with the PR title as the commit message, so the title must be a Conventional Commit. Individual commits inside a PR are not linted.

## Development

```
npm run dev
```

## Commit Conventions

Always use [Conventional Commits](https://www.conventionalcommits.org/). Format:

```
<type>(<scope>): <short summary>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

Examples:
- `feat(rules): add new browser cache cleaning rule`
- `fix(scanner): handle missing registry keys on Windows`
- `refactor(ui): extract settings panel into separate component`
- `test(engine): add unit tests for file size calculation`

Breaking changes must include `!` after the type/scope (e.g., `feat(api)!: redesign plugin interface`).

## Efficient Repository Exploration

- Preserve correctness: use focused searches to locate evidence, then read enough surrounding code to understand behavior.
- List candidates with `rg --files` or `fd`; avoid recursive `ls` and unrestricted directory dumps.
- Search with `rg -n -C 2` plus `-g` filters. Read targeted ranges with `sed -n 'START,ENDp'` instead of printing whole large files.
- Use `ast-grep` for syntax-aware searches and refactors where its language parser applies. Review every rewrite with `git diff`.
- Use `tokei --compact`, `jq`, and `yq` for concise repository, JSON, and YAML summaries.
- Start change review with `git diff --stat` or `git status --short`, then inspect only relevant paths.
- Do not scan `node_modules`, generated assets, lockfiles, or build output unless the task specifically requires them.
