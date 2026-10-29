# Tokkip Healthy PC — guide for AI coding agents

Andy's (LoperStack) PC cleaner and optimizer, 100% ours: Tauri 2 (Rust in
`src-tauri/`, Preact + TypeScript in `src/`) with Tokkip PC's look and Tokkip
himself showing how the PC feels. Part of the Tokkip family (Andford/tokkip).
Spanish first (Mexican, de tú), English too.

This rewrite lives on the `nueva` branch. The older app (Electron, based on
Kudu) stays on `tokkip`/`main` and is the one people install until this one
does everything it did; the plan and its progress are in `docs/PLAN.md`.

## Where things are
- `src-tauri/src/tools/` — one module per tool (the cleaner is `cleaner.rs`), each with its tests.
- `src-tauri/src/fsx.rs` — what every tool touching files shares: a file's identity (checked again right before deleting), the protected folders, the Recycle Bin, "show in folder".
- Scans keep what they found in `lib.rs` (`Found`), by id; the page sends ids back, never paths to delete.
- Kudu (MIT) is the reference for what each tool does and its Windows care: read its version (old app, branch `tokkip`) before writing one, rewrite it in Rust, and credit it in the file and THIRD-PARTY-NOTICES.md.
- `src-tauri/src/platform.rs` — what asks Windows (processes, disk, recycle bin, admin). Other systems get quiet stubs, so the logic tests run on Linux.
- `rules/*.json` — our cleaning rules: paths with `%VARIABLES%` and `*` folders, file patterns, minimum age, admin, the program that keeps them open.
- `src-tauri/src/health.rs` — the health score and mood; `notice.rs` writes `%APPDATA%\Tokkip\shared\healthy-pc.json` for Tokkip PC (moods and kinds are a contract with it).
- `src/pages/` — one page per section; `src/core/api.ts` — the commands (and the example PC shown outside the app).
- `src/i18n/es.json` — the Spanish for each English key.
- Copied from Tokkip PC by `npm run sync-tokkip` (don't edit here, change them there): `src/tokkip/*`, `src/core/{theme.ts,tokens.css,layout.ts,fonts.ts}`, `public/sounds/`.
- `npm run icons` regenerates `src/ui/icons.ts` from Material Symbols.

## Rules
- Keep the identifier `mx.loperstack.tokkiphealthypc`.
- Look first, then touch: every tool reviews, lets you choose, then applies. Never delete while scanning. Files in use are skipped and counted, never forced. Links are never followed.
- Undoable, or say so first (the recycle bin, the shredder).
- Nothing leaves the PC: no cloud, no telemetry. Network only for what the user asks.
- Use the theme tokens (`--c-*`), never fixed colours.
- Commits as Andy (`soportemacrobit001@gmail.com`), Conventional Commits.

## Check
```
npm ci
npx tsc --noEmit && npm test     # page
npx vite build && (cd src-tauri && cargo test)   # Rust (needs dist/)
npm run tauri dev                # the app
```
