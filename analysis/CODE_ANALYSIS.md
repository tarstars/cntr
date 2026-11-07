# TAO·CODER 3.1.2 — code-level analysis

Second pass after [`ANALYSIS.md`](ANALYSIS.md): a function-level diff of the published extension against upstream
Cline, then a module-by-module reading of TAO's own code. Detailed reports with offsets: [`code/`](code/)
(`memory.md`, `control.md`, `runtime.md`, `perimeter.md`, `ui.md`). Everything is static reading — nothing from the
package was executed — so behaviour marked *likely* is inferred from code, not observed.

## 1. Method

- **Bundles.** `dist/extension.js` (22.6 MB, esbuild-minified extension host) and `webview-ui/build/assets/index.js`
  (7 MB React UI) from `thinkingos.tao-coder` 3.1.2.
- **Upstream.** 12 Cline releases from the Marketplace (3.70.0 … 4.0.12, checksums in `data/code/upstream_vsix.sha256`).
- **Fingerprinting** (`scripts/code/fingerprint.mjs`). Every function/class and every statement directly in a function
  or program body is hashed over its token stream with local identifiers normalised away (property names, literals,
  keywords kept), so the same source compiled into two different minified builds hashes equally.
- **Novel code** (`scripts/code/novel.mjs`). Units ≥12 tokens with no hash match in any upstream release; only the
  outermost fully-unmatched unit is reported. Result: **2.2 MB in 4,580 units** in the extension (153 KB of them are
  modified upstream units), **0.9 MB** in the UI. Indexes, hook points and summaries: `data/code/`.
- **Fork point.** Structural match peaks at 3.79–3.82; the model catalogue (has `claude-opus-4-7`, `gpt-5.4`; lacks
  `gpt-5.5`, added in 3.81) fixes it at **Cline 3.79.0, released 16 Apr 2026** — two days before the first
  "TaoCoder IDE" post on the site. Some later upstream changes were probably merged (`data/code/upstream_similarity.tsv`).
- **Reading.** Five parallel readers, one per subsystem; the key claims of each were re-checked against the bundle
  (see §10). Offsets in the reports are JS string indices (UTF-16 units), not byte offsets.

New code sits in five contiguous regions of the bundle (0.75–1.75 MB, 8.5–9 MB, 15.3–16.8 MB, 20.3–21.5 MB,
22.5 MB): TAO's modules plus a few libraries it added (MCP SDK v2 client, luxon, cron-parser, ts-proto codecs).
TAO code is wired into ~40 upstream functions; the main ones are `recursivelyMakeClineRequests`,
`attemptApiRequest`, `buildConversationHistoryForApiRequest`, `presentAssistantMessage`, `initTask`, `ask`,
`cancelTask`, `resumeTaskFromHistory`, provider `createMessage` handlers, `validateAndPrepareFileOperation` and
`getStateToPostToWebview`.

## 2. One turn, as modified by TAO

```text
recursivelyMakeClineRequests
  runtime limits (calls / tool calls / tokens; default 0 = off)
  api_call_count += 1 (type agent), recorded before the call
  mistakes >= 3 → crash_analyst LLM call (off by default) or the usual "mistake limit" ask
  attemptApiRequest
    resolve stage / role mode / run type
    system prompt = Cline builder + stage-filtered tool directory + stage restrictions
    buildConversationHistoryForApiRequest
      global_turn_counter += 1
      if ≥5 new user-role API messages (each tool result is one) or forced: UPDATE-CYCLE (LLM)
          → merge notes/refs/plan statuses → truncate stored API history to 20 messages
      if task has previous_task_id and not yet ingested: KNOWLEDGE MIGRATION (LLM, uncounted)
      kernel = cached or rebuilt; window = stored history ≤ 50k tokens
      tail  = plan + KERNEL UPDATES since the kernel was cached + user-input check (not persisted)
      plan/spec health check → REPAIR PLANNER (LLM) after a 2-turn delay
    send [system, kernel, HISTORY…, LAST MESSAGE, env details, tail]
  stream: each chunk raced against a 300 s timer that is never cleared  ← replies > 5 min cut
  record cost / tokens / duration (agent)  — duration = from api_req_started to end of stream
  presentAssistantMessage → ToolExecutor: stage allowlist re-check → tool handler
  wait for tool + approval with a 180 s timeout  ← longer waits end the loop
  recurse
```

## 3. Memory

