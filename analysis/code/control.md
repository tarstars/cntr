# CONTROL: modes, stages, gates, tools, command safety, JEV (TAO·CODER 3.1.2)

Citations: `NN @off` = `novel_ext/chunks/NN_*.js` unit at bundle offset; `B @off` = `dist/extension.js` byte offset. [inf] marks inference.

## 1. Built-in modes

**Pipelines** (`getStagePipeline`, 18 @8543240) are as in ANALYSIS §2. Initial stages come from `rN` (18 @8529592). The only off-pipeline target is `rework`, and only for developer (`SFg`: `t==="developer"&&n.add("rework")`, B @20492723).

**Stage contracts** (`bUt`, 02 @8633093). Each contract has a mode preamble plus `"Source of truth: Tool directory (stage-filtered) + this Stage contract"`, then Goal/Allowed/Forbidden/Activities. Key lines:
- clarification: plan "for the **data_collection** stage ONLY (5-12 steps)".
- development: "Run `bash check_all.sh` — MUST be GREEN", "Tests are MANDATORY for every new function".
- audit: "**by direct reading only, never from memory**"; run check_all "**once at the very end**"; "`check_all_passed` and `*_reviewed` criteria do NOT block transition to rework".
- Task: "exactly `./tasks/<name>.md`".
- The Allowed/Forbidden bullets are also copied into `TAOCODER_STAGE_RESTRICTIONS` as "Разрешено/Запрещено" (`dju`, B @16123440).

**Exit criteria** `BW` and their descriptions `a7a` are in 18 @8544378. Beyond ANALYSIS §2:
- clarification adds `implementation_plan_created_for_data_collection`; audit adds `rework_plan_recorded_if_needed, audit_completed, ac_statuses_updated`
- report: `report_written, diffs_recorded`; rework: `fixes_applied, check_all_passed`
- each architect doc stage: `<doc>_written, <doc>_cross_linked, decisions_recorded`
- analysis: `task_files_created, code_references_included, user_approval_received`

All keys are seeded `false` at task creation (`Qhn`, B @8576897).

**Auto-plan** (`Hcd`, 02 @8531121) covers `<mode>:_initial`, `developer:audit` (7 items) and the 8 architect doc stages, all `existing_plan_policy:"clear"`. It is applied twice per transition (store, B @8764218, then handler); the second write wins.

**Architect document choice.** One stage maps to one document by stage id. `architecture_discussion` forbids "Creating or editing ANY document on this stage". The model decides which documents are needed ("For a CLI utility without UI → TARGET_AUDIENCE and DESIGN_SYSTEM may be skipped"), records the order as a decision note, and jumps with `taocoder_set_stage(to_stage=…)`. Skipping works because any pipeline stage is accepted (§3). The code has no allowlist of document paths; the `documents` list (`PUt`) is only displayed.

**Inconsistencies [code]:**
- The readme_ai contract ends "taocoder_set_stage → architecture_docs", and the set_stage spec lists "architect: architecture_discussion → architecture_docs". `architecture_docs` is not in the pipeline, so the call fails with "Invalid to_stage". `attempt_completion` is allowed in that stage.
- The ops and debug contracts say "→ report", but `report` is not in those pipelines either.

**Task mode.** `analysis` = `udi` (all tools except set_stage, plan/act_mode_respond and focus_chain), with no confirmations. Writes are limited by `C90` (B @16150263) to `tasks/<name>.md`: "In Task mode, only .md files…". Its exit criteria are never enforced [inf: no set_stage, and `completeTask` has no criteria check, B @20540550].

## 2. Tool gating

**Policy table** `Gbt` (18 @16132956). `deny` is always empty; `taocoder_jev_validate` is added everywhere. Where `requireConfirm` is non-empty:

| stage | requireConfirm |
|---|---|
| clarification, data_collection, debug_setup/execution | execute_command, manage_connections |
| development, rework, debug_fix | browser_action (+manage_connections) |
| audit | execute_command, use_mcp_tool, taocoder_create_handoff, taocoder_set_stage |
| report | taocoder_set_stage |
| ops_change / ops_validation / ops_escalation | writes+exec+MCP / …+attempt_completion / exec, set_stage, attempt_completion |
| architect doc stages | write_to_file, replace_in_file, apply_patch, execute_command |

