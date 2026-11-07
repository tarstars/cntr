# TAO·CODER v3.1.2 — what the owner sees and controls (webview UI)

Citations are `chunk @offset` (`novel_webview/chunks`), `bundle @offset` (raw `index.js`, for code the extractor did not mark novel) or `package.json`. **Offsets are UTF-16 string indices, not bytes**: `grep -b` drifts by about 15 kB near 4.8 M. [inf] marks an inference.

## 0. Layout

- One React root mounts three apps by view type: running tasks, Task Context and chat (`14_task_context_store @4816378`). `package.json` registers a **"RUNNING TASKS"** activity-bar view and a bottom-panel **"Task Context"** view.
- The navbar has three groups (`10_scheduler @4707063`, `09_rest_api @4706435`, `13_subscription @4705919`):
  - New Session / Task Context / Schedule;
  - Tao·Modes / Rules / MCP / REST API / Settings;
  - History / Notifications / Subscription.
- It also shows counters "N running / waiting for approval / completed", a Task-notes button and a **"🤖 Autonomous execution"** switch (`10_scheduler @4707378`).

## 1. Cockpit (Task Context panel)

**Header** (`17_update_cycle_1 @4804085`, `05_other_2 @4717195`):
- A selector over the chat's Task Contexts (Current / Archived / Preview), plus Copy Task ID.
- Role mode, Stage, Version; **API calls, Total cost, Duration**, each with a hover split Agent / Handover / Update cycle / Repair / Crash analyst.
- A run-type badge (📝 Manual, ⏰ Scheduled, 🔄 Self-delay continuation, 🤖 Autonomous).
- An **Autonomous** switch: *"auto-approve tools, auto-continue on asks… The task is NOT stopped"*. It calls `updateTaskRunType(inherited_autonomous|manual)` (`10_scheduler @4801621`).
- Archived contexts open read-only: *"read-only audit branches. TaoCoder does not reactivate them"*.
- The panel polls every 10 s (`13_subscription @4803292`).

**Tabs**: `Plan | Memory | Snapshots | Metrics | Ops`. Ops appears only when `role_mode==="ops"` (`14_task_context_store @4799024`).

**Plan tab** (T3n, `12_stages_modes @4776582`):
- *Stage policy*: "Denied tools" and "Require confirm" lists.
- **Exit criteria are checkboxes the owner can tick, then Save.** This calls `updateTaoCoderExitCriteriaStatus({stage, criteria})`. "Advanced" adds a custom `criterion_id`. The UI has the per-stage built-in lists, e.g. `development: […"check_all_passed"…]` (`12_stages_modes @4722427`). So the owner, not only the model, can set `check_all_passed`.
- *Stage history*: from → to, time, reason.
- *Task*:
  - Spec, AC and Constraints, with an "Edit task" dialog (`updateTaoCoderTaskSpec`).
  - Each AC shows `[PASS|FAIL|SKIP|PENDING]`. The **UI forces FAIL when an evidence ref is stale** (*"auto-fail: stale refs"*).
  - Plan editor with TODO/NEXT/IN_PROGRESS/DONE, add and delete (`updateTaoCoderImplementationPlan`).
  - There is no control for setting AC verdicts.

**Architect variant** (m3n, `12_stages_modes @4725296`): "Deliverables (done/total)" with "Docs ready" and "Missing/unfilled". Each document has **Open / Edit deliverable** (status, purpose, criteria via `updateTaoCoderArchitectDocument`) **/ View diff**.

**Memory tab** (`06_other_3 @4746912`…). Sub-tabs `Active | Changes | Log | Notes`:
- *Active*: refs with locator and stale/broken flags; Open at lines; **Edit why**; 👍/👎. The list is cut to `budgets.max_items.relevant_code`.
- *Changes*: diff_ref, touched refs, revisions; **View diff**, **Edit summary**, 👍/👎.
- *Log*: `execution_log` lines.
- *Notes*: tags, comments, "+ Add note" (5 characters minimum, `@4743034`).
  - **"Hide note from agent"** asks *"The agent will no longer see it. Data is preserved"*. It is implemented as a comment tagged `hide` or `show` (`06_other_3 @4743531`).
