# Acceptance — 2026-11-08

Against the design (`docs/design.md` §10). Automated checks were run in this session; the live checks
need the owner's VS Code, model subscriptions and Eliza token, so they are listed as a checklist.

## Automated (done)

| Check | Result |
|---|---|
| `npm run test:mycelium` | 149 passing |
| `npm run test:unit` (Cline's suite + Mycelium) | 1 536 passing, 4 pending, 0 failing |
| `npm run package:vsix` | `~/database/20261108_mycelium/builds/mycelium-3.79.0-<sha>.vsix` (~14.4 MB) |
| `node scripts/mycelium/check-hosts.mjs dist/extension.js` | OK — every host in the bundle is a model provider or a documented dormant string |
| Install into an isolated VS Code profile | `local.mycelium-coder@3.79.0` installs next to other extensions (Task 2) |
| Headless scenario, both profiles (`src/mycelium/__tests__/scenario.test.ts`) | a Developer task goes clarification → data_collection → development → audit → report through the real runtime, store, gate and myc_* tools; update-cycle runs; agent calls are recorded; `improved` runs check_all.sh itself (2 passed runs) and asks the owner once when leaving audit; `tao` runs none and asks nothing |

## Live checklist (owner)

1. Install: `code --install-extension ~/database/20261108_mycelium/builds/<latest>.vsix`. Expect a separate
   "Mycelium" sidebar; `~/.mycelium/data/` appears; `~/.cline` is untouched.
2. Models: `Mycelium: Configure Eliza…` (token → SecretStorage). Write one `models.json`, e.g.
   `{"main":{"kind":"eliza","model":"anthropic/claude-sonnet-4.6"},"aux":{"kind":"eliza","model":"anthropic/claude-haiku-4.5"}}`
   or `{"main":{"kind":"cline"}}` with Cline's Claude Code provider. Record in the private Eliza notes that a turn
   with each provider answered with a tool call.
3. Workspaces: `scripts/mycelium/new-sample-workspace.sh ~/database/20261108_mycelium/acceptance/sample-tao tao models.json`
   and the same with `improved`.
4. In each: `Mycelium: New Task…` → Architect, brief "A one-page site listing three mushrooms with photo
   placeholders, built with Astro". Expect the 8 documents + `check_all.sh` + `ROADMAP.md` and a handoff
   file in `.mycelium/handoffs/`.
5. In each: `Mycelium: New Task…` → Developer, "Выполняем Этап 1". Expect the stages to run to report; in
   `improved` a `check_runs/latest.log` from the extension; in `tao` the audit log shows history
   truncation after update-cycles.
6. In each: Debug task "open the dev server page and check it renders" → screenshots in
   `.mycelium/screenshots/` and `~/database/20261108_mycelium/artifacts/screenshots/`.
7. `Mycelium: Summarize Workspace` in both; copy `.mycelium/summary.html` to the acceptance folder.
8. While a task runs, sample `ss -tnp | grep code` every 5 s for a minute: only provider hosts plus hosts
   the agent's tools contacted (e.g. npm), each visible as an approved command in chat.