`attempt_completion` is allowed only in report, ops_validation, ops_escalation, debug_fix, debug_validation and the architect stages. Audit lacks web_search and web_fetch.

**Evaluation** (`evaluateStageToolPolicy`/`Iju`, 18 @16153041):
```
task-mode write tool with path → C90 path rule
invariant deny (only focus_chain: "hidden in TaoCoder") ; free → allow
prof = custom ? {allow:allowed_tools, deny:forbidden_tools, requireConfirm:∅} : Gbt[effectiveStage]
deny → "explicitly forbidden" ; requireConfirm → allow+confirm
allow empty → allow (custom: empty allowed_tools = all) ; allow.has → allow ; else "Tool is blocked in S stage"
then MCP (x90) / REST (R90) server policies
```
The MCP "dangerous substring" rule (`delete…spawn`, 00 @16154184) fires only when `forbidden_mcp_servers` is non-empty (00 @16151866). It is dormant in built-in modes.

**Enforced twice:**
1. *Before the model call.* Disallowed tools are removed from both the XML "Tool directory (stage-filtered)" and the native tool list (`Wbt` in `getEnabledToolSpecs`/`getNativeTools`, B @16163979, @16164836).
2. *After the call.* `ToolExecutor.execute` re-checks (19 @20835426) and returns `Tool '${name}' is blocked in stage '${stage}'. ${reason} Use taocoder_set_stage to switch to the appropriate stage instead. This tool is allowed in: …`. After 3 repeats it adds "STILL blocked … Do NOT call … again"; after 5 the mistake counter is maxed, which triggers Cline's mistake-limit prompt.
   - Fail-open: if Task Context cannot be loaded, the check is skipped and `stage_policy_skipped_no_task_context` is logged (B @20840364).

**`requireConfirm` does nothing in practice [code + inf].** The executor forces the auto-approver to `false` only when Cline's `shouldAutoApproveTool(name)` already returns false: `(typeof R=="boolean"?R:R[0]||R[1]) || (r={...r,autoApprover:{shouldAutoApproveTool:()=>!1…}})`.
- If auto-approve covers the tool (category setting, YOLO, `autoApproveAllToggled`, `taoCoderAutoApproveTools`, task `auto_approve_tools`; B @20460357), no confirmation is forced.
- If auto-approve is off, the tool asks anyway.
- `taocoder_set_stage` and `taocoder_create_handoff` never call ask at all. Their "needs ok" is only a label in the tool directory (`bju`, 18 @16132742).

**Autonomous runs** add "AUTONOMOUS MODE… Do NOT ask the user" (B @16124089); `ask_followup_question` auto-answers and escalates after 3 attempts (B @20536357).

## 3. `taocoder_set_stage` (01 @20492924; store `transitionStage` B @8794099)

```
load ctx | free → error | custom: load mode stages
target = to_stage ∈ pipeline(+rework dev) | omitted → next stage ("Already at the last stage")
require reason, evidence_refs
  object {refs,changes,decisions,negative_knowledge,hypotheses,notes}: every ID must exist → "Evidence validation failed"
  array form: id-only entries resolved from relevant_code, NOT validated
pre_update ∈ off*|if_needed|always ; pre_update_apply ∈ never|if_needed*|always
current-stage exit criteria: keys explicitly false block
  exempt: target rework → check_all_passed, *_reviewed, ac_statuses_updated; custom → BW keys of same-named stage
built-in: leaving audit|ops_validation|debug_validation (any target): every AC latest ≠ pending AND has comment
          entering report: every AC latest == pass
custom: acceptance_criteria_gate of current stage
required_secrets of TARGET stage (custom): known key & set (exceptions → warn, fail-open)
pre_update==always: dry-run update cycle; pending → apply with checkpoint_id||git HEAD (never → error)
stage_exit hooks: cancel → error; askApproval → only logged
transitionStage: re-check, target≠current, reset target criteria=false, push stage_history,
  init plan, audit event, invalidate kernel
say "Stage transition: A → B / Reason / Exit criteria / Evidence / Next"; Cline hooks; applyAutoPlan
catch: if_needed && "exit criteria not satisfied" → pre-update + retry
```
- **`pre_update`.** `always` *does* run an update cycle, although the spec calls it "a no-op". `if_needed` reacts only to a store exception, but the handler has already returned an error for unmet criteria, so it is dead code [inf].
- **`stage_history` entry.** `{from,to,at,reason,validated:true,evidence_refs,evidence_ids?,actor:"agent"}`. Role switches log `validated:false`.
- **Failure.** A tool error is returned and state is unchanged.

