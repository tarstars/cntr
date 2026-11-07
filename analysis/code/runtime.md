# TAO·CODER 3.1.2: core-loop integration and runtime

Static reading of `dist/extension.js` against upstream `u3.84.0`. `@N` is a byte offset in the TAO bundle; `chunk.js @N` points into `novel_ext/chunks/`. **[inf]** marks an inference from reading the code, never run.

## 1. One turn, end to end

```text
initiateTaskLoop(content)                                  @20915153
  loop until abort:
    ended = recursivelyMakeClineRequests(content)
    if pendingUserMessages: content = queued; continue      # TAO: messages typed mid-run
    if ended: break;  content = noToolsUsed; mistakes++

recursivelyMakeClineRequests(content)                      @20977893
  T1 if enforceTaoCoderRuntimeLimits(): return END         @20977058  apiCalls/toolCalls/tokens; default 0 = off
  apiRequestCount++, taoCoderApiCallCount++
  T2 tid = resolveTaoCoderTaskId()                         @20947856  chatId -> current TaskContext id (disk read)
     recordApiCallAndCost(type:"agent", skipCost)          @20979083  counted BEFORE the call
  if mistakes >= maxConsecutiveMistakes (3):
     T3 crash_analyst (if enabled) else ask("mistake_limit_reached")
  T4 auto-condense skipped when taoCoderWorkspaceRoot set  @20987791  "p=!!this.taskState.taoCoderWorkspaceRoot"
  loadContext(); environment details kept in taskState._latestEnvironmentDetails,
     not appended to the stored user message (upstream does)  @20989266
  addToApiConversationHistory(user, is_direct_user_input)
  stream = attemptApiRequest():                            @20954679
     rebuildApiIfConfigChanged()   global -> workspace -> per-task api_configuration  @20953122
     T5 ensureTaoCoderModeResolved() (5 s cap): stage, role_mode, run_type, schedule_id  @20951926
     system prompt = oJu(ctx + stage, allowlist, MCP policy)
     T6 buildConversationHistoryForApiRequest()            @20926598
        global_turn_counter++
        if userMsgs - last_processed >= 5 or pending_force: UPDATE CYCLE (blocking LLM call)
        RUt() -> [kernel, recent window]   (on error: Cline legacy truncation)
        ephemeral tail: KERNEL UPDATES / "User input check" / step-orient
        plan-health check -> repair planner
     msgs = [kernel, "=== HISTORY BEGIN ===", ..., "=== LAST MESSAGE ===", env_details, last, "=== HISTORY END ==="]  (FDi)
     T7 api.createMessage(); first chunk raced with 300 s; errors: 3 auto-retries (2/4/8 s)
        -> crash_analyst -> ask("api_req_failed")
  T8 for chunk: race(nextChunk, 300 s timer that calls stream.stop())  @20993796
     stream error: 3 retries -> crash_analyst -> abort + reinit -> ask("resume_task")
  T9 record cost/tokens/duration("agent")                  @21001653
  presentAssistantMessage -> ToolExecutor.executeTool
     T10 stage gate VO(stage, role, tool, mcp, rest, path)  ToolExecutor.execute @20835223
  T11 wait userMessageContentReady, timeout 180 s (+3x5 s), else throw "Tool execution timed out"  @21004725
  no tool_use -> "malformed tool call" vs noToolsUsed; mistakes++      @21009028
  recurse, unless user messages are queued and no ask is open          @21009982
  catch-all: crash_analyst (if enabled) or END                         @21013400
```

**Notes:**

- **T5–T6** run before `createMessage`, so the update cycle and the repair planner delay the agent call that triggers them.
- **T8: likely bug [inf].** Each chunk starts a `setTimeout(async()=>{await Me.stop()…},Te)` that is never cleared (default 3e5 ms). 300 s after the loop starts, the live stream is stopped, `nextChunk()` returns `undefined` and the loop exits normally. Responses longer than 5 min are cut off without an error. Upstream has no such timer.
- **T10.** A blocked tool returns an error and adds one mistake; 5 blocks of the same tool force the mistake limit. If the TaskContext fails to load, the check fails open (`stage_policy_skipped_no_task_context`).
- **T11** replaces upstream's untimed wait. A tool or approval that takes more than ~195 s throws into the outer catch, which ends the loop while the ask is still open [inf].
- **Pause.** Unfinished tools get a synthetic `tool_result` "[прервано паузой]" ("[interrupted by pause]").
- **Completion.** `attempt_completion` runs `handleTaskModeCompletion` (stage_exit hooks), sets TaskContext to `done`, then `clearRunningTaskId` (`15_scheduler.js @20546561`).
- 11 debug `fetch("http://127.0.0.1:19345/event")` beacons remain.

