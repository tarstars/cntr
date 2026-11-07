# MEMORY: Task Context kernel, update-cycle and store (TAO·CODER 3.1.2)

`ext@N` is a unit offset in `dist/extension.js`. `02@`, `21@`, `25@` point to the same offsets in `novel_ext/chunks/02_kernel_prompt.js`, `21_task_context_store.js` and `25_update_cycle_1.js`. Items marked *[inf]* are inferences; everything else is read from the code.

## 0. Key findings
- The **chronological feed is outside the budget**. The renderer sets its char counter to `o=-999999999` before the header and feed (ext@8717683), so "(feed truncated: budget exhausted)" (ext@8727504) cannot trigger at default sizes.
- The kernel is **memoised in one global slot**, so it is reused with frozen snippets. Anything added since the last rebuild arrives as a trailing `=== KERNEL UPDATES ===` message.
- After **every** completed update-cycle (UC), `api_conversation_history.json` is cut to the last `2×raw_tail_keep` messages (20) and saved. This happens even when nothing was extracted.
- The extractor never sees the agent's prose. Assistant `text`/thinking blocks are dropped from RAW_TAIL.
- Dead or broken features:
  - `update_change_visibility` is dropped by the parser.
  - The "zero refs" retry reads the wrong field.
  - `taocoder_run_update_cycle` has no handler.
  - `taoCoderUpdateCycleCompactionEnabled` is never read.
  - The cockpit's force-UC RPC writes to the wrong file.

## 1. Kernel rendering
The call chain is `RUt` (buildBoundedConversationForRuntime, 25@8746886) → `I0n` (02@8746567) → `Ddd` (ext@8716704; parts at 02@8732398, 21@8739882, 25@8717680).

**Budget.** `aUa` (02@8712632) sets `n=(hot_budget_tokens||target_tokens||20000)*4` chars. Defaults are hot 50 000 and target 25 000 (`DUt` ext@8764972), giving **200 000 chars**. Tokens are always estimated as `ceil(chars/4)` (`tUa` ext@8742940).

**Actual order of the kernel message** (one `user` string):
1. Header `[TaoCoder Task Context Kernel — YOUR PERSISTED MEMORY]` (unbudgeted): trust legend, tool map, comment templates (`связано с ref:`), evidence-UUID rules.
2. **Chronological feed (newest first)** (unbudgeted).
3. `Stage:` and `Role mode:`.
4. `Task`: the spec, the AC with the latest verdict (a stale ref forces `[fail] … auto-fail: stale refs`), and the constraints.
5. `SYSTEM INFORMATION`.
6. Architect deliverables or Ops environment.
7. `Project bible (README_AI.md, one-shot)` (`kdd` ext@8716252): searches root, parent, grandparent and each `docs/`; ≤400 lines, ≤8000 chars.
8. "Results of the last 5 completed tasks (first 3 turns only)" (ext@8731730).
9. `Past task artifacts`: static path pointers.
10. `ALGORITHM` ("Every response MUST be a tool call… Plain text… FORBIDDEN").
11. The mode contract, or the stage objective plus stage prompt (`bUt` 02@8633093), or custom-mode prompts.
12. `Exit criteria (<stage>)`.
13. Tag legend.

The **implementation plan is not in the kernel**. `T0n` (21@8751235) renders it fresh on each request into the trailing message (§2).

**Truncation.** Each line goes through `i()`. Once `o+len>n`, `Ddd` returns what it has, so the *last* sections go first: legend, then exit criteria, then the stage prompt, then ALGORITHM. The spec is cut with "…" by `s()`, which reserves `min(240,n/4)` chars if legacy `negative_knowledge[]` is non-empty.

**Feed** (`Rdd` 21@8714688):
```
items = all relevant_code (incl. resolved/stale) + legacy negative_knowledge/hypotheses/decisions
      + changes(!hidden; 5 newest get full "Diff (SEARCH/REPLACE)") + notes(!hidden, all comments)
      + original_messages (never written: vestigial) + feedback
sort by extracted_at_turn DESC   // = update_cycle.global_turn_counter (+1 per API request); comments/UC touch bump it
```