**Exit criteria and AC tools:**
- `taocoder_update_exit_criteria` (18 @20724093) writes only the *current* stage (a `stage` argument is ignored) and only existing keys. No evidence is required; the flags are self-reported.
- `taocoder_update_acceptance_criteria` (18 @20720526) accepts `statuses:[{index,status,comment?,ref_ids?,change_ids?}]` and `criteria:{index:text}`. Each call appends a round `{round_id,created_at,items}` (B @8799371); the latest status per index wins.
- The AC handler allows only `audit, ops_validation, debug_validation, report, free_flow, clarification`. `free_flow` is not a stage id (Free uses `execution`), so the tool always errors in Free mode, and architect stages show the tool but reject it.

## 4. Custom modes (TAO·MODES)

**Schemas** (zod, 18 @8520136):
- `mode.json`: `id, name, description?, active=true, hidden=false, global, rules_available/mcp_available/skills_available=false, system_prompt, required_secrets?, stages[{id,prompt?,config?}]≥1, extends?, project_bible_enabled=true`.
- Stage file: `id, name, description?, stage_prompt, init_plan_items?, allowed_tools/forbidden_tools/full_tool_instructions (array|{$ref}), default_exit_criteria?, required_secrets?, hooks[{name,on,action,params}]?, allowed/forbidden_mcp_servers?, allowed/forbidden_rest_api_servers?, allowed_write_paths?, acceptance_criteria_gate none*|non_pending|all_pass`.
- Paths resolve against `~/.taocoder` or `<repo>/.taocoder`; stage config defaults to `<modeDir>/stages/<id>.json` (`pCe`, 18 @8523661).
- `$ref` has a traversal guard (B @8527827); template variables `{{task}}…{{date}}` are substituted (`Fue`).
- Invalid stage files are skipped with a log line only.

**Exit-criteria keys must match `^[\p{L}][\p{L}\p{N}_ \-\/()]*$`** (`l7a`, B @8576562). Other keys are dropped silently when seeded. This drops 6 of the 42 shipped criteria, e.g. "taocoder_validate_mode возвращает valid: true (0 ошибок)" and "mode.json создан…". Those 6 are never gated [inf].

**Loading precedence** (`Ah`, B @8525481): an explicit `global:`/`project:` prefix wins; otherwise project is tried before global. Built-in modes are seeded into `~/.taocoder/modes` only if absent, so updates do not propagate (B @22564632).

**`extends` is ignored at runtime.** Only `compileMode` merges the parent (10 @20732020, 19 @20732234), and only validate_mode's dry-run calls it.

**`taocoder_validate_mode`** (`mode_id`, `validation_mode` = static|dry-run|full, default full; B @20746239). The mode must first load via `Ah`.
- static (19 @20738708): files and `$ref`s exist; forbidden ∩ full_tool_instructions; duplicate stage ids; unknown tools; unknown hook actions/events; MCP allowed ∩ forbidden; extends cycle. Warning: "empty array means all tools are allowed".
- dry-run (19 @20744034): compiles to Markdown with dummy variables, then checks sections, leftover `{{…}}` and empty prompts.
- The tool is in no built-in allowlist, so it is visible only in custom/Free/Task modes.

**Hook engine** (01 @20482856; `oz` B @20477485):
- Events: `stage_enter, stage_exit, tool_call`. Actions: `request_approval, require_handoff, log, notify, jev_validate`.
- `oz` runs matching hooks in order and returns the first `cancel`/`askApproval` result. Errors are logged and ignored (fail-open).

