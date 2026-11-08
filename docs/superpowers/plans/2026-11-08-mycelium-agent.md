# Mycelium Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork Cline v3.79.0 into "Mycelium", a VS Code extension built from source that adds TAO·CODER's architecture (task memory, stage pipeline, update-cycle, gates, metrics) with two switchable behaviour profiles, `tao` and `improved`.

**Architecture:** All new logic lives in `src/mycelium/` as plain TypeScript modules with unit tests (store, kernel, update-cycle, gate, policy, metrics). A per-task facade, `MyceliumTaskRuntime`, is called from a handful of small hooks in Cline's core: the request builder in `Task.attemptApiRequest`, tool filtering in `ClineToolSet`, the re-check in `ToolExecutor`, and the command and file-write handlers. Every behaviour that differs between profiles is read from a `Profile` object, never branched on by name.

**Tech Stack:** TypeScript, Node (LTS via nvm), esbuild, VS Code extension API, mocha + should + sinon (Cline's unit-test setup), `@vscode/vsce`.

**Spec:** `/home/tarstars/prj/cntr/docs/superpowers/specs/2026-11-07-own-tao-agent-design.md` (task 1 copies it to `~/prj/mycelium/docs/design.md`). Background with the evidence: `/home/tarstars/prj/cntr/analysis/CODE_ANALYSIS.md` and `/home/tarstars/prj/cntr/analysis/code/{memory,control,runtime,perimeter,ui}.md`.

## Global Constraints

- Base: `cline/cline` tag `v3.79.0`, commit `9405419efebb76a518c12daedd87a8b6cfb653b9`, Apache-2.0. Keep `LICENSE`; add `NOTICE` describing our changes. Remote `upstream` = https://github.com/cline/cline.git.
- Repo `~/prj/mycelium`, branch `main`. Large artifacts (`.vsix`, run logs, screenshots) go in `~/database/20261108_mycelium/`, never in git.
- Identity: package `name` `mycelium-coder`, `publisher` `local`, `displayName` `Mycelium`. Commands and views are prefixed `mycelium-coder.`. Global data lives in `~/.mycelium/` (override with env `MYCELIUM_DIR`). Workspace data lives in `<workspace>/.mycelium/`.
- Profiles: `tao` and `improved`. The default when `.mycelium/profile.json` is absent is `improved`.
- Do not copy TAO's code or prompt text. Every prompt and contract is written in our own words, following `docs/tao-behaviour.md` (task 5).
- The extension itself may contact only the configured model providers: no telemetry, no `*.cline.bot`, no banners, no marketplace. Traffic the agent causes through its tools is allowed and goes through normal approvals.
- Filesystem rule: never walk `~/prj`, `$HOME` or the network-mounted directories. Read known paths directly.
- Secrets live in VS Code SecretStorage only. They never appear in files, prompts, logs, metrics or the audit log.
- Tests use mocha + should with `TS_NODE_PROJECT=./tsconfig.unit-test.json`, in `src/mycelium/**/__tests__/*.test.ts`.

## Review Focus

1. **A broken or hand-edited `task_context.json`** (a crash mid-write, a manual edit, a newer `schema_version`). The task should keep running as plain Cline with a visible warning; it must not crash or lose the file. The test is in Task 6: `quarantines a corrupt file and creates a fresh context`.
2. **Providers that need strictly alternating user/assistant roles** (Anthropic and Claude Code). Placing the kernel message in front of history that also starts with a user message gives two user turns in a row and an API error. The request builder should merge them. The test is in Task 11: `never emits two consecutive messages with the same role`.
3. **`check_all.sh` missing, not executable, or hanging.** The `improved` gate should report "missing" or "timeout" quickly and never hang the task. The test is in Task 7: `reports missing script` and `kills a hanging script after the timeout`.
4. **Two tasks or two VS Code windows on one workspace.** Memory and the kernel cache must not bleed between tasks, and concurrent saves must not lose updates. Tests: Task 6 `serialises concurrent saves`, and Task 10 `caches kernels per task id`.
5. **Russian (non-ASCII) text in specs, notes, files and paths.** Hash anchors, snippets, JSON and token estimates must work. The test is in Task 10: `anchors and renders refs in files with Cyrillic content and paths`.

---

## Phase A: fork, build, isolate

### Task 1: Fork Cline v3.79.0 and build the stock extension

**Files:**
- Create: `~/prj/mycelium/` (clone), `NOTICE`, `docs/design.md`, `docs/plan.md`, `scripts/mycelium/package-vsix.sh`
- Modify: `package.json` (scripts only: `test:mycelium`, `package:vsix`)

**Interfaces:**
- Produces: `npm run package:vsix`, which writes `~/database/20261108_mycelium/builds/mycelium-<version>-<gitsha>.vsix`, and `npm run test:mycelium`, which runs only `src/mycelium/**/__tests__/*.test.ts`.

- [ ] **Step 1:** `git clone --branch v3.79.0 https://github.com/cline/cline.git ~/prj/mycelium && cd ~/prj/mycelium && git switch -c main && git remote rename origin upstream`. Verify that `git log -1 --format=%H` prints `9405419efebb76a518c12daedd87a8b6cfb653b9`.
- [ ] **Step 2:** Install Node per `.nvmrc` (`lts/*`) with `nvm install` and `nvm use`, then run `npm run install:all` and `npm run protos`. Expected: both exit 0.
- [ ] **Step 3:** Add the scripts. `test:mycelium` is `cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha 'src/mycelium/**/__tests__/*.test.ts'`. `package:vsix` runs `scripts/mycelium/package-vsix.sh`, which does `npm run package`, then `npx @vscode/vsce package --no-dependencies -o <path above>`, and prints the path.
- [ ] **Step 4:** Run `npm run package:vsix`. Expected: a `.vsix` exists at the printed path and is larger than 5 MB.
- [ ] **Step 5:** Copy the spec to `docs/design.md` and this plan to `docs/plan.md`. Write `NOTICE`: "Mycelium is a modified version of Cline (Apache-2.0) …".
- [ ] **Step 6:** Commit `chore: fork Cline v3.79.0 as Mycelium, add build scripts`.

### Task 2: Rebrand and isolate from Cline and TAO·CODER

**Files:**
- Create: `scripts/mycelium/rebrand.mjs`, `scripts/mycelium/check-hosts.mjs`, `src/mycelium/__tests__/isolation.test.ts`
- Modify: `package.json` (via the script), `src/core/storage/disk.ts` (`getClineHomePath`), `src/shared/storage/storage-context.ts` (default dir), `src/core/task/TaskLockUtils.ts`, `src/integrations/checkpoints/CheckpointLockUtils.ts`, `src/config.ts` (cloud endpoints and the `endpoints.json` path)

**Interfaces:**
- Produces: `getClineHomePath(): string`, which returns `$MYCELIUM_DIR` or `~/.mycelium`. `ExtensionRegistryInfo.id === "local.mycelium-coder"`.

- [ ] **Step 1: Write the failing tests** in `isolation.test.ts`:
  - `home path defaults to ~/.mycelium`: `getClineHomePath().should.equal(path.join(os.homedir(), ".mycelium"))` with `MYCELIUM_DIR` unset.
  - `home path honours MYCELIUM_DIR`: set `process.env.MYCELIUM_DIR="/tmp/x"`, then `getClineHomePath().should.equal("/tmp/x")`.
  - `package identity is Mycelium`: `require("../../../package.json")` has `name` `"mycelium-coder"`, `publisher` `"local"` and `displayName` `"Mycelium"`. No `contributes.commands[].command` starts with `"cline."`. No string in `contributes` contains `"claude-dev"`.
- [ ] **Step 2:** Run `npm run test:mycelium`. Expected: FAIL (the home path is `~/.cline`).
- [ ] **Step 3:** Write `rebrand.mjs`. It is idempotent and uses the same transform as Cline's `scripts/publish-nightly.mjs` `updatePackageJson`: replace `claude-dev` with `mycelium-coder` and `"cline.` with `"mycelium-coder.`, then set `publisher` and `displayName`. Run it.
- [ ] **Step 4:** Point every `~/.cline` default at `getClineHomePath()`, including the hard-coded `"~/.cline/data/..."` constants in `TaskLockUtils.ts` and `CheckpointLockUtils.ts`. In `src/config.ts`, replace the production `app/api/mcp` base URLs with `""` and make the code paths that would fetch from them return early when the URL is empty.
- [ ] **Step 5:** Write `check-hosts.mjs <bundle>`. It lists every `https?://host` found in the bundle and fails only on hosts missing from `scripts/mycelium/allowed-hosts.txt`. That file has two sections: provider hosts, and dormant hosts (strings left in libraries or in config that is now empty), each with a one-line reason. The runtime check that matters is Task 20, step 7.
- [ ] **Step 6:** Run `npm run test:mycelium`, then `npm run package:vsix && node scripts/mycelium/check-hosts.mjs dist/extension.js`. Expected: tests PASS and the host check prints `OK`.
- [ ] **Step 7:** Manual check: `code --install-extension <vsix>`. In VS Code, Cline (if installed) and Mycelium both appear with separate sidebars. `~/.mycelium/data/` is created and `~/.cline` is untouched (compare `ls -la --time-style=full-iso ~/.cline` before and after).
- [ ] **Step 8:** Commit `feat: rebrand to Mycelium and isolate storage and cloud endpoints`.

### Task 3: Secrets in VS Code SecretStorage

**Files:**
- Create: `src/mycelium/secrets/VsCodeSecretSyncStorage.ts`, `src/mycelium/secrets/__tests__/VsCodeSecretSyncStorage.test.ts`
- Modify: `src/shared/storage/storage-context.ts` (accept `secrets?: ClineSyncStorage<string>` in `StorageContextOptions`), `src/extension.ts:78` (build and pass the store)

**Interfaces:**
- Produces: `class VsCodeSecretSyncStorage extends ClineSyncStorage<string>` with `static async load(storage: vscode.SecretStorage, keys: readonly string[]): Promise<VsCodeSecretSyncStorage>`. `MYCELIUM_SECRET_KEYS: readonly string[]` holds Cline's secret keys plus `"myceliumElizaToken"`.

- [ ] **Step 1: Failing tests** (a fake `SecretStorage` backed by a `Map`):
  - `load preloads known keys` so that `get("openAiApiKey")` returns the stored value synchronously.
  - `set writes through`: after `set("k","v")` and one `await`, `fake.store` was called with `("k","v")`.
  - `delete removes from both the cache and the storage`.
  - `never touches the filesystem`: stub `fs.writeFileSync` and `fs.promises.writeFile` with sinon, then assert neither was called.
- [ ] **Step 2:** Run the tests. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the class. It keeps an in-memory `Map` cache and implements `_get/_set/_delete/_keys` from `ClineSyncStorage`, with `_set`/`_delete` firing the storage call without awaiting it and logging failures. Pass it from `extension.ts`, and skip Cline's SecretStorage→file migration for this store.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run `npm run compile`. Expected: exit 0.
- [ ] **Step 5:** Commit `feat: keep secrets in VS Code SecretStorage`.

## Phase B: the Mycelium core (pure modules)

### Task 4: Profiles and workspace paths

**Files:**
- Create: `src/mycelium/profile.ts`, `src/mycelium/paths.ts`, `src/mycelium/__tests__/profile.test.ts`

**Interfaces:**
- Produces:
  - `type ProfileId = "tao" | "improved"`
  - `interface Profile` with these fields and these values (exact):

| field | `tao` | `improved` |
|---|---|---|
| `updateCycle.trigger` | `"user_role_messages"` | `"exchanges_or_tokens"` |
| `updateCycle.batchSize` | 5 | 4 (assistant replies since last cycle) |
| `updateCycle.tokenThreshold` | — (`Infinity`) | 30000 |
| `updateCycle.includeAssistantText` | false | true |
| `updateCycle.windowTurns` | 30 (from turn 0) | unprocessed turns only |
| `history.afterCycle` | `"truncate"` | `"keep"` |
| `history.keepMessages` | 20 | — |
| `history.windowMaxTokens` | 50000 | 50000 |
| `notes.dropPathMentions` / `notes.resolveDeletes` | true / true | false / false |
| `kernel.feedBudgeted` | false | true |
| `kernel.snippetSelection` | `"oldest"` | `"recent"` |
| `kernel.cacheBetweenCycles` | true | false |
| `kernel.planInKernel` | false | true |
| `kernel.maxSnippets` / `maxSnippetLines` / `hotBudgetTokens` | 25 / 150 / 50000 | 25 / 150 / 50000 |
| `stages.allowSkip` | true | false (skip asks the owner) |
| `stages.gate` | `"no_false"` | `"all_true"` |
| `stages.checkAllVerifiedByExtension` | false | true |
| `stages.evidenceAlwaysValidated` | false | true |
| `stages.confirmFlagsEffective` | false | true |
| `stages.leaveAuditAsksOwner` | false | true |
| `commands.classifyAllSegments` | false | true |
| `commands.interpretersSafe` | true | false |
| `commands.autoApproveAllRunsBlacklisted` | true (except `rm`, `git checkout --`) | false |
| `files.largeRewriteLines` / `files.truncationGuard` | 300 / false | 300 / true (0.5) |
| `aux.countRepairOnlyWhenApplied` / `countMigration` / `announce` | true / false / false | false / true / true |

  - `getProfile(id: ProfileId): Profile`, `async resolveProfile(cwd: string, taskOverride?: ProfileId): Promise<Profile>`
  - `paths.ts`: `myceliumDir(cwd)`, `taskDir(cwd, taskId)`, `checkRunsDir(cwd)`, `screenshotsDir(cwd, taskId)`, `profileFile(cwd)`, `nextTaskFile(cwd)`, `commandRulesFile(cwd)`, `modelsFile(cwd)`, `indexFile(cwd)`

- [ ] **Step 1: Failing tests:**
  - `defaults to improved without profile.json`.
  - `reads profile.json {"profile":"tao"}`.
  - `task override wins`.
  - `tao and improved differ exactly in the documented fields`: snapshot-compare `TAO_PROFILE` and `IMPROVED_PROFILE` against the table.
  - `invalid profile.json falls back to improved and reports a warning`.
- [ ] **Step 2:** Run `npm run test:mycelium`. Expected: FAIL.
- [ ] **Step 3:** Implement. `profile.json` is `{ "profile": ProfileId, "defaultMode"?: ModeId }`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mycelium): profiles and workspace paths`.

### Task 5: Behaviour document, modes, stages and tool policy

**Files:**
- Create: `docs/tao-behaviour.md`, `src/mycelium/modes/pipelines.ts`, `src/mycelium/modes/contracts.ts`, `src/mycelium/modes/toolPolicy.ts`, `src/mycelium/modes/__tests__/pipelines.test.ts`, `src/mycelium/modes/__tests__/toolPolicy.test.ts`

**Interfaces:**
- Produces:
  - `type ModeId = "architect" | "developer" | "debug" | "free"`
  - `type StageId`, the union of:
    - Architect: `architecture_discussion`, `architecture_doc_product_concept`, `architecture_doc_target_audience`, `architecture_doc_design_system`, `architecture_doc_architecture`, `architecture_doc_check_all`, `architecture_doc_roadmap`, `architecture_doc_decisions`, `architecture_doc_readme_ai`.
    - Developer: `clarification`, `data_collection`, `development`, `audit`, `rework`, `report`.
    - Debug: `debug_setup`, `debug_environment`, `debug_execution`, `debug_fix`, `debug_validation`.
    - Free: `execution`.
  - `PIPELINES: Record<ModeId, StageId[]>`. `rework` is outside the Developer list; Free is `["execution"]`.
  - `STAGES: Record<StageId, { contract: string; exitCriteria: Record<string,string>; autoPlan: string[]; allow: ReadonlySet<string>; requireConfirm: ReadonlySet<string>; completion: boolean }>`
  - `MYCELIUM_TOOLS = ["myc_set_stage","myc_update_task_spec","myc_add_code_ref","myc_add_note","myc_add_note_comment","myc_update_plan","myc_update_exit_criteria","myc_update_acceptance_criteria","myc_create_handoff"] as const`
  - `evaluateToolPolicy(mode: ModeId, stage: StageId, tool: string, profile: Profile): { decision: "allow" | "deny" | "confirm"; message?: string; allowedIn: StageId[] }`

- [ ] **Step 1: Write `docs/tao-behaviour.md`.** Sources are `analysis/code/control.md`, `analysis/code/memory.md`, `analysis/code/runtime.md`, plus the TAO chunks in `~/database/20261107_cntr_proof_site/code/novel_ext/chunks/` (`18_*`, `19_*`, `02_*`, `00_*`). Use `scripts/code/show.mjs` from `~/prj/cntr` for context. For each stage, record in our own words: goal, allowed and forbidden activities, exit-criteria keys with one-line meanings, auto-plan items, the tool allowlist, the `requireConfirm` list, and whether completion is allowed. Also cover:
  - the built-in command black and white lists (as patterns, with the `\b(shutdown|reboot|halt|poweroff|init)\b` grouping fixed);
  - the kernel sections;
  - the extractor rules;
  - the repair triggers;
  - migration selection rules.

  No sentence may be copied from TAO strings. Commit this file on its own: `docs: TAO behaviour specification in our own words`.
- [ ] **Step 2: Failing tests:**
  - `every pipeline stage has a non-empty contract, at least 2 exit criteria and an allowlist`.
  - `developer stage tool table matches the documented table`. Edit files: only `development`, `rework`. Run commands: allowed in `development`, `rework`; confirm in `clarification`, `data_collection`, `audit`; denied in `report`. Completion: only `report`.
  - `development exit criteria include check_all_passed, tests_added, implementation_done`.
  - `disallowed tool message names the allowing stages`, e.g. `evaluateToolPolicy("developer","data_collection","write_to_file",P).message` contains `development`.
  - `tao reports confirm-flagged tools as allow`, `improved reports them as confirm`.
  - `free mode allows everything except myc_set_stage`.
  - `every myc_* tool is allowed in every stage except myc_set_stage in free`.
- [ ] **Step 3:** Run the tests. Expected: FAIL.
- [ ] **Step 4:** Implement `pipelines.ts` and `contracts.ts` as data taken from the behaviour document, and `evaluateToolPolicy` as a pure lookup. The `confirm` decision is returned only when `profile.stages.confirmFlagsEffective`.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit `feat(mycelium): modes, stages and tool policy`.

### Task 6: Task Context schema and store

**Files:**
- Create: `src/mycelium/store/schema.ts`, `src/mycelium/store/TaskContextStore.ts`, `src/mycelium/store/audit.ts`, `src/mycelium/store/__tests__/TaskContextStore.test.ts`

**Interfaces:**
- Consumes: `paths.ts`, `ModeId`, `StageId`, `PIPELINES`, `STAGES` (initial exit criteria and auto-plan).
- Produces:
  - `interface TaskContext` with these fields:
    - identity and state: `schema_version: 1`, `task_id`, `cline_task_id`, `previous_task_id?`, `profile: ProfileId`, `mode: ModeId`, `stage: StageId`, `status: "active"|"done"`, `created_at`, `updated_at`;
    - stage tracking: `stage_history: {from,to,at,reason,evidence_ids,actor:"agent"|"owner"|"extension"}[]`, `exit_criteria: Record<string,boolean>`;
    - task content: `task: {spec: string; acceptance_criteria: string[]; constraints: string[]; plan: {id,text,status:"todo"|"next"|"in_progress"|"done"}[]}`, `ac_rounds: {at, items:{index,status:"pass"|"fail"|"skip"|"pending",comment?}[]}[]`;
    - memory: `refs: CodeRef[]`, `notes: Note[]`, `changes: {id,summary,diff_path?,at_turn}[]`, `user_notes: string[]`;
    - cycle and repair state: `update_cycle: {processed_until: number, turn_counter: number, pending_force: boolean}`, `repair: {pending_since_turn?: number}`, `migration: {ingested_at?: string}`;
    - `execution_log: {at, kind, detail}[]`;
    - `metrics: TaskMetrics`.
  - `CodeRef = {id, path, start_line, end_line, sha256, why, at_turn, stale: boolean, resolved: boolean}`
  - `Note = {id, text, tags: ("hypothesis"|"decision"|"negative_knowledge"|"info"|"user_message")[], at_turn, hidden: boolean, resolved: boolean, comments: {text, at}[]}`
  - `class TaskContextStore`:
    - `constructor(cwd: string)`
    - `create(args:{clineTaskId, mode, profile, previousTaskId?}): Promise<TaskContext>`
    - `load(taskId): Promise<TaskContext>`
    - `findByClineTask(clineTaskId): Promise<TaskContext|undefined>`
    - `update(taskId, fn:(c:TaskContext)=>TaskContext|void): Promise<TaskContext>` (locked, atomic)
    - `snapshot(taskId, reason): Promise<string>`, `rollback(taskId, snapshotId): Promise<TaskContext>`
    - `listTasks(): Promise<TaskContext[]>`
  - Shared types used by later tasks (defined here, in `schema.ts`):
    - `interface CheckRun { started_at: string; duration_ms: number; exit_code: number | null; status: "passed" | "failed" | "missing" | "timeout"; log_path?: string; source: "extension" | "agent_command"; command: string }`
    - `type CallType = "agent" | "update_cycle" | "repair" | "handover" | "migration"`
    - `interface Bucket { count; tokens_in; tokens_out; cache_read; cache_write; cost_usd; model_ms }`
    - `interface TaskMetrics { by_type: Record<CallType, Bucket>; by_stage: Record<string, Bucket>; uncounted_in_profile_view: Record<CallType, Bucket>; wall_ms: number; tool_ms: number; check_runs: CheckRun[]; started_at; ended_at? }`
  - Task ids look like `t_<YYYYMMDDHHmmss>_<6 hex>`.
  - `appendAudit(cwd, taskId, event: string, data?: object): Promise<void>` writes to `audit.jsonl`.

- [ ] **Step 1: Failing tests** (temp directory per test):
  - `create seeds stage, exit criteria (all false) and auto-plan from STAGES`.
  - `update is atomic`: after an `update`, no `*.tmp` remains, and the file parses.
  - `serialises concurrent saves`: 20 parallel `update` calls, each incrementing a counter, end at 20.
  - `quarantines a corrupt file and creates a fresh context`: write `{`, call `load`, and expect the file renamed to `task_context.corrupt.<ts>.json`, a fresh context returned, and an audit event `context_quarantined`.
  - `refuses unknown schema_version without overwriting it`: rename to `task_context.v2.<ts>.json`.
  - `snapshot and rollback restore the exact content`.
  - `findByClineTask uses index.json`.
  - `audit appends one JSON line per event`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Writes go to `<file>.<pid>.tmp`, then `rename`. Locking is an in-process async mutex per task id, plus a lock file `<taskDir>/.lock` (pid:timestamp, stale after 10 s) for cross-window safety.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mycelium): task context store`.

### Task 7: `check_all.sh` runner and detector

**Files:**
- Create: `src/mycelium/gate/checkAll.ts`, `src/mycelium/gate/__tests__/checkAll.test.ts`

**Interfaces:**
- Consumes: `CheckRun` from `src/mycelium/store/schema.ts` (Task 6).
- Produces:
  - `runCheckAll(cwd: string, opts?: { timeoutMs?: number }): Promise<CheckRun>`. The default timeout is 900000 ms. It looks for `check_all.sh` in the workspace root, then `scripts/`. It runs `bash <script>` with `cwd`, writes `.mycelium/check_runs/<ts>.log`, and copies it to `latest.log`.
  - `isCheckAllCommand(command: string): boolean`
  - `recordObservedRun(cwd, command, exitCode: number | undefined, output: string): Promise<CheckRun>` (source `agent_command`)

- [ ] **Step 1: Failing tests** (temp directory):
  - `passes on exit 0`, `fails on exit 1 with the log saved`.
  - `reports missing script`.
  - `kills a hanging script after the timeout`: `sleep 30` with `timeoutMs: 300` gives status `timeout` in under 2 s.
  - `isCheckAllCommand` matches `bash check_all.sh`, `./check_all.sh`, `cd app && bash scripts/check_all.sh`. It does not match `cat check_all.sh` or `vim check_all.sh`.
  - `log never contains values of env vars named *TOKEN*/*KEY*`: run a script that echoes `$ELIZA_TOKEN` with the env set, and expect the log to show `***`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement with `child_process.spawn` (process group, so the whole tree is killed with SIGTERM and then SIGKILL after 5 s). Mask any env value whose name matches `/TOKEN|KEY|SECRET|PASSWORD/i` in the saved log.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mycelium): check_all runner and detector`.

### Task 8: Stage gate

**Files:**
- Create: `src/mycelium/gate/stageGate.ts`, `src/mycelium/gate/__tests__/stageGate.test.ts`

**Interfaces:**
- Consumes: `TaskContext`, `CheckRun` (Task 6 schema), `Profile`, `PIPELINES`, `STAGES`; `runCheckAll` (Task 7) is injected through `GateDeps`.
- Produces:
  - `type TransitionRequest = { to?: StageId; reason: string; evidence: { refs?: string[]; notes?: string[]; changes?: string[] } | string[]; back?: boolean }`
  - `interface GateDeps { runCheckAll(): Promise<CheckRun>; askOwner(question: string): Promise<boolean> }`
  - `validateTransition(ctx, req, profile, deps): Promise<{ ok: true; to: StageId; checkRun?: CheckRun } | { ok: false; error: string }>`
  - `applyTransition(ctx, to: StageId, req, actor): TaskContext` is pure. It pushes `stage_history`, sets the target stage's criteria to false and replaces the plan with the target's auto-plan.

- [ ] **Step 1: Failing tests** (fake deps):
  - `requires reason and evidence` (both profiles).
  - `tao: allows skipping to any pipeline stage`. `improved: skipping forward asks the owner and fails if refused`.
  - `improved: back requires back=true and a reason`.
  - `tao: blocks only on criteria explicitly false; missing keys pass`. `improved: every criterion must be true`.
  - `tao: array evidence is not validated; object evidence ids must exist`. `improved: unknown ids fail in both forms`.
  - `improved: check_all_passed is set by running check_all, and a failed run blocks with the log path in the error`. `tao: runCheckAll is never called`.
  - `leaving audit requires a verdict with a comment for every AC` (both). `entering report requires every AC = pass` (both).
  - `improved: leaving audit asks the owner`. `tao: never asks`.
  - `rework is a valid target only from audit in developer mode`.
  - `free mode rejects transitions`.
  - `applyTransition resets target criteria and records history`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. In `tao`, exempt `check_all_passed`, `*_reviewed` and `ac_statuses_updated` when the target is `rework`. In `improved`, exempt only `*_reviewed`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mycelium): stage gate`.