- **Kernel** (`Ddd`): one user message. Order: header → **chronological feed** (refs, notes, changes, feedback,
  newest first by `extracted_at_turn`) → stage, spec, acceptance criteria, constraints → system info → `README_AI.md`
  (≤400 lines/8,000 chars) → last 5 *done* tasks of the workspace → past-artifact pointers → ALGORITHM ("Every
  response MUST be a tool call") → stage prompt → exit criteria → tag legend.
- **Budget**: `hot_budget_tokens` 50k → 200k chars (tokens ≈ chars/4). The counter is reset to −999,999,999 before the
  header and feed, so **the feed is never trimmed**; when the rest overflows, the *last* sections (legend, exit
  criteria, stage prompt, ALGORITHM) are dropped first.
- **Snippets**: the first 25 line-refs in storage order — the *oldest* — up to 150 lines each.
- **Caching**: the rendered kernel is memoised (key = spec/AC/constraints/bible/summaries/role mode) and rebuilt only
  after an applied update-cycle, a stage change or a spec update; in between, changes travel in the per-request
  `=== KERNEL UPDATES ===` tail. Over 10k tokens of deltas force an update-cycle. One global slot serves all tasks.
- **The plan is not in the kernel**: it is rendered into the ephemeral tail on every request.
- **History**: Cline still stores `api_conversation_history.json`, but after every applied update-cycle it is **cut to
  the last 20 messages and saved**; the window then sends the whole remainder (≤50k tokens). Nothing is archived.
  `ui_messages.json` (what the user sees) is untouched.
- **Update-cycle**: trigger = 5 new user-role API messages (≈ every 5 tool calls), stale cursor, or force. Input: turns
  0..30 of the stored history, formatted to ≤60k chars, with **assistant reasoning and prose dropped** — the extractor
  sees tool calls and results only. Output JSON: code refs, notes (hypothesis/decision/negative_knowledge/info/
  user_message), note comments, plan statuses, resolve/gc actions. Sanitiser drops any note whose text contains a file
  path; `resolve_note` deletes notes; refs untouched for 15 requests get flagged stale. A snapshot is taken after the
  extraction call and before the merge. It always reports `applied: true`, so the history truncation happens even when
  nothing was extracted.
- **Store**: `.taocoder/tasks/taskctx_<ms>_<hex>/task_context.json` (+ meta, `audit.jsonl`, `snapshots/`,
  `artifacts/diffs/`, handoff files), chat index in `.taocoder/chats/<chatId>/`. Atomic temp-file + rename writes, an
  in-process per-task mutex on most mutators, no cross-process lock; ~6 rewrites per API request. `schema_version=1`
  with no migrator (a mismatched file is set aside and a fresh context created). Snapshot creation also runs a
  once-a-day cleanup that deletes this workspace's Cline chat folders older than 7 days beyond the newest 50.
- **Handoff / migration**: `taocoder_create_handoff` writes `handoff_bundle.json` (spec, AC, ≤20 refs, decisions,
  negatives, notes, changes, `total_cost`) and creates a Developer task that merges it. A new task in the same chat
  also gets an LLM "knowledge migration" from its predecessor (refs, notes, summary; main model, not accounted).

## 4. Control

- **Pipelines** are hard-coded per mode; any pipeline stage (plus `rework` in Developer) may be targeted, so stages can
  be skipped or revisited.
- **Tool gating** is enforced twice: disallowed tools are removed from the tool list sent to the model, and
  `ToolExecutor` rejects any that slip through ("Tool 'x' is blocked in stage 'y' … Use taocoder_set_stage"); 3 repeats
  add a warning, 5 force Cline's mistake limit. If Task Context fails to load, the check is skipped (fail-open).
- **`requireConfirm` is inert.** It forces a prompt only when Cline's auto-approve for that tool is already off — which
  prompts anyway. `taocoder_set_stage`/`create_handoff` never ask.
- **Stage gate** (`taocoder_set_stage`): reason + evidence required; evidence ids are validated only when passed as an
  id object; only exit-criteria keys explicitly `false` block; leaving audit/validation stages needs every AC to have a
  non-pending verdict with a comment, entering `report` needs every AC = pass; custom modes add target-stage
  `required_secrets` and `stage_exit` hooks (only `cancel` blocks). On success the target stage's criteria reset to
  false. Exit criteria are self-reported (`taocoder_update_exit_criteria`) or ticked by the owner in the Cockpit;
  `check_all_passed` is never verified by running anything.
- **Custom modes**: zod-validated `mode.json` + stage files (prompt, allowed/forbidden tools, exit criteria, hooks,
  MCP/REST/path restrictions, `acceptance_criteria_gate`). `extends` is ignored at runtime, `stage_enter` hooks never
  run, exit-criteria keys with `: , . —` are dropped. Built-in JSON modes are copied to `~/.taocoder/modes` once and
  never updated.
- **Command safety**: user blacklist → built-in blacklist → user require-approval → user whitelist → built-in
  whitelist (first command segment only; `bash`, `sh`, `python`, `node`, `npx`, `git push` count as safe) → unknown.
  Non-safe commands ask — unless auto-approve-all is on, in which case **every blacklisted command except `rm` and
  `git checkout --` runs unasked**. Autonomous runs block `rm`, `git checkout --` and non-safe commands without
  auto-approve-all. Subagent executions skip the decision. The blacklist regex `\bshutdown|reboot|halt|poweroff|init\b`
  is ungrouped, so `git init` is "dangerous".
- **JEV**: an external decision API (`typesafe/jev-1.13`, off by default). The terminal guard asks it about unknown
  commands but the approve/auto-run flags are computed **before** the call, so its verdict never changes the outcome.
  Hooks default to threshold 0 and block only via `cancel`; everything fails open. The
  "Justification-Evidence-Verification" expansion does appear in the tool description and the UI release notes.
- **Large files**: rewriting an existing file over 300 lines forces an approval unless auto-approve is on; an opt-in
  setting adds a hard deny when new content is under 50 % of the old. Only the opt-in git-restore list is hard-forbidden.

## 5. Runtime

- **Auxiliary LLM calls**: `update_cycle`; `repair` (planner for empty/broken plan, spec, AC or constraints, counted only
  when applied); `crash_analyst` (post-mortem with six verdicts at the mistake limit, stream failure, exhausted retries
  or the catch-all; off by default; its "corrective guidance" goes to the UI only); knowledge migration (uncounted).
  `handover` is accounting, not an LLM call. Malformed tool calls are normalised by a deterministic parser (DeepSeek
  DSML tokens, `<invoke>`, OpenAI-style), not by a model.
- **Scheduler**: `.taocoder/schedules.json`; fs.watch + 60 s tick while VS Code runs; cron evaluated in **UTC** whatever
  `timezone` says; a missed-run dialog that does not stop the run; stale `running_task_id` blocks for 24 h; scheduled
  tasks are created in the background from a template (spec + constraints; AC not cloned).
- **Autonomy**: run types `manual | scheduled | self_delay | inherited_autonomous`. The "AUTONOMOUS MODE … Do NOT ask
  the user" preamble is unreachable (only built when no stage is set). Autonomy actually comes from auto-answered
  follow-up questions (escalate after 3), auto-continue in crash asks, command blocking, and `auto_approve_tools`.
- **Self-delay** parks the task on a resume ask; the scheduler resumes it only if that chat is in the foreground.
- **Parallel tasks**: an `activeTasks` map, 500 ms throttled background UI updates, a running-tasks view (including
  stopped tasks found on disk), completed tasks disposed after 300 s, per-task pause/cancel.
- **Providers**: non-streaming branches added to most handlers; DeepSeek provider narrowed to one `deepseek-flash`
  model (V4.1, 1M context) with UTC peak-hour pricing; DeepSeek V4 ids treated as reasoning models; Qwen catalogue
  extended (3.5–3.8, US/HK regions); new NeuralDeep (`api.neuraldeep.ru`) and SiliconFlow-international providers;
  `HTTP-Referer: thinkingos.tech`, `X-Title: TAO·CODER` on Cline/OpenRouter/Requesty/Vercel/Z.ai. No automatic model
  selection; prompt capture exists but is hard-disabled. Several upstream features are hard-switched off by constant
  flags (YOLO, auto-condense, focus chain, separate plan/act models, strict plan mode).

## 6. Perimeter

- **Secrets**: `~/.cline/data/secrets.json` (plain JSON, 0600) with a one-time copy from VS Code SecretStorage — this is
  **upstream Cline behaviour** (identical in 3.78/3.84/4.0.12), so the site's "SecretStorage" claim is wrong but the
  design is inherited. TAO adds custom keys, 100 ms polling sync across windows, `{{SECRET:KEY}}` placeholders resolved
  in commands, MCP connect config, MCP/REST tool args and REST headers. Scrubbing of plaintext from MCP/REST configs is
  partial (written back only when MCP JSON is saved from the UI; REST `oauth.clientSecret` never). Command output is not
  masked. Agent-requested secrets travel on a separate channel and never reach the chat or the model.
- **Vendor server** `api.taocoder.thinkingos.tech`: email/password login, bearer tokens (stored in `secrets.json`), a
  random per-session client id; no machine id or workspace data. Logged-in clients fetch subscription status and the
  unread-notification count on **every webview state post**. `POST /api/launch {modeId}` once per new task in any
  non-built-in mode (including the four shipped JSON modes); a refusal ("Launch Limit Reached", "Subscription
  Inactive", …) prevents the task. Built-in modes are unlimited.
- **Telemetry** is forced off (`updateTelemetrySetting` → `disabled`; PostHog/OTel keys only from env). But 11 leftover
  debug beacons `fetch("http://127.0.0.1:19345/event")` post tool names, file paths and errors to a local port.
- **REST hub**: global + workspace settings, OpenAPI 3/Swagger 2 import (query params only), 5-minute GET cache, 100 KB
  response cap, response spill files in `$TMPDIR`. `manage_connections` can add MCP/REST servers (MCP ones are not
  persisted).

## 7. What the owner sees and controls (UI)

- **Mode slider** Arch/Task/Dev/Ops/Dbg/Free (replacing Plan/Act), Mode Help, custom-mode dropdown; stage changes show
  as cards; no pipeline graphic.
- **Cockpit** (bottom panel): Plan (stage policy, **exit-criteria checkboxes with Save**, stage history, spec/AC/plan
  editors), Memory (refs, changes, log, notes, "hide note from agent"), Snapshots (create/rollback), Metrics (calls,
  tokens, cost, duration by call type agent/handover/update_cycle/repair/crash_analyst), Ops. An Autonomous switch
  changes a live task's run type.
- **Settings** added: update-cycle model/batch/raw tail/timeout, budgets, stale attention, knowledge migration, runtime
  limits, provider timeout 300 s, crash analysis, JEV, web search provider (Tavily default).
- **Account**: plan status, "TAO·MODES launches used X / max"; upgrades by contacting the vendor (e-mail/Telegram).

## 8. What this means for the /proof numbers

- **Hours are model time.** `duration_ms` sums time inside LLM requests (agent, update-cycle, repair, handover), not
  tool execution or human waiting. 2,418 h / 180,622 calls ≈ **48 s per call**, consistent with reasoning-model
  latency. Update-cycle time is probably counted twice (inside the agent request window and on its own).
- **Calls** count agent iterations (+1 before each request, retries not counted), update-cycles (1 per cycle, up to 3
  LLM calls), applied repairs, crash analyses and 2 per handover; knowledge-migration calls are missing.
- **Cost** may double-count handoff chains: the merge adds the parent's whole `total_cost` to the child.
- **Lines/files** are not tracked by the agent; the site generator must count them in the repos.
- The 121 calls / $1.44 per task averages are therefore roughly right in scale, with the caveats above.

## 9. Likely defects (static reading)

1. Streams longer than 5 minutes are silently cut (per-chunk 300 s timer never cleared).
2. A tool or approval waiting > 180 s ends the turn loop ("Tool execution timed out").
3. Cron in UTC regardless of `timezone`; missed-run dialog does not stop runs; self-delay resumes only in the foreground chat.
4. `architecture_docs` and ops/debug "→ report" transitions named in prompts are not in the pipelines; the AC tool
   always fails in Free mode (`free_flow` vs `execution`).
5. Cockpit "force update-cycle" saves under the chat id (wrong file); `update_change_visibility` dropped by the parser;
   `taocoder_run_update_cycle` advertised without a handler; one kernel cache slot shared by parallel tasks.
6. `git init`/`npm init` classified dangerous; JEV guard verdict unused; `requireConfirm` inert.
7. MCP servers added via `manage_connections` are not saved; REST requests go out with a literal `{{SECRET:…}}` when a
   key is missing; `manage_connections` reports failure after a successful secret save.
8. Shipped leftovers: 11 localhost debug beacons, a test script with a hard-coded API key for a TaoBridge server (value
   not reproduced), a non-working PWA prototype, broken notifier binary, two 195 KB tailwind logs.

## 10. What was re-verified directly

Re-checked against the bundle (not only taken from the reader reports): fork point and model catalogue; per-stage
allowlist table; `requireConfirm` override condition; auto-run condition `(safe && autoApproveSafe) || (needsApproval &&
autoApproveAll)` and the autonomous block; the ungrouped blacklist regex; JEV guard flags computed before the call;
handover merge adding `bundle.total_cost`; duration measured from `api_req_started`; `addDuration` call sites; 300 s
provider timeout default and the uncleared chunk timer; 180 s wait; kernel budget reset to −999,999,999; history
`slice(-2*rawTail)` after an applied cycle; 11 debug beacons; upstream origin of `secrets.json`; `/api/launch` exemption
list; telemetry forced off; DeepSeek catalogue; NeuralDeep endpoint; Cockpit exit-criteria save RPC.