- Feedback dialog: *"Record human feedback… A message is required for thumbs down"* → `addTaoCoderFeedback` (`05_other_2 @4715599`).

**Snapshots tab** (`14_task_context_store @4791440`):
- List, JSON preview, Create (with reason), Rollback (with reason).
- Rollback warns *"This snapshot is not safe… code restore is not guaranteed"* unless the revision is a `checkpoint`.
- **There is no Prune button.**

**Metrics tab** (`17_update_cycle_1 @4766717`):
- Rows: Tokens in, Completion Tokens, Cache writes, Cache reads, Cost, API calls, Duration.
- Columns: **Agent / Handover / Update cycle / Repair / Crash analyst / Total**, captioned "Source: task context `token_metrics`".
- This **confirms ANALYSIS §7**: the UI splits by call type only, nothing per stage or mode.

**Ops tab**: environment, deploy target and method, stability, escalation reason, incident summary, services, logs, health and smoke checks, rollback steps.

**Absent from the webview:**
- Code-ref adding, handoff export and pruning are **command-palette only**: "Task Context: Add Selection Ref / Add File Ref / Export Handoff Bundle / Prune Old Snapshots" (`package.json`, with no menus entries).
- There is **no "force update-cycle" control** anywhere.
- Callbacks for "mark stale", "repair ref" and "create task" are built and then discarded, so they are dead UI (`06_other_3 @4801869`).

## 2. Chat-side additions

- **Mode switcher**:
  - Plan/Act is replaced by a slider `Arch|Task|Dev|Ops|Dbg|Free` (`bundle @2511838`), plus a **Mode Help** button.
  - A TAO·MODES dropdown offers "Manage Modes..." (`04_other_1 @2053659`).
  - It calls `toggleTaoCoderRoleModeProto` or `toggleCustomMode` (`15_tools @2504578`).
- **Mode Help, "Goal" lines** (`12_stages_modes @2485957`):
  - Dev: *"Implement code changes with verifiability and transparent diff review"*.
  - Architect: *"…deliverables document set before implementation (no code changes)"*, and *"Handoff: Start Dev Task creates a new dev task"*.
  - Task: *"can ONLY write/edit .md files"*.
  - Ops: *"configs, CI/CD, observability, security, runbooks"*.
  - Debug: *"E2E integration testing…"*.
  - Free: *"without stage gating — all tools available"*.
  - Shared note: *"Switching the mode affects the next New Task"*. [inf: the RPC still sends the current taskId.]
- **Stage indicator**: there is no pipeline graphic. `info` messages starting with `Stage transition: a → b` or `Update-cycle:` render as collapsible cards with colour-coded stage pills (`12_stages_modes @3411689`). Running-task rows show a `mode · stage` badge.
- **Approvals**:
  - There is no stage-transition dialog. Confirm-required tools use the generic Approve/Reject [inf].
  - Commands marked `REQ_APP` get **"Add to Whitelist & Run"** (`00_command_safety @1332837`).
  - A `reject_with_blacklist` handler exists, but no button config emits it, so it is unreachable (`00_command_safety @3699467`).
  - Hook cards show "Hook: name (action on event)".
- **New cards**:
  - secret request with Save/Skip; the value goes by `postMessage` (`11_secrets @3401818`);
  - **Crash Report** with verdicts Terminal / Recurring / Correctable / Agent Code Bug / Prompt Bug (`04_other_1 @3302639`);
  - File Conflict Warning;
  - "Writing to Task Context…" (`@3456582`);
  - a self-delay countdown with **Continue Now** (`@3489455`);
  - a context tooltip that adds a **Kernel** row to the prompt breakdown (`02_kernel_prompt @3474292`).
- **Relabels**:
  - "Turn Completed" → Reopen Task / Start New Task; resume becomes "Continue execution" (`04_other_1 @1329267`).
  - The handoff `new_task` ask starts the new task in `askNewTask.roleMode`.
  - "Restore Checkpoint" restores *"files, Task Context, and chat messages"* (`@3289277`).