### Task 9: Command safety

**Files:**
- Create: `src/mycelium/safety/commandSafety.ts`, `src/mycelium/safety/__tests__/commandSafety.test.ts`

**Interfaces:**
- Produces:
  - `type CommandClass = "safe" | "dangerous" | "requires_approval" | "unknown"`
  - `interface CommandRules { whitelist: string[]; blacklist: string[]; require_approval: string[] }` (globs). They load from `.mycelium/command_safety.json` via `loadCommandRules(cwd)`.
  - `classifyCommand(command: string, rules: CommandRules, profile: Profile): CommandClass`
  - `decideCommand(cls: CommandClass, command: string, auto: { safe: boolean; all: boolean }, profile: Profile): "run" | "ask"`
  - `splitSegments(command: string): string[]` splits on unquoted `;`, `&&`, `||`, `|` and newlines.

- [ ] **Step 1: Failing tests:**
  - Order of checks: user blacklist → built-in blacklist → user require_approval → user whitelist → built-in whitelist → unknown. A user whitelist entry does not override the built-in blacklist.
  - `tao: whitelist checks the first segment only`: `ls && rm -rf x` is dangerous (the blacklist sees the whole string), but `ls && curl x` is safe. `improved: every segment classified`, so `ls && curl x` is unknown.
  - `tao: python3 script.py is safe`, `improved: unknown`.
  - `git init and npm init are not dangerous` (both).
  - Under `decideCommand` with `auto.all = true`, `tao` gives `sudo apt update` "run" and `rm -rf build` "ask", while `improved` gives "ask" for both.
  - `safe runs only when auto.safe`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement with the lists from `docs/tao-behaviour.md`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mycelium): command safety classifier`.

### Task 10: Kernel renderer and snippets

**Files:**
- Create: `src/mycelium/kernel/renderKernel.ts`, `src/mycelium/kernel/snippets.ts`, `src/mycelium/kernel/KernelCache.ts`, `src/mycelium/prompts/kernelText.ts`, `src/mycelium/kernel/__tests__/kernel.test.ts`

**Interfaces:**
- Consumes: `TaskContext`, `Profile`, `STAGES[stage].contract`.
- Produces:
  - `estimateTokens(text: string): number`, defined as `Math.ceil(text.length / 4)`.
  - `selectSnippetRefs(refs: CodeRef[], profile: Profile): CodeRef[]`. `oldest` takes the first `maxSnippets` non-resolved refs in insertion order. `recent` sorts by `at_turn` descending.
  - `readSnippet(cwd: string, ref: CodeRef, maxLines: number): Promise<{ ref: CodeRef; text: string; broken: boolean; hashMatches: boolean }>`
  - `anchorHash(lines: string[]): string` (sha256 of the joined lines)
  - `interface KernelInputs { readmeAi?: string; recentTasks: string[]; snippets: Awaited<ReturnType<typeof readSnippet>>[]; systemInfo: string }`
  - `renderKernel(ctx: TaskContext, inputs: KernelInputs, profile: Profile): string`. Section order: header → feed → stage/spec/AC/constraints → (plan, `improved` only) → system info → README_AI → recent tasks → ALGORITHM → stage contract → exit criteria → legend.
  - `class KernelCache { get(taskId, key): string | undefined; set(taskId, key, text): void; invalidate(taskId): void }`
  - `kernelText.ts` holds the header, ALGORITHM ("every reply must be exactly one tool call", in our words) and the legend.

- [ ] **Step 1: Failing tests:**
  - `section order` for each profile.
  - `tao: feed is never trimmed even beyond the budget; later sections are dropped first`. `improved: feed trimmed oldest-first to stay within hotBudgetTokens*4 chars, fixed sections kept`.
  - `tao picks the 25 oldest refs, improved the 25 most recent`.
  - `plan appears in the kernel only for improved`.
  - `caches kernels per task id`: two task ids, so `get` never returns the other task's text.
  - `anchors and renders refs in files with Cyrillic content and paths`: a file at `тест/файл.md` with Russian lines gives a stable `anchorHash` and a snippet that contains the Russian text intact.
  - `broken ref` (missing file) is rendered as `[BROKEN]`. `hash mismatch` sets `hashMatches=false`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mycelium): kernel renderer`.