**Snippets** (`q9a` ext@8605745, `U9` ext@8604592).
- Only `kind:"lines"` refs, and only the **first 25 in storage order**. Refs are `push`ed, so these are the *oldest* 25.
- At most 150 lines each; the char cap is effectively unlimited.
- A missing file or a path outside the workspace gives `[BROKEN]`.
- The live sha256 hash check runs but is **not shown**. `[STALE]` comes only from the stored `ref.stale` flag.

**Cache and KERNEL UPDATES** (RUt; `x0n` 02@8752747):
```
key = taskId:len:sha256(spec|AC|constraints|bible|stageToolHelp|summaries|role_mode)
hit  -> reuse xUt (frozen text + snippets)
miss -> Ddd(); C0n = ids/locators/exit_criteria included
invalidate (_0n): UC applied, transitionStage, updateTaskSpec (ext@8794156, ext@8804742)
```
- **`x0n` lists** new refs (with snippets), `ref-repaired`, `ref-stale` (live hash mismatch), new notes/comments/changes, AC rounds, exit-criteria diffs; ≤10 snippets × 50 lines, 20 000 chars.
- **Forced UC:** if the section reaches ≥10 000 tokens, `pkc` (ext@20298412) sets `pending_force`. The forced UC rebuilds the kernel and folds the deltas back in.
- *[inf]* The single global slot is keyed by taskId, so parallel tasks evict each other.

**Recent task summaries** (`wLa` ext@8506242) come from **all** workspace tasks (any chat) with `status=="done"` and a `task_summary_preview`: newest 5, ≤3000 chars each, ≤15 000 total. They are frozen into `recent_task_summaries_snapshot` at creation and shown, with the bible, until the first request that ran a UC sets `temporary_context_ingested_at` (not "3 turns").

## 2. How the kernel replaces Cline's history
`buildConversationHistoryForApiRequest` (ext@20926598):
```
global_turn_counter++; save
UC if triggered (§3); if applied: history = history.slice(-2*rawTail); persist (SCe ext@8849711)
m = RUt()            // migration (§5), kernel, window; task_context_version++ on every request
tail = KERNEL UPDATES + plan + "User input check…" (if last msg is_direct_user_input) + step-orient nudge
messages = [kernel, ...window, {user: tail}]            // tail is never persisted
repair-planner (wkc) may rebuild via RUt *without* tail
on error -> legacy Cline truncation (ext@20945650)
```
`attemptApiRequest` (ext@20954679) sends `[messages[0], ...FDi(rest, env)]` (`FDi` ext@20398928):
`system | kernel | "=== HISTORY BEGIN ===" | window | "=== LAST MESSAGE ===" | <environment_details> | tail | "=== HISTORY END ==="`.
*[inf]* When a plan exists, "LAST MESSAGE" is the tail, not the latest tool result that ALGORITHM Step 1 tells the model to read.

The repair-planner (`wkc` ext@20310868, main model) fires on an empty plan, an all-done plan, zero or several in_progress items, or an empty spec/AC/constraints. It waits 2 turns before running and can rewrite the spec, AC, constraints and plan.

**Window** (`S0n` ext@8743381):
```
d = min(rawTail 10, 64);  S = min(d+8, max(d, ceil(len/2)))      // S counts message pairs
take last 2S msgs; pull in tool_use partners; drop orphan tool_results; cut at an unanswered tool_use
optional stripping (default off): edit payloads/tool_results -> "[N chars stripped]"
drop from front while chars/4 > 50 000
```
The truncation keeps the stored history at 20–30 messages, so **the whole retained history is sent**. `ui_messages.json`, the chat the user sees, is never truncated.

## 3. Update-cycle
**Trigger** (ext@20928274). Let `M` = user-role messages in the history (every tool result counts) and `N` = `last_processed_turn`. The UC runs if any of these holds:
- `M−N ≥ 5` (`taoCoderUpdateCycleBatchSize`);
- `N>M && M≥10` (stale cursor);
- `pending_force` is set.

The cockpit RPC `triggerTaoCoderUpdateCycle` (ext@21183006) saves with `taskId=chat id`. *[inf]* That writes `tasks/<chatId>/task_context.json`, not the real context, so the button is probably ineffective. `forceUpdateCycleNow` has no callers.