- **Spec seeding**: every send or option click first calls `prepareTaoCoderTaskContextForIncomingTurn({initialTaskSpec})` (`04_other_1 @3301964`).
- **Autonomy at launch**: the navbar switch value is passed on send (`bundle @2493914`). New tasks then get `taoCoderAutoApproveTools` (`04_other_1 @3697962`).
- **Parallel sessions**: the RUNNING TASKS view (`10_scheduler @3525656`) shows:
  - status (Running / Waiting for action / Completed), mode · stage;
  - API calls, tool calls, cost;
  - "⏰ Scheduled: next run in…";
  - actions Open / Pause / Close / Move to History / notes / summary.
- **Task notes**: *"UI-only, not sent to LLM"*, plus a read-only Task Summary (`05_other_2 @3902990`).

## 3. Screens

- **TAO·MODES**: Modes / Editor / Presets / Info (`05_other_2 @4406253`).
  - *Modes*: Active / Hidden, Copy to Project or Global (`12_stages_modes @4399606`).
  - *Create*: ID, Name, First Stage (`@4310341`).
  - *Editor*: raw JSON for mode.json and `stages/*.json`; add, delete and reorder stages; prompts; Validate.
  - *Visual mode config* (`11_secrets @4327049`): Rules / MCP / Skills Available, **"Project Bible (README_AI)"**, Required Secrets, Extends.
  - *Stage config* (`bundle @4333289`):
    - Init Plan Items, Allowed/Forbidden Tools, Full Tool Instructions, Default Exit Criteria;
    - Allowed/Forbidden MCP and REST servers, Allowed Write Paths;
    - **AC Gate** `none|non_pending|all_pass`;
    - hooks `stage_enter|stage_exit|tool_call` × `request_approval|require_handoff|log|notify|jev_validate`.
  - *Presets*: string arrays in the categories Tools, Exit Criteria, Init Plan, MCP, REST, Write Paths.
  - *Info*: a full guide (`01_jev @4352928`, mis-tagged), including *"A typo in action is not caught by the validator"*.
- **Schedule** (`10_scheduler @4700703`, `bundle @4676172`):
  - Fields: Name, Mode, Task message, Constraints, **"Auto-approve tools (YOLO mode)"**, "Lock provider & model".
  - Repeats: hourly, daily, weekly, interval, cron, once, with **"Time (UTC)"**.
  - Row actions: Pause / Resume / **Run now** / Delete.
  - A template cannot be edited while its schedule is active.
- **REST API** (`09_rest_api @4012182`, `bundle @3988580`): Base URL, auth headers, **Import from OpenAPI Spec**, per-endpoint auto-approve and Test, OAuth status.
- **MCP**: Project vs Global server lists (`05_other_2 @3938271`) and a raw JSON editor per scope. Secrets display as `[🔒 KEY]` and are written back as `{{SECRET:KEY}}` (`11_secrets @3926467`).
- **Rules & Workflows**: upstream content moved into a full screen with side tabs Rules / Workflows / Hooks / Skills (`05_other_2 @4434547`).

## 4. Settings TAO added (UI defaults)

| Tab / section | Settings (default) |
|---|---|
| General → Update Cycle (`17_update_cycle_1 @4250772`) | raw tail **10**; min batch **5** (*"only when at least this many new turns have accumulated"*); timeout **120000** ms |
| General → Task Context Memory | Stale Attention **on**, threshold **15**; fallback recent turns **10**; hot **50000** (*"Hidden entries are excluded from pressure"*); target **25000**; recent window **50000**; Knowledge Migration **on** |
| General → Runtime Limits | API / tool calls / tokens **0** = unlimited; *"first reached limit stops the task"* |
| General → Provider | response timeout **300000** ms (*"Global watchdog"*); Max Visible Messages **200** (`05_other_2 @4261826`) |
| API config (`@2470708`) | **Update Cycle Model**: one of the starred favourites, or "Use main model" |
| Prompt & Environment (`15_tools @4262937`) | Tool Help on demand; History Stripping **off**; 5 `<environment_details>` toggles, all **off** |
| Features | web tools; Crash Analysis **off** (`bundle @4245660`); search **Tavily** (Serper, Brave, Custom) (`11_secrets @4242524`) |
| JEV (`bundle @4287268`) | **off**; `typesafe/jev-1.13`; threshold **0.7**; timeout **10000** ms (fail-open); Terminal Guard **off** |
| Auto-Approve | "Auto-Approval for File Edits" **off** |
| Command Safety (`14_task_context_store @4275795`) | white / black / require-approval lists, "Recent Unknown Commands" |
| Secrets (`00_command_safety @4292945`) | set / delete keys, values masked |