| where | hooks run | effect |
|---|---|---|
| set_stage `stage_exit` | all | `cancel` blocks; `askApproval` → `M.info("[HookBridge] Approval requested")` only |
| attempt_completion `stage_exit` (01 @20543577) | all | result ignored |
| execute_command, write_to_file/replace_in_file, apply_patch `tool_call` (00 @20569868, @20531765) | only `name==="require_approval"\|\|action==="request_approval"` | cancel blocks; askApproval forces manual approval |
| `stage_enter` | — | never executed |

- `require_handoff` cancels unless `previous_task_id` exists.
- The `jev_validate` hook (01 @20481470): string options return probabilities only. Labelled options `{label,action}` take the winning option's action, or `on_below_threshold` (default `ask_human`) if its probability is under `threshold` (default **0**). Only `cancel` blocks. Per-hook `provider/model/timeout_ms` are ignored (`sBi` reads global settings, 01 @20489918).
- Cline-native StageExit/StageEnter/StageTransition hooks are `isCancellable:!1` (B @20483516).

**`required_secrets`** at mode level is unused at runtime [inf: no other readers among the 12 occurrences], and the first stage is never checked.

**Shipped modes:**

| mode | stages | notes |
|---|---|---|
| mode-builder | clarification → design → implementation → validation | first two forbid write/exec; validation has `taocoder_validate_mode` |
| manage-connections | clarification → execution → validation | `allowed_write_paths:["docs/mcp-rest"]`; MCP/REST setup |
| tao-coder-dev-guide / taocoder-guide | support | read-only Q&A (methodology / product UI) |

None of them use hooks.

## 5. Command safety

`classifyCommand` (`pFg`, B @20465049; 00 @20465135–@20465377):
```
r = whole command (whitespace-collapsed); n = FIRST segment before unquoted ; & | newline (fFg)
user blacklist(r) → dangerous ; built-in ODc(r) → dangerous ; user require_approval(r) → requires_approval
user whitelist(n) → safe ; built-in PDc(n) → safe ; else unknown
```
- **ODc** (blacklist): `rm`, `sudo`, disk tools, `chmod 777`, `chown`, `passwd`, user/group admin, `shutdown|reboot|halt|poweroff|init`, `curl|wget … | sh`, `\b>\s*/dev/`, mount, firewall/route, plus 9 git patterns (`checkout -- …`, `restore .`, `reset --hard`, `clean -f`…). The alternation is ungrouped, so "git init" counts as dangerous.
- **PDc** (whitelist): read-only shell/git, package installs/runs, **`bash`, `sh`, `source`, `python3?`, `node`, `npx`**, mkdir/cp/mv, `git commit/push/checkout/restore…`, build/test tools, `docker build|exec`, linters.
- **Consequence [code]:** only the first segment is whitelisted and interpreters count as safe, so a chained or interpreter command is "safe" unless a blacklist regex matches the full string.
- **User rules:** `<cwd>/.taocoder/command_safety.json` `{schema_version:1, whitelist, blacklist, require_approval, recent_unknown≤50}`. Rules are `{id,pattern,label,created_at}` and mutually exclusive (B @20559169). A pattern is the command minus its last word plus ` *` (`eBi`), matched as an anchored, case-insensitive glob.
- **Approval flow** (handler, B @20565755):
  1. Upstream permission checks and .clineignore.
  2. Classify.
  3. JEV guard (unknown only).
  4. If `taoCoderAutoFileApprovalEnabled`: hard **DENY** of git checkout/restore/stash pop/reset --hard (`YDc`, B @20520512).
  5. `tool_call` approval hooks.
  6. **Autonomous block** if `E||C||(w&&!T)`. E = `git checkout … --`, C = `\brm\b` except `git|npm|docker… rm`/`echo` (B @20564941, @20565005), w = non-safe, T = auto-approve-all.
  7. **Auto-run** if `!hook && !E && !C && ((safe && autoApproveSafe) || (w && T))`. Otherwise ask, with a `REQ_APP` flag and destructive warnings.
  - Buttons send `__CMD_SAFETY__:add_whitelist|block_forever|add_require_approval` (00 @20469751).
- **Blacklisted commands still run without asking under auto-approve-all.** A blacklist hit (built-in or "block forever") only makes the command dangerous, and `w && T` auto-runs it. Only `rm`/`git checkout --` always ask. Subagent executions bypass the decision entirely.