**Window and formatting.** The window is `Qkc(history, 0, min(M,30))`: everything from turn 0, not just the batch. `describe_tool` calls are removed. `C5g` (ext@20324725) formats at most 60 000 chars:
- user string ≤2000;
- `[result]` ≤3000;
- `[info]` ≤1000;
- assistant `tool_use` blocks summarised (paths, ≤800 chars of written content, commands);
- `(thinks)` only when the assistant content is a *string*.

Cline stores assistant content as an array `[thinking, text, tool_use…]` (ext@21004061), so **agent reasoning never reaches the extractor**.

**Model.** `updateCycleApiProvider/ModelId` (both default unset), falling back to the main `this.api`. The 120 s timeout is cleared on the first streamed chunk (ext@20930631).

**Prompt** (`S5g` 25@20337064). Key rules:
- "RAW_TAIL messages… are about to be PERMANENTLY DELETED".
- "A false negative… is WORSE than a false positive".
- Knowledge goes into `add_notes` tagged `hypothesis/decision/negative_knowledge/info/user_message` (user messages get `--- Commentary:`).
- Refs need concrete line numbers; "nothing found" becomes negative_knowledge.
- "Notes are NEVER deleted… remove_note/resolve_note are FORBIDDEN". Visibility uses `hide`/`show` comment tags.
- Plan updates are status-only.
- Raise MISMATCH notes.
- STALE ATTENTION: "Notes are IGNORED".

The input has `Now`, `Turns window`, `BASELINE_TASK_CONTEXT` (task, budgets, relevant_code, changes, update_cycle, documents, notes), the stale block and RAW_TAIL (`Lkc` ext@20364566).