## 2. Auxiliary call types, recovery, no-progress detection

**`crash_analyst`** is an automatic post-mortem LLM call, gated by `taoCoderCrashAnalysisEnabled` (`{default:!1}`).

- **Triggers:** mistake limit (`@20979426`); stream failure after 3 retries; exhausted first-chunk retries; the outer catch of `rmcr`. A YOLO-mode trigger also exists but is dead code (§7).
- **Input:** `$3e` (`09_other_6.js @20285859`) collects the last user prompt, the last 10 UI messages, the last 5 errors, counters, provider and model.
- **Prompt:** `Z3c` (`@20286710`): "You are a crash analyst for the TaoCoder agent system… verdict: terminal, correctable, recurring, agent_code_bug, prompt_bug, unknown_crash". Its `bugLocation` example is "vendor/cline/src/core/task/index.ts:L4035?". `tkc` validates the output; `correctable` requires a `correctiveMessage`.
- **Model:** the update-cycle model if one is configured, else the main model.
- **Outcomes:**
  - `correctable`: `say("user_feedback","[CrashAnalyst corrective guidance] …")`, counters reset, loop continues.
  - Anything else: `resolveCrashAnalystAsk` (`@20948332`) asks Continue/Cancel. It accepts yes-words in English and Russian (`CDi`: "да", "продолжай", …).
- **[inf] The guidance probably never reaches the model.** These `say` calls only write UI messages. Every other `user_feedback` site also pushes into `userMessageContent` or a tool result; these do not.

**`repair`: deterministic triggers plus an LLM planner** (`@20939677`).

- **Triggers** (checked on every request): `empty_plan`, `all_done`, `no_in_progress`, `multiple_in_progress`, `empty_spec`, `empty_acceptance`, `empty_constraints`.
- **Delay:** the first detection is only recorded ("⏳ Repair scheduled … at turn N+2", `@20940944`). The repair runs if the problem persists.
- **Planner:** `wkc` (`@20310868`), prompt `Ikc`: "You are a structured repair planner for TaoCoder's enforcement point… raw JSON". It returns `add_plan_items`/`update_plan_items`/`spec`/`acceptance_criteria`/`constraints` and uses the main model.

**Malformed tool calls** are not repaired by an LLM.

- The parser `uSt` (`08_other_5.js @16400166`) normalises them: DeepSeek "｜DSML｜" tokens, code fences, `<invoke name><parameter name>`, OpenAI-style `<tool_call><function=…>`, `minimax:tool_call`.
- Tool tags that remain unparsed get the reply "Your tool call was malformed…" and add one mistake (`@21009028`).

**`update_cycle`:**

- Triggers when the user-role API messages since `last_processed_turn` reach 5 or more, or when `pending_force` is set. Forcing happens when KERNEL UPDATES exceed 10k tokens (`@20937932`).
- It processes turns `0..min(total,30)` and makes up to 2 retry calls when files were read but no refs came back.
- Once applied, it **truncates and persists** the API history to 20 messages.

**`handover`** is not an LLM call (§6). The in-place Architect→Developer handoff adds a knowledge-migration LLM call (main model, 120 s timeout).

**Retries.** A first-chunk failure gets 3× backoff of 2/4/8 s (skipped for auth, spend-limit, moderation and image errors). Stream failures and empty responses also get 3 retries.

**No-progress detection:**

1. `consecutiveMistakeCount`, with TAO increments for blocked and malformed calls.
2. Blocked-tool streak: 3 = warning, 5 = forced mistake limit.
3. Step-orient nudge (`vkc`): a run of 3 or more calls of the same category produces "Step-orient: застой (N×…)" ("stagnation"). It is **off**, because `eju()` returns the constant `!1` (`@16114953`).
4. Autonomous recovery counter: 3 recoveries trigger an escalation.
5. Runtime limits (T1), off by default.