## 5. Account and subscription (description only)

- Email login and registration with verification and password reset.
- Launch-error dialog with Authentication Required / **Launch Limit Reached** / Subscription Inactive / Server Error (`13_subscription @3538076`).
- The Subscription screen (`13_subscription @4457877`) shows:
  - plan and status (Active / Trial / Expired / Cancelled);
  - **"TAO·MODES Launches used X / max"** and the subscription dates;
  - Launch History: *"Each launch of a custom mode counts as one launch against your plan limit"*;
  - plan cards (`$x.xx/month` or Free) stating *"Standard modes (Arch, Task, Dev, Ops, Dbg, Free) launches: Unlimited"*.
- Upgrading means *"contact our admin"* by e-mail or Telegram; there is no in-app payment. A Notifications screen exists.

## 6. Behaviour revealed or contradicted by the UI

- **README_AI**: the tooltip says *"injected during the first 8 turns"*, default on (`@4327049`). ANALYSIS calls it one-shot; check the host.
- **Secrets**: the UI states *"stored in VS Code SecretStorage"* (`@4292945`). This contradicts ANALYSIS §4 (plaintext `secrets.json`).
- **JEV**: the what's-new text expands it as *"Justification-Evidence-Verification"* (`bundle @3506941`). This corrects ANALYSIS §4, which says the expansion is absent. The same text claims "deterministic stage transitions".
- **What's-new claims** (`bundle @3504000–3509000`): "1000+ steps", "prefix cache hit rates 55–65%", "10+ concurrent sessions", a **QA** mode that is not in the switcher, and *"Write access is restricted to the Development stage only"* (but rework, Free and Debug also write).
- Computed in the UI: stale refs auto-FAIL an AC, refs are cut to budget. Only custom-mode launches are metered.

## Owner touchpoint → effect on the agent

| Touchpoint | Effect |
|---|---|
| Mode slider / custom dropdown | pipeline, tools and prompts of the next task |
| Edit task (spec / AC / constraints) | rewrites the kernel top; AC text feeds the report gate |
| Plan editor | kernel plan items |
| **Exit-criteria checkboxes** | open or close the stage gate directly (incl. `check_all_passed`) |
| Edit why / summary, 👍👎 | annotate memory; `feedback[]` [inf: reaches kernel] |
| Add / hide note | add facts / remove a note from the agent's view |
| Snapshot create / rollback | restores Task Context (code only from a checkpoint) |
| Autonomous switches | auto-approve and no blocking asks; can be switched live |
| Approve / Reject / Whitelist & Run | per call; whitelist persists |
| Restore Checkpoint | rewinds files, Task Context and chat |
| Continue Now | skips the self-delay |
| Task notes | none (UI-only) |
| Schedule | autonomous recurring tasks (mode, spec, YOLO, locked model) |
| TAO·MODES editor / presets | stages, tools, exit criteria, AC gate, hooks, write paths, README_AI injection |
| Update-cycle / memory settings | batch, raw tail, stale threshold, budgets, window, migration, update-cycle model |
| Runtime limits / provider timeout | hard stop of the task / request watchdog |
| JEV / Command Safety / Secrets / Search | second-opinion gate, command classification, placeholders, search backend |
| Palette commands | add ref, export handoff, prune snapshots |