**JEV terminal guard: computed but never used [code].** `w/R` are computed *before* the JEV call. A JEV "safe" verdict only prints "[Terminal Guard] Command classified as safe…", and the "Blocked by Terminal Guard" reason is overwritten by "Not recognized by security policy" (01 @20567596; 00 @20567453, @20568580).

## 6. JEV client

- **Client** `HAe` (01 @20485028): `POST endpoint` with header `Bearer <key>` and body `{model, state, questions:{q1:{type:choice|noul|score, instructions, criteria}}}`; the response has `answers` + `usage`. Endpoints: `api.typesafe.ai/v1/decisions`, `openrouter.ai/api/v1/decisions`, or a custom one.
- **Defaults** (B @7706538–@7706770): off, provider typesafe, model `typesafe/jev-1.13`, threshold 0.7, 10 s, guard off. The key is in secret storage (presence only).
- **Questions asked:**
  - Guard (`noul`, 01 @20561914): "Assess whether the following shell command is SAFE to execute in a development environment. A command is SAFE if it is read-only, non-destructive…"; `noul ≥ threshold` → safe.
  - Hooks: `choice` over option labels with empty state.
  - Tool `taocoder_jev_validate` (01 @20747560): free question, returns the raw response ("the agent must reason about the results itself"). It is listed only when JEV is enabled (18 @16163012).
- **Fail-open everywhere:** `verdict:"skip"`, `{}`, or `{error:"JEV_UNAVAILABLE", fallback:"…Consider proceeding without JEV validation."}`.
- **The expansion is in the code:** "JEV (Justification-Evidence-Verification) decision model" (01 @16254478), and the same in the 3.1 notes of the webview (index.js @3507554).

## 7. File-write protections

- **300-line rule = approval only** (B @20812961). `write_to_file` on an *existing* file with original or new content over 300 lines forces a manual approval with "[WARNING: This will OVERWRITE the entire file (k lines original)…]". This applies unless `taoCoderAutoApproveTools` is on. New files are exempt, and the user can approve. Nothing stops the agent from rewriting a large file.
- **Truncation guard** (`QNr`, B @20519556, `JDc=.5`). Only with `taoCoderAutoFileApprovalEnabled` (default off): new content under 50 % of the original's characters → "DENIED: Truncate risk detected". If the file cannot be read, the write is approved.
- **Path checks:** custom `allowed_write_paths` (`ONr/NNr`, B @20483035) and the Task-mode `tasks/*.md` rule.
- **"Permanently forbidden" commands:** the only hard deny is the git-restore list (§5 step 4, opt-in). User "block forever" rules mean "dangerous", not forbidden.

## Corrections to ANALYSIS.md

1. §2 tool table: "ask" has no practical effect. `requireConfirm` is skipped when auto-approve covers the tool, and set_stage/create_handoff never ask. Audit also lacks web_search and web_fetch.
2. §2 stage gate:
   - Evidence IDs are checked only for the object form.
   - Only keys explicitly `false` block; rework also exempts `ac_statuses_updated`.
   - Leaving audit for rework still requires every AC to be non-pending with a comment.
   - Any pipeline stage can be targeted, so stages can be skipped.
   - `required_secrets` applies to the target stage; `stage_exit` approval hooks only log.
3. `architecture_docs` cannot be reached via set_stage despite the contract and the tool spec; the ops/debug "→ report" transitions fail too.
4. Custom modes: `extends` is ignored at runtime; `stage_enter` hooks never run; exit-criteria keys with `: , . —` are dropped.
5. Command safety:
   - The whitelist checks only the first segment; bash/python/node/npx and `git push` are whitelisted.
   - With auto-approve-all every blacklisted command except rm and `git checkout --` runs automatically.
   - In autonomous mode, rm and `git checkout --` are blocked *even with* auto-approve-all.
6. JEV: "Justification-Evidence-Verification" **is** in the code. The terminal-guard verdict is ignored. 0.7 is the guard's threshold only (hooks default to 0). Hooks block only via `cancel`.
7. "Cannot fully rewrite large files" is only a forced approval prompt above 300 lines, plus an opt-in 50 % truncation deny.