## 3. Scheduler and autonomy

**Schema** (`.taocoder/schedules.json`; `pNr`/`Pkc` in `15_scheduler.js @20317109`). A corrupt file is renamed `*.corrupt.<ts>`.

```text
{schema_version:1, schedules:[{schedule_id, name?, status: active|paused|cancelled|completed,
  task_template:{mode_id, role_mode, spec, constraints[], apiProvider?, apiModelId?, auto_approve_tools},
  recurrence:{type: simple|cron|custom{interval_ms|cron}|one_time{run_at}, pattern},
  next_run, created_at, timezone, last_run?, running_task_id?, running_since?, last_run_task_id?,
  kind?: recurring|self_delay, self_delay?:{task_id, chat_id}}]}
```

**Cron ignores `timezone`:** `parseExpression(r,{currentDate:e,tz:"UTC"})` (`g9c @21357377`).

**Tick loop** (`f8r`, `15_scheduler.js @21364966`):

```text
start(): fs.watch(dir, debounce 50 ms) -> tick();  setInterval(60 s):
   if gap > 2 x 60 s (wake): scanMissedRuns()        # not awaited
   tick()
processSchedule(s): skip unless active and not in flight
   running_task_id set -> skip, unless running_since > 24 h ("Clearing stale running_task_id")
   if next_run <= now: launcher.launch(s); next_run = next(now); last_run = now
```

**Missed runs.** At start-up, `scanMissedRuns` (`l8r @21359386`) first shows a modal: "Run now / Skip / Reschedule".

- On wake the scan is not awaited and `tick()` runs at once, so a due schedule starts while the dialog is still open [inf].
- A dismissed dialog patches nothing, so the next tick runs the schedule anyway [inf].

**Launch** (`Vze`, `19_stages_modes_1.js @21361201`):

- For custom modes, `launchMode(role_mode)` runs first. This is a server launch check returning a token with `expiresAt`; I did not trace it further.
- `host.initTask(spec, …, {taoCoderRoleMode, apiProvider, apiModelId, taoCoderAutoApproveTools}, isBackground=true)`, after which the foreground task is restored.
- `cloneTemplateIntoContext` writes `run_type="scheduled"` and `schedule_id`, and merges constraints. The spec only becomes the first message; acceptance criteria are not cloned.
- `stampRunning`; a `one_time` schedule is then set to `completed`.
- [inf] `initTask` does not await `startTask`. `ensureTaoCoderModeResolved` can therefore read the context before `run_type` is written.

**Self-delay** (`taocoder_self_delay` handler `@20717127`):

- Takes 1 min to 7 days. It upserts a `one_time` schedule with `kind:"self_delay"`, sets `taskState.taoCoderRunType="self_delay"`, then **blocks on `ask("resume_task")`**.
- When the schedule fires, `host.resumeTask` sends `handleWebviewAskResponse("yesButtonClicked")`. It throws unless `controller.task.taskId === chat_id` (`27_webview_ui_glue.js @21370278`). A delayed chat that is not in the foreground loses its continuation: the schedule is marked completed [inf].
- `forceContinueSelfDelay` (`@21468413`) unblocks the task by hand.

**run_type values:** `manual`, `scheduled`, `self_delay`, `inherited_autonomous`. The last comes from the UI toggle (`JGc @21469424`, which also sets `auto_approve_tools`) or is inherited by `new_task` from an autonomous parent (`20_subscription.js` ~l.1650).

**Autonomous behaviour:**

- **Prompt preamble: written but not reached [inf, strong].** `pju()` (`@16124057`) emits "AUTONOMOUS MODE … Do NOT ask the user for clarification". It is reached only through `oJu()`, which loads `run_type` only `if(!e.taoCoderStage)` (`@16392696`). `attemptApiRequest` always passes a stage and never passes `taoCoderRunType`.
- **What does act:**
  - `ask_followup_question` is answered automatically (`@20536114`): "[Autonomous mode: Proceed with best-effort solution…]". After 3 recoveries the tool returns "Task escalation triggered" instead.
  - In the crash analyst ask, the decision `BIr` is continue, or escalate after 3 recoveries. Escalate posts "🤖 Autonomous run escalated… Task cancelled" and ends the loop.
  - `rm`, `git checkout --` and dangerous or unknown commands are blocked (`@20570681`).
  - `auto_approve_tools` approves read, write, patch, `execute_command` and `use_subagents` (`shouldAutoApproveTool`).