**Output schema** (`v5g` ext@20323006, which reads a ```json fence or the outermost `{…}`): `add_relevant_code_refs[{path,locator,why,confidence}]`, `add_notes[{text,tags}]`, `add_note_comments[{note_id,text,tags}]`, `gc_actions[{kind,key}]`, `update_implementation_plan_items[{id,status∈todo|next|in_progress|done}]`, `resolve_batch[{kind,key,…}]`. **`update_change_visibility` is not copied by `v5g`**, so the prompt's change hide/show does nothing.

**Apply** (`ANr` ext@20387785):
```
delta = LLM(); ≤2 retries "Previous attempt returned zero relevant_code_refs…"
      [inf: dead — checks tool_use.params.path, history uses .input]
createSnapshot("update_cycle:<git HEAD>:0-J")              // after extraction, before merge
B5g sanitise: ref why ≥10 chars, trust=derived, conf 0.7;
      notes matching /[/\\][\w.-]+\.\w{1,6}/ are DROPPED (any file path, incl. the prompt's own example)
P5g dedup: refs by path|hash|lines (existing: update why, max confidence, bump turn); notes by normalised text
O5g last comment tag hide xor show -> note.hidden
F5g resolve_batch: resolve_ref -> stale=true; resolve_note -> DELETES notes; promote_hypothesis -> decision
L5g gc_actions remove/resolve/obsolete/supersede
U5g sweep resolved refs/neg/dec only if human_confirmed, hypotheses if derived   [inf: inverted]
G5g max_items (refs 200, hypotheses 60);  M5g drop oldest legacy hyp/dec while store JSON > 100k (200k hard) chars
Q5g plan statuses;  q5g any "mismatch" note -> ALL in_progress -> todo
empty -> cursor = J + backoff(5|10|15); save; audit; _0n(); BDi() ref repair
return {applied: true}   // ALWAYS -> caller truncates history even when empty
```
The caller's "raw tail preserved"/"Retrying" messages are unreachable. On an LLM or parse failure the error is caught ("failed to update task context. Continuing.") and the cursor and history are left alone; *[inf]* it retries on every request.

**Ref repair** (`BDi` ext@20369960, `R2t` ext@20366862). This runs only after a UC, with ≤25 attempts.
It tries a sliding sha256 window within ±200 lines, then a full-file scan, then the fuzzy anchor. On failure it marks the ref stale and adds a note "… hash-anchor repair failed" tagged `stale, auto-repair-failed`.

**Stale attention** (`I5g` ext@20365516; default on, threshold 15). It lists notes and refs untouched for ≥15 API requests. `resolve_ref` sets `stale=true`, so refs that were merely unused get relabelled `[STALE]` ("Re-read"). Notes appear in the list despite the "ignored" rule.

**"Compaction"** in practice means the history truncation plus the deletions above. Nothing is archived. `taocoder_run_update_cycle` is allow-listed and documented (ext@8628900) but has no handler.

## 4. Task Context store
**Layout.** The root is found by walking up to 5 levels for `.taocoder`, `.git` or `README_AI.md`.
```
.taocoder/.gitignore("*\n!.gitignore") · active_task.json(legacy) · schedules.json
.taocoder/chats/<chatId>/task_context_index.json {chat_id,current_task_id,task_ids[],archived_task_ids[]}
.taocoder/tasks/taskctx_<ms>_<hex12>/ task_context.json · task_context_meta.json · audit.jsonl
     · snapshots/s_<ms>_<uuid>/task_context.json · artifacts/diffs/ · handoff_summary.md · handoff_bundle.json
```
**Schema** (`DUt` ext@8764972, `load` ext@8780757):
- **Identity:** `task_id, chat_id, previous_task_id, schema_version=1, task_context_version, workspace_revision{git|unknown}, role_mode, status, stage, stage_history, exit_criteria`.
- **Update-cycle and ingestion:** `update_cycle{raw_tail_keep, last_processed_turn, global_turn_counter, pending_force, empty_extract_count, …}`, `recent_task_summaries_snapshot, temporary_context_ingested_at, recent_handoffs_ingested_at`.
- **Budgets:** `{hot 50000, target 25000, max_items{relevant_code 200, changes 200, snapshots 200, feedback 400, hypotheses 60, prompt_max_snippets 25, prompt_max_lines_per_snippet 150, …}}`.
- **Task:** `{spec, acceptance_criteria, constraints, implementation_plan[{id≤128, text≤500, status}]}`, `acceptance_criteria_status`.
- **Memory:** `relevant_code[{id, path, locator, anchor{hash|fuzzy}, why, trust, confidence, stale, resolved, extracted_at_turn}]`, `notes[{id, text, tags, trust, source, hidden, comments}]`, legacy `negative_knowledge/hypotheses/decisions`, `changes[{summary, diff_ref, touched_refs, hidden}]`.
- **Other:** `documents/ops/debug, execution_log, user_notes, task_summary, archived_*`, metrics.

**Migrations.** There is no version migrator.
- If `schema_version≠1`, the file is renamed to `task_context.v<N>.<ts>…json` and a fresh context is created.
- On load, in place: stage aliases `free→execution` and `task→analysis`, note defaults, invalid or duplicate plan items dropped, one `next` at most.
- A legacy `.taocoder/task_context.json` is moved into a task directory.

**Writes.**
- `nN` (ext@8766761) writes a temp file and `rename`s it: atomic, no fsync.
- Every save also rewrites the meta sidecar and chat index and appends `task_context_saved` to the audit log.
- Every `load` rewrites the chat index.
- 35 mutators use an in-process per-task mutex (`Uue.runExclusive` ext@8576082).
- The request, UC and RUt paths do unlocked load→save, and there is no cross-process lock. *[inf]* Two windows on one repo are last-writer-wins, and each API request rewrites the file about 6 times.

**Snapshots.**
- `createSnapshot` (ext@8821571) copies the full context.
- It auto-prunes snapshots older than 7 days and keeps at most 50; snapshots tied to a checkpoint are protected.
- It also triggers `Ocd` (ext@8518952), at most once a day, which **deletes this workspace's Cline chat folders older than 7 days beyond the newest 50**.
- `rollbackTo` (ext@8827395) restores only `task_context.json`; truncated history is not restored.
- Cline checkpoints become "compound" (21@16751911 and 21@16762110).

**`audit.jsonl`** (`Zs` ext@8506060, append-only, no rotation): about 38 `task_context_*` events (created/saved, ref/note/change/stage/spec/plan mutations, snapshot/rollback, `update_cycle_applied`, `repair_planner_applied`).

## 5. Knowledge migration and handoff
**Trigger** (RUt). Migration runs when the task has a `previous_task_id` (a new task in the same chat), `recent_handoffs_ingested_at` is unset and the setting is on (default). Its input is the last 2 user messages. It uses the main model with a 120 s timeout (ext@20937010).

**Prompt** (`fdd` 25@8705620): "knowledge migration assistant… select ONLY the knowledge that is RELEVANT… If you are unsure, EXCLUDE". It sees the previous task's refs, its typed notes and its `handoff_summary.md`, and returns `{add_relevant_code_refs, add_notes, task_summary}`.

**Apply** (`Add` 21@8708950):
- The response goes straight into `JSON.parse`, so any surrounding text gives "llm parse failed". The ingested flag is still set, so there is no retry.
- Refs get an empty fuzzy anchor, so they can never become stale *[inf]*.
- Notes get `extracted_at_turn:0`, which puts them at the bottom of the feed.
- `task_summary` is written back to the previous task and appended to its `handoff_summary.md`.
- `user_notes` are copied over at task creation.

**`handoff_summary.md`** (`ldd` ext@8702780) is written on completion: Goal, Result, decisions, negative knowledge, hypotheses, notes, refs, changes (≤8 each). *[inf]* It is called with the Cline chat id (ext@20548388), so it may land outside the `taskctx_` folder that migration reads.

**Handoff** (`taocoder_create_handoff`, architect/ops/debug → developer):
1. `YBi` (ext@20709516) writes `handoff_bundle.json` v2: spec ≤4000, AC/constraints, refs ≤20, decisions ≤50 (stamped `human_confirmed`), negatives ≤50, notes ≤100 with their last 5 comments, changes, `total_cost`.
2. A new developer task is created in the same chat.
3. `mPc` (ext@20711725) merges the bundle with deduplication.
4. The source task is archived.
5. *[inf]* LLM migration also runs on the next request, because nothing sets `recent_handoffs_ingested_at`.

## 6. Metrics accounting
`jC` (ext@20283686) wraps the store's `addCost`, `incrementApiCallCount`, `addTokenMetrics` and `addDuration`. Each keeps a total plus a breakdown into `agent/handover/update_cycle/repair/crash_analyst`.

| type | api_call_count | cost/tokens | duration |
|---|---|---|---|
| agent | +1 per `recursivelyMakeClineRequests` iteration (ext@20979083) | after the stream; cache tokens above the context window clamped to 0 | `now − ts(last api_req_started)` (ext@21002309) |
| update_cycle | +1 per cycle (1–3 LLM calls) | summed from usage chunks | wall-clock of the cycle |
| repair | **only if applied** | only if applied | wall-clock |
| crash_analyst | +1 | tokensIn = in + cacheW + cacheR (different definition) | – |
| handover | +1 at export and +1 at merge | merge **adds the source task's whole total_cost** | bundle write time |
| migration | **none** | none | – |

`duration_ms` is the sum of per-request active time, not task wall-clock; tool execution and user waits are excluded. *[inf]* `api_req_started` fires before context building, so UC, migration and repair time are counted twice.

## 7. Corrections to ANALYSIS.md
1. **§3 kernel order.** It is header → feed → stage/spec/AC/constraints → sysinfo → bible → summaries → artifacts → ALGORITHM → stage prompt → exit criteria → legend. The **plan is not in the kernel**; it sits in an ephemeral trailing message with KERNEL UPDATES.
2. **Budget.** The kernel uses hot = 50k tokens (200k chars, chars/4), and the feed is exempt. `target_tokens` is used only for UC trimming of legacy hypotheses/decisions.
3. **Snippets.** "≤25×150" means the 25 *oldest* line refs, frozen inside the cached kernel, not live every turn.
4. **"Last 5 tasks".** They are workspace-wide (done tasks only) and shown until the first UC, not for 3 turns.
5. **UC.** "User turns" means each user-role API message, i.e. each tool result. The window is turns 0–30, the snapshot is taken after extraction, and the stored API history is **truncated to 20 messages** after every UC.
6. **Stale-ref repair** runs only after a UC. `[STALE]` also marks refs that are merely unused for 15 requests.
7. **Not working:** `taocoder_run_update_cycle`, the cockpit force-UC (likely), UC change visibility.
8. **Notes are not safe.** Notes mentioning file paths are dropped by the sanitiser, and `resolve_note` deletes notes.
9. **Metrics.** Migration is unaccounted, handover copies the source task's cost into the new task, and duration is active time.

## 8. Side note
Leftover debug `fetch("http://127.0.0.1:19345/event")` (ext@20944563) posts error names/messages to a local port.