### Task 11: Request builder and history policy

**Files:**
- Create: `src/mycelium/kernel/buildRequest.ts`, `src/mycelium/kernel/__tests__/buildRequest.test.ts`

**Interfaces:**
- Consumes: `renderKernel`, `KernelCache`, `estimateTokens`, Cline's `ClineStorageMessage` (`src/shared/messages/content.ts`).
- Produces:
  - `buildRequestMessages(args: { history: ClineStorageMessage[]; kernel: string; tail?: string; profile: Profile }): ClineStorageMessage[]`. It returns the kernel, then a window of history that fits in `windowMaxTokens` and keeps tool_use/tool_result pairs, then the tail (`tao` only: the plan plus "changes since kernel").
  - `historyAfterCycle(history: ClineStorageMessage[], profile: Profile): ClineStorageMessage[]`. `tao` keeps the last 20 messages, starting at a user message. `improved` returns `history` unchanged.

- [ ] **Step 1: Failing tests:**
  - `never emits two consecutive messages with the same role`. The kernel is merged into the first user message as a leading text block when the history starts with a user message.
  - `window drops from the front until under windowMaxTokens and never splits a tool_use from its tool_result`.
  - `tao tail carries the plan; improved has no tail`.
  - `tao truncates to 20 starting at a user turn`, `improved keeps everything`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mycelium): request builder and history policy`.

### Task 12: Model caller and update-cycle

**Files:**
- Create: `src/mycelium/llm/LlmCaller.ts`, `src/mycelium/memory/updateCycle.ts`, `src/mycelium/prompts/extractorPrompt.ts`, `src/mycelium/memory/__tests__/updateCycle.test.ts`, `src/mycelium/llm/__tests__/LlmCaller.test.ts`

**Interfaces:**
- Consumes: `TaskContextStore`, `Profile`, Cline's `ApiHandler` (`src/core/api/index.ts`).
- Produces:
  - `interface LlmResult { text: string; usage: { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd?: number }; durationMs: number }`
  - `interface LlmCaller { call(system: string, user: string): Promise<LlmResult> }`
  - `apiHandlerCaller(api: ApiHandler): LlmCaller` consumes the `ApiStream` and sums the text and usage chunks.
  - `shouldRunUpdateCycle(history: ClineStorageMessage[], ctx: TaskContext, profile: Profile): boolean`
  - `buildExtractorInput(history, ctx, profile): string` (the formatted transcript is capped at 60000 chars)
  - `type ExtractorDelta = { add_refs: {path,start_line,end_line,why}[]; add_notes: {text,tags}[]; add_comments: {note_id,text}[]; plan_status: {id,status}[]; resolve: {kind:"ref"|"note", id}[] }`
  - `parseExtractorOutput(text: string): ExtractorDelta | { error: string }`. It accepts a fenced ```json block or the outermost `{}`.
  - `applyExtractorDelta(ctx, delta, profile, turn: number): TaskContext`
  - `runUpdateCycle(deps: { store: TaskContextStore; taskId: string; history: ClineStorageMessage[]; caller: LlmCaller; profile: Profile; cwd: string }): Promise<{ ran: boolean; applied: boolean; result?: LlmResult; error?: string }>`. Order of operations: run the extraction, take a snapshot, merge, advance the cursor.