## 4. Parallel tasks

- **Many live tasks.** The controller keeps `activeTasks: Map<chatId, Task>`. `initTask` replaces the foreground `this.task` without disposing the old one; an id already in the map is only refocused (`@21042442`). Background tasks keep running, with UI posts throttled to 500 ms.
- **Running-tasks view.** `runningTasks` (`@21084625`) combines `getRunningTaskMetrics()` (`15_scheduler.js @20904285`: counters, cost, stage, run_type, `isWaitingForApproval = isAskActive && askType!="command_output"`) with `stoppedTasksCache`. The cache holds tasks found on disk at start-up (`showStoppedTasksWithoutLaunching @21047418`), shown as waiting but not relaunched.
- **Unloading.** A completed task becomes a background task and is disposed after 300 s (`ZOc`, `@21039087`) unless it is focused or running (`releaseCompletedTask @21060585`). It stays "reopenable from disk". Messages beyond 200 are archived.
- **Pause.** `PauseManager` (`@21024970`): state goes to "pausing", then `abortForPause` (5 s cap), then "paused" with TaskContext status `paused`, then `ask("resume_task")`. `ask()` gains `isAskActive`/`currentAskType` tracking, and `followup` asks are no longer dismissed by newer messages (`@20892735`).
- **Cancel** (`@21058121`): it opens a 10 s `task_closed_by_user` ask, then disposes the task, sets TaskContext to **`done`** and clears the schedule's `running_task_id`.

## 5. Provider layer

- **Non-streaming mode.** A `this.options.disableStreaming` branch (`stream:!1`, then yield text/usage) was added to most handlers: 115 occurrences in TAO, 0 upstream. Example: DeepSeek `@12608290`.
- **DeepSeek** (`@12608290`, against u3.84):
  - `deepseek-v4-*` is treated as a reasoner: no thinking injection, reasoning merged via `m7s`, no `temperature:0`.
  - `extra_body:{thinking_effort}` (upstream 4.0.12 sends `reasoning_effort`).
  - Image parts are stripped when `!supportsImages`.
  - The model table adds `deepseek-v4-pro`, `-flash-0731` and `v4.1-flash`, the last with peak-hour pricing (`@7642300`).
- **Qwen** (`@13973700`): `deepseek-v4` and `glm-5` count as thinking models (`enable_thinking`, `thinking_budget`).
- **Cerebras-style handler** (`@12578885`): for `qwen`, `<think>` blocks are stripped from assistant history and streamed `<think>` text becomes reasoning chunks.
- Prompt caching keeps upstream `cache_control` (`@15399310`); unchanged.
- **Headers.** All four upstream `"HTTP-Referer":"https://cline.bot","X-Title":"Cline"` sites now send `https://thinkingos.tech` / `TAO·CODER`: Cline-account provider `@12603821`, OpenRouter `@13967424`, Requesty `@13980692`, Z.ai `@15416044`.
- **Prompt capture is dormant.** `PromptCaptureService` (`@20302700`) would write `.taocoder/prompts/<ts>-<prov>-<model>-<task8>.json` through a `Proxy` on `createMessage`. It is constructed disabled (`let x=!1;this.promptCaptureService=new w2t(g,x)`, `@20885693`), and `setEnabled` is never called.
- **No automatic model selection.** The model resolves global → workspace → per-task `api_configuration`, plus schedule template overrides. Update-cycle and crash-analyst calls can use `updateCycleApiProvider/ModelId`.

## 6. Cost and accounting at the call sites

| Type | Call count | Cost / tokens / duration | Site |
|---|---|---|---|
| agent | +1 *before* the request; internal retries not counted | `max()` of usage chunks (upstream: last value); tokens exclude cache; duration measured from `api_req_started` | `@20979083`, `@20993377`, `@21001653` |
| update_cycle | +1 per cycle, even with up to 3 LLM calls | summed cost, tokens, duration | `@20931970` |
| repair | +1 **only if applied** | cost, tokens, duration | `@20942055` |
| crash_analyst | +1 if usage returned | cost; tokensIn includes cache | `@20981048` |
| handover | export: +1 with skipCost plus export duration (no LLM); merge: +1 with **cost = parent `bundle.total_cost`** | parent cost added to child | `@20714909`, `mPc @20711707` |
| knowledge migration | not recorded | usage chunks ignored | `@20937010` |