- [ ] **Step 1: Failing tests** (fake caller and synthetic histories):
  - `tao triggers after 5 user-role messages including tool results`. `improved triggers after 4 assistant replies or 30000 history tokens`.
  - `tao extractor input omits assistant text, improved includes it`. `tao window starts at turn 0 (max 30), improved only unprocessed`.
  - `parses fenced and bare JSON; malformed → error, cursor unchanged, no snapshot`.
  - `tao drops notes that mention a file path, improved keeps them`. `tao resolve deletes a note, improved marks resolved`.
  - `refs dedup by path+lines; repeated ref updates why and at_turn`.
  - `snapshot is taken before merge`: the audit order is `snapshot` then `update_cycle_applied`.
  - `apiHandlerCaller sums usage across chunks`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Write the extractor prompt in our own words, following the extractor rules in `docs/tao-behaviour.md`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mycelium): update-cycle`.

### Task 13: Repair planner and knowledge migration

**Files:**
- Create: `src/mycelium/memory/repairPlanner.ts`, `src/mycelium/memory/migration.ts`, `src/mycelium/prompts/repairPrompt.ts`, `src/mycelium/prompts/migrationPrompt.ts`, `src/mycelium/memory/__tests__/repairMigration.test.ts`

**Interfaces:**
- Consumes: `LlmCaller`, `TaskContextStore`, `Profile`.
- Produces:
  - `type PlanProblem = "empty_plan" | "all_done" | "no_in_progress" | "multiple_in_progress" | "empty_spec" | "empty_acceptance" | "empty_constraints"`
  - `detectPlanProblems(ctx: TaskContext): PlanProblem[]`
  - `runRepairIfDue(deps: { store; taskId; caller; profile; turn: number }): Promise<{ ran: boolean; applied: boolean; result?: LlmResult }>`. It records `pending_since_turn` on first detection and runs only if the problem persists 2 turns later.
  - `runMigrationIfNeeded(deps: { store; taskId; caller; profile; lastUserMessages: string[] }): Promise<{ ran: boolean; result?: LlmResult }>`. The source is the `previous_task_id` task, else the newest unconsumed `.mycelium/handoffs/*.json`.

- [ ] **Step 1: Failing tests:**
  - Each `PlanProblem` is detected.
  - `repair waits 2 turns`.
  - `repair applies plan/spec changes from JSON`.
  - `migration copies selected refs and notes and marks ingested_at; runs once`.
  - `malformed migration JSON still marks ingested`, but in `improved` it also returns `error` for the UI.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mycelium): repair planner and knowledge migration`.

### Task 14: Metrics and workspace summary

**Files:**
- Create: `src/mycelium/metrics/metrics.ts`, `src/mycelium/metrics/aggregate.ts`, `scripts/mycelium/summarize.ts`, `src/mycelium/metrics/__tests__/metrics.test.ts`

**Interfaces:**
- Consumes: `CallType`, `Bucket`, `TaskMetrics`, `CheckRun` (Task 6 schema), `LlmResult` (Task 12).
- Produces:
  - `recordCall(ctx, { type, stage, result: LlmResult, counted: boolean }): TaskContext`
  - `addToolTime(ctx, ms)`, `addCheckRun(ctx, run)`, `finishTask(ctx, at)`
  - `profileView(m: TaskMetrics): Bucket`, which totals counted calls only, and `allCallsView(m): Bucket`
  - `aggregateWorkspace(cwd: string): Promise<WorkspaceSummary>`. `WorkspaceSummary` holds the profile, tasks, per-type and per-stage totals, wall time, model time, check-run pass rate, and stage histories.
  - `scripts/mycelium/summarize.ts <workspace> [--html <out>] [--json <out>]` (run with `npx tsx`).

- [ ] **Step 1: Failing tests:**
  - `counted=false lands in uncounted_in_profile_view and not in profileView`.
  - `by_stage attributes calls to the stage at call time`.
  - `aggregate sums tasks and reports both views`.
  - `summary HTML lists check runs with real exit codes`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. The HTML is a single static file with tables; no external assets.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mycelium): metrics and workspace summary`.

### Task 15: Agent tools (`myc_*`)

**Files:**
- Create: `src/mycelium/tools/specs.ts`, `src/mycelium/tools/handlers.ts`, `src/mycelium/tools/__tests__/handlers.test.ts`
- Create: `src/mycelium/runtime/types.ts`
- Modify: `src/shared/tools.ts` (add the nine `MYC_*` enum members with the names in `MYCELIUM_TOOLS`), `src/core/prompts/system-prompt/tools/index.ts` (register the specs), `src/core/task/tools/ToolExecutorCoordinator.ts` (register the handlers), `src/core/task/tools/types/TaskConfig.ts` (add `getMycelium?: () => MyceliumHooks | undefined` to `TaskConfig`)

**Interfaces:**
- Consumes: `TaskContextStore`, `validateTransition`/`applyTransition`, `runCheckAll`, `Profile`.
- Produces:
  - `MYCELIUM_TOOL_SPECS: ClineToolSpec[]`, one generic variant each, with parameters:
    - `myc_set_stage(to_stage?, reason, evidence, back?)`
    - `myc_update_task_spec(spec?, acceptance_criteria?, constraints?)`
    - `myc_add_code_ref(path, start_line, end_line, why)`
    - `myc_add_note(text, tags)`
    - `myc_add_note_comment(note_id, text)`
    - `myc_update_plan(items | item_id+status)`
    - `myc_update_exit_criteria(criteria: JSON map)`
    - `myc_update_acceptance_criteria(statuses: JSON list)`
    - `myc_create_handoff(summary)`
  - `interface MyceliumHooks` in `runtime/types.ts`: `{ cwd: string; taskId: string; profile: Profile; store: TaskContextStore; gateDeps(): GateDeps; checkToolCall(name: string): ReturnType<typeof evaluateToolPolicy>; onCommandFinished(command: string, exitCode: number | undefined, output: string): Promise<void>; onToolFinished(ms: number): Promise<void> }`. Task 16's runtime implements it.
  - `createMyceliumHandlers(): IToolHandler[]`. Handlers get the hooks through `config.getMycelium?.()`.

- [ ] **Step 1: Failing tests** (temp store and a fake `MyceliumHooks`):
  - `set_stage success returns "Stage transition: A → B" and persists history`.
  - `set_stage failure returns the gate error verbatim and leaves state unchanged`.
  - `improved: update_exit_criteria refuses check_all_passed with a message telling the agent the extension sets it`. `tao: accepts it`.
  - `add_code_ref computes the sha256 anchor from the file`.
  - `update_acceptance_criteria appends a round; latest status per index wins`.
  - `create_handoff writes .mycelium/handoffs/<task_id>.json with spec, AC, refs, decisions, notes`.
  - `handlers return a tool error, not throw, when no Mycelium context is attached`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement and register. Tool descriptions are in our own words.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run `npm run compile`. Expected: exit 0.
- [ ] **Step 5:** Commit `feat(mycelium): agent tools`.

## Phase C: wiring into Cline

### Task 16: Runtime facade and request hooks

**Files:**
- Create: `src/mycelium/runtime/MyceliumTaskRuntime.ts`, `src/mycelium/runtime/__tests__/runtime.test.ts`
- Modify:
  - `src/core/task/index.ts`: in `attemptApiRequest` (around lines 2004–2025), at the place where stream usage is final in `recursivelyMakeClineRequests`, and at task start and resume;
  - `src/core/prompts/system-prompt/types.ts`: add `toolFilter?: (toolId: string) => boolean` to `SystemPromptContext`;
  - `src/core/prompts/system-prompt/registry/ClineToolSet.ts`: apply `toolFilter` in `getEnabledToolSpecs` and `getNativeTools`.

**Interfaces:**
- Consumes: everything in Phase B.
- Produces:
  - `class MyceliumTaskRuntime implements MyceliumHooks` with these members, in addition to the `MyceliumHooks` members:
    - `static async attach(args: { cwd: string; clineTaskId: string; isResume: boolean; mainApi: ApiHandler }): Promise<MyceliumTaskRuntime | undefined>`. It returns `undefined` when the workspace has no `.mycelium/` directory and no pending `next_task.json`, so stock Cline behaviour is kept.
    - `readonly taskId: string`, `readonly profile: Profile`, `mode(): ModeId`, `stage(): StageId`
    - `toolFilter(): (toolId: string) => boolean`
    - `beforeRequest(history: ClineStorageMessage[]): Promise<{ messages: ClineStorageMessage[]; replaceStoredHistory?: ClineStorageMessage[]; notices: string[] }>`. In order: increment the turn counter, run migration, run the update-cycle, apply the history policy, check repair, render or reuse the kernel, build the messages.
    - `afterAgentCall(result: { usage: LlmResult["usage"]; durationMs: number }): Promise<void>`
    - `onTaskCompleted(): Promise<void>`
  - In `Task`: `private mycelium?: MyceliumTaskRuntime` and `getMycelium(): MyceliumTaskRuntime | undefined`. `ToolExecutor.asToolConfig()` sets `getMycelium` on the `TaskConfig` from it.
  - Mode selection: `.mycelium/next_task.json` `{ mode: ModeId, profile?: ProfileId }` is consumed by `attach`. Otherwise `profile.json.defaultMode` is used, else `"developer"`.

- [ ] **Step 1: Failing tests** (fake API caller, temp workspace):
  - `attach returns undefined in a workspace without .mycelium`.
  - `attach consumes next_task.json and creates a context in that mode`.
  - `resume finds the existing context by cline task id`.
  - `beforeRequest runs the update-cycle on trigger and returns replaceStoredHistory only for tao`.
  - `beforeRequest notices include update-cycle/repair/migration runs for improved only`.
  - `toolFilter hides write tools in data_collection`.
  - `afterAgentCall records an agent call under the current stage`.
  - `failure to load context in improved yields a notice; in tao it is silent; neither throws`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the runtime. Wire the hooks:
  - In `attemptApiRequest`: `promptContext.toolFilter = this.mycelium?.toolFilter()`.
  - After `getNewContextMessagesAndMetadata`: if `this.mycelium` is set, call `beforeRequest(this.messageStateHandler.getApiConversationHistory())`. If `replaceStoredHistory` is set, overwrite and save the API history through `messageStateHandler`. Show each notice with `this.say("info", …)`. Pass `messages` to `createMessage` instead of `truncatedConversationHistory`.
  - Where the stream's final usage is known, call `afterAgentCall`.
  - When the runtime is active, do not run Cline's own auto-condense or context truncation.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run `npm run compile` and `npm run test:unit`. Expected: exit 0, with the existing Cline tests still passing.
- [ ] **Step 5:** Commit `feat(mycelium): runtime and request hooks`.

### Task 17: Executor, command and file-write hooks

**Files:**
- Modify:
  - `src/core/task/ToolExecutor.ts` (`execute()`, before `coordinator.execute`);
  - `src/core/task/tools/handlers/ExecuteCommandToolHandler.ts` (the approval decision around lines 196–251, and completion);
  - `src/core/task/tools/handlers/WriteToFileToolHandler.ts`.
- Create: `src/core/task/__tests__/ToolExecutor.mycelium.test.ts`, `src/core/task/tools/handlers/__tests__/ExecuteCommandToolHandler.mycelium.test.ts`, `src/core/task/tools/handlers/__tests__/WriteToFileToolHandler.mycelium.test.ts`

**Interfaces:**
- Consumes: `MyceliumTaskRuntime.checkToolCall`, `classifyCommand`/`decideCommand`/`loadCommandRules`, `isCheckAllCommand`/`recordObservedRun`, `Profile.files`.

- [ ] **Step 1: Failing tests** (follow the stubbing style of `ToolExecutor.test.ts`):
  - `blocked tool returns an error naming the allowed stages and increments consecutiveMistakeCount; 5 repeats hit the mistake limit`.
  - `improved: confirm decision forces an approval even when auto-approve covers the tool`. `tao: no extra approval`.
  - `command handler asks for a blacklisted command under auto-approve-all in improved, runs it in tao` (with `rm` asking in both).
  - `observed check_all run is recorded with its exit code`.
  - `write_to_file on an existing 301-line file asks for approval unless auto-approve`. `improved denies content under 50% of the original with a clear message`. `tao allows it`.
  - `with no Mycelium runtime the handlers behave exactly as before`: the existing tests still pass.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the hooks. `ToolExecutor` and the handlers reach the runtime through `config.getMycelium?.()` (added in Tasks 15 and 16).
- [ ] **Step 4:** Run the tests, then `npm run test:unit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mycelium): executor, command and write hooks`.

### Task 18: Model routing and Eliza

**Files:**
- Create: `src/mycelium/llm/routing.ts`, `src/mycelium/llm/eliza.ts`, `src/mycelium/llm/__tests__/routing.test.ts`
- Modify: `src/mycelium/runtime/MyceliumTaskRuntime.ts` (auxiliary caller), `src/core/task/index.ts` (main API override at attach)

**Interfaces:**
- Produces:
  - `type RouteSpec = { kind: "cline" } | { kind: "eliza"; model: string }`
  - `.mycelium/models.json` `{ main: RouteSpec; aux?: RouteSpec }`. The default is main `cline` and aux equal to main.
  - `~/.mycelium/eliza.json` `{ baseUrl: string; format: "openai" | "anthropic"; authHeader: string; authScheme: string }`, which holds no secrets.
  - `buildElizaHandler(cfg, model: string, token: string): ApiHandler` reuses Cline's `OpenAiHandler` (`openAiBaseUrl`, `openAiHeaders`) or `AnthropicHandler` (`anthropicBaseUrl` plus the header).
  - `resolveRoutes(cwd, mainApi, secrets): Promise<{ main: ApiHandler; aux: LlmCaller }>`

- [ ] **Step 1:** Read the owner's private Eliza notes. Record the base URL, wire format, auth header and scheme, and model names in the private Eliza notes, with no token.
- [ ] **Step 2: Failing tests:**
  - `default routes use the Cline API for both`.
  - `eliza route builds a handler with baseUrl and the auth header taken from the secret, never from settings`.
  - `missing token gives a clear error naming the command "Mycelium: Configure Eliza"`.
  - `models.json is identical-model friendly`: two workspaces with the same file resolve to the same model ids.
- [ ] **Step 3:** Run the tests. Expected: FAIL.
- [ ] **Step 4:** Implement. The token is read from the secret `myceliumElizaToken`.
- [ ] **Step 5:** Run the tests. Expected: PASS. Then manually, with a real token: run one Developer turn with main = `eliza` and one with main = the Claude Code provider. Both answer with a tool call. Record the outcome in the private Eliza notes.
- [ ] **Step 6:** Commit `feat(mycelium): model routing and Eliza`.

### Task 19: Commands, status bar, Cockpit and screenshots

**Files:**
- Create: `src/mycelium/vscode/commands.ts`, `src/mycelium/vscode/statusBar.ts`, `src/mycelium/cockpit/CockpitPanel.ts`, `src/mycelium/cockpit/cockpitHtml.ts`, `src/mycelium/cockpit/messages.ts`, `src/mycelium/screenshots.ts`, `src/mycelium/cockpit/__tests__/messages.test.ts`, `src/mycelium/__tests__/screenshots.test.ts`
- Modify: `src/extension.ts` (register), `package.json` (`contributes.commands`), `src/core/task/tools/handlers/BrowserToolHandler.ts` (after `browserActionResult` is available)

**Interfaces:**
- Produces these commands (titles in quotes):
  - `mycelium-coder.newTask` ("Mycelium: New Task…"): a QuickPick of the mode (and an optional profile override). It writes `next_task.json`, then runs `ExtensionRegistryInfo.commands.PlusButton`.
  - `mycelium-coder.setProfile` ("Mycelium: Set Workspace Profile…") writes `profile.json`.
  - `mycelium-coder.openCockpit` ("Mycelium: Open Cockpit").
  - `mycelium-coder.summarize` ("Mycelium: Summarize Workspace") writes the summary HTML to `.mycelium/summary.html` and opens it.
  - `mycelium-coder.configureEliza` ("Mycelium: Configure Eliza…") asks for the base URL, format and token. The token goes to SecretStorage; the rest goes to `eliza.json`.
- Status bar text: `Mycelium · <profile> · <mode>/<stage>`. Clicking it opens the Cockpit.
- `handleCockpitMessage(store: TaskContextStore, msg: CockpitMessage): Promise<CockpitState>`. Messages:
  - `load`;
  - `editSpec`, `editAcceptance`, `editConstraints`, `editPlan`;
  - `toggleExitCriterion`. In `improved`, `check_all_passed` is read-only.
  - `snapshot`, `rollback`.
- `saveScreenshot(cwd, taskId, dataUrl: string, action: string): Promise<string[]>` writes `.mycelium/screenshots/<task_id>/<ts>-<action>.png`. It also copies to `<artifactsDir>/screenshots/<workspace-basename>/`, where `artifactsDir` comes from `~/.mycelium/mycelium.json` and defaults to `~/database/20261108_mycelium/artifacts`.

- [ ] **Step 1: Failing tests:**
  - `cockpit edits persist to the store and return the new state`.
  - `improved cockpit refuses to toggle check_all_passed`.
  - `rollback restores a snapshot`.
  - `saveScreenshot writes a PNG decoded from the data URL to both locations`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. The Cockpit webview is plain HTML/JS with no React and no proto, communicating through `postMessage`. It shows the profile, mode, stage, stage history, spec, AC with latest verdicts, plan, exit criteria, notes, refs, check runs, and both metrics views.
- [ ] **Step 4:** Run the tests, then `npm run compile`. Expected: PASS, and exit 0.
- [ ] **Step 5:** Commit `feat(mycelium): commands, status bar, cockpit, screenshots`.

## Phase D: acceptance

### Task 20: End-to-end acceptance on a sample project, both profiles

**Files:**
- Create: `docs/acceptance-<date>.md` (results), `scripts/mycelium/new-sample-workspace.sh`
- Large artifacts: `~/database/20261108_mycelium/acceptance/<date>/` (vsix copy, summaries, screenshots, logs)

- [ ] **Step 1:** Run `npm run test:mycelium && npm run test:unit && npm run package:vsix && node scripts/mycelium/check-hosts.mjs dist/extension.js`. Expected: all pass, and the host check prints `OK`.
- [ ] **Step 2:** Install the `.vsix`. Write `new-sample-workspace.sh <dir> <profile>`, which creates an empty git repo with `.mycelium/profile.json` and `.mycelium/models.json` (both profiles get the same models). Create `~/database/20261108_mycelium/acceptance/<date>/sample-tao` and `…/sample-improved`.
- [ ] **Step 3:** In each workspace, run "Mycelium: New Task…" → Architect with the brief "A one-page site listing three mushrooms with photos placeholders, built with Astro". Expected:
  - the 8 documents plus `check_all.sh` and `ROADMAP.md` exist;
  - the stage history covers the Architect stages;
  - a handoff file is written.
- [ ] **Step 4:** In each workspace, run a Developer task "Выполняем Этап 1". Expected:
  - the stages run clarification → … → report;
  - in `improved`, `check_all_passed` came from an extension run, and `check_runs/latest.log` exists;
  - in `tao`, the stored history was truncated after update-cycles (the audit log shows it).
- [ ] **Step 5:** In each workspace, run a Debug task "open the dev server page and check it renders". Expected: at least one screenshot in `.mycelium/screenshots/` and in the artifacts directory.
- [ ] **Step 6:** Run "Mycelium: Summarize Workspace" in both. Expected: the summaries show calls by type and stage, model time, wall time and check runs. Copy them to the acceptance directory.
- [ ] **Step 7:** While a session runs, list Mycelium's outbound connections (`ss -tnp | grep code` sampled every 5 s for a minute). Expected: only the configured provider hosts, plus whatever hosts tools contacted (`npm`), each with an approval in the chat.
- [ ] **Step 8:** Write `docs/acceptance-<date>.md` with the results against spec §10. Commit `docs: acceptance run`.