Consequences [inf]:

- **Costs can double count.** A handed-off child's `total_cost` already contains its parent's total (`addCost @8790463`), so summing tasks counts the chain twice.
- **`duration_ms` is summed LLM-call wall time** (`addDuration @8792273`; written only by agent, repair, update_cycle and handover). It excludes tool time and human waiting, and counts update-cycle time twice.
- The runtime token limit leaves out crash_analyst tokens.

## 7. Other TAO modifications in hooks.tsv (top 25 by bytes)

Third-party entries skipped: luxon (`U4=>`), MCP SDK (`jWu`, `s50`, `YN0`), ajv and zod (`t=>`, `(t,e)=>`, `h=>`).

1. `()=>` 293 KB: lazy-module initialisers for the new TAO services.
2. `class` 117 KB: anonymous handler and controller classes (WriteToFile dry-run, `pauseTask`, …).
3. `class t` 111 KB: `TaskContextStore` (transitions, costs, schema errors).
4. `decode`/`toJSON` 120 KB: protobuf codecs for the new gRPC fields.
5. `execute(e,r)` 42 KB: tool handlers (autonomous follow-up, command block, self-delay).
6. `Ddd` 26 KB: kernel renderer.
7. `createMessage` 26 KB: §5.
8. Core-loop methods: §1. `presentAssistantMessage` also strips `<think>`/`<function_calls>`.
9. `ttc`/`ntc` 11 KB each: slash-command prompts given a `roleMode` parameter.
10. `getStateToPostToWebview` 8.5 KB: TaoCoder state and `runningTasks`. On every state post it also calls `getSubscriptionStatus()` and fetches the unread-notification count (`@21078142`).
11. `AMi` 6.2 KB: the `new_task` handler (handoff, autonomy inheritance, launch token).
12. `execute(e)` 5.7 KB: the stage gate (T10).
13. `initTask`, `ask`, `cancelTask`, `resumeTaskFromHistory`: §4. `resumeTaskFromHistory` reloads archives and adds `resume_completed_task`.
14. `validateAndPrepareFileOperation` 4 KB: file-operation pre-checks.
15. `cXg` (activate): seeds the built-in modes, starts the scheduler, adds a global error handler and the running-tasks view.

**Feature flags hard-wired off.** `eju`, `GO`, `vB`, `Xb`, `Vre`, `u0e` and `n2.enabled` return constants (`@16114953`). This disables step-orient, auto-condense, YOLO, separate plan/act models, strict plan mode, lazy-teammate mode and the focus chain.

## Corrections to ANALYSIS.md

1. **Update-cycle trigger (§3).** It is not "every 5 new user turns": it counts 5 user-role *API* messages, and every tool result is one, so roughly every 5 agent requests. It runs synchronously before the agent call and then truncates the stored history to 20 messages.
2. **Autonomous prompt (§4).** The "AUTONOMOUS MODE… Do NOT ask the user" preamble is not reached in 3.1.2 [inf, strong]. Autonomy works through automatic follow-up answers, automatic continuation in the crash analyst ask, command blocking and `auto_approve_tools`.
3. **Duration (§1).** `duration_ms` is summed LLM-request time, not task time including waiting for the human. So /proof's 2,418 h is model time, with update-cycle time counted twice.
4. **Cost by call type (§3, §7).** The `handover` bucket copies the parent task's whole `total_cost`. Knowledge-migration calls and failed repairs are never accounted.
5. **Schedules (§4).** Cron runs in UTC whatever the `timezone` field says. The missed-run dialog does not stop a run: dismissing it, or waking the machine, still lets the 60 s tick launch the schedule.
6. **Defaults.** Crash analysis is off by default and runtime limits are 0 (off). YOLO mode and auto-condense are hard-disabled by constant flags.
7. **New failure modes for §7:** streams longer than 5 min are silently truncated; waits over 180 s end the loop; self-delay only resumes in the foreground chat; crash guidance appears to be UI-only.
