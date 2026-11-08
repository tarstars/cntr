# TAO·CODER 3.1.2 behaviour, as Mycelium reproduces it

Written in our own words from the analysis in `~/prj/cntr/analysis/` (CODE_ANALYSIS.md and
`code/*.md`) and from reading TAO's published bundle. No sentence here is copied from TAO. This
document is the source for `src/mycelium/modes/*`, the prompts in `src/mycelium/prompts/*`, the
command lists in `src/mycelium/safety/*` and the extractor rules in `src/mycelium/memory/*`.
Identifiers (stage ids, exit-criteria keys, tool names) are kept as TAO named them so runs can be
compared field by field; Mycelium's own tools are prefixed `myc_` instead of `taocoder_`.

## 1. Modes and pipelines

| Mode | Stages in order | Notes |
|---|---|---|
| architect | architecture_discussion → architecture_doc_product_concept → architecture_doc_target_audience → architecture_doc_design_system → architecture_doc_architecture → architecture_doc_check_all → architecture_doc_roadmap → architecture_doc_decisions → architecture_doc_readme_ai | one document per doc stage; ends with a handoff to a Developer task |
| developer | clarification → data_collection → development → audit → report; `rework` is reachable from audit only | the default mode |
| debug | debug_setup → debug_environment → debug_execution → debug_fix → debug_validation | end-to-end testing against a running app |
| free | execution | no stage machine; memory is still kept |

A task starts in the first stage of its mode. Stage changes go through `myc_set_stage` (Free has none).

## 2. Stage contracts (what the agent is told per stage)

Every contract has a goal, what is allowed, what is forbidden, and how to leave the stage.

**architecture_discussion.** Goal: agree with the owner on scope, the deliverables (which of the
eight documents this project needs) and their order. Allowed: reading the repo, asking questions,
recording decisions and notes. Forbidden: creating or editing any document. Leave when the scope
and the list of deliverables are agreed.

**architecture_doc_<doc>** (product_concept, target_audience, design_system, architecture,
check_all, roadmap, decisions, readme_ai). Goal: write or update exactly one document
(`PRODUCT_CONCEPT.md`, `TARGET_AUDIENCE.md`, `DESIGN_SYSTEM.md`, `ARCHITECTURE.md`,
`CHECK_ALL.md` plus an executable `check_all.sh`, `ROADMAP.md`, `DECISIONS.md`, `README_AI.md`)
together with the owner, then link it to the other documents. Allowed: writing that document,
asking questions, recording decisions. Forbidden: application code. The model may skip a document
the project does not need (for example a design system for a command-line tool) after recording
the decision. The roadmap is cut into phases that each fit one Developer task. README_AI.md is
written last and summarises the others for an agent that has no chat history. The final stage
ends with `myc_create_handoff`.

**clarification.** Goal: understand the task. Write the spec, acceptance criteria and constraints;
confirm the scope with the owner; plan the data-collection steps. Forbidden: changing files.

**data_collection.** Goal: read the code and docs the task touches; record code references,
assumptions and risks; plan the development steps. Forbidden: writing files (write tools are
not available here).

**development.** Goal: implement the plan with tests for every new function, keeping the code
modular and free of workarounds. Before leaving: run `bash check_all.sh` and get it green.

**audit.** Goal: review the change by reading it directly (not from memory): implementation,
tests, docs, integration, security. Give every acceptance criterion a verdict with a comment.
Run `check_all.sh` once at the end. If anything fails, record a rework plan and go to `rework`.

**rework.** Goal: fix what the audit found, run `check_all.sh`, return to audit.

**report.** Goal: summarise what was done, what changed and how to verify it; record the diffs;
finish with `attempt_completion`. Forbidden: changing files or running commands.

**debug_setup.** Choose the end-to-end framework, write the scenarios, prepare test data.
**debug_environment.** Start the infrastructure and the app; confirm a health check passes.
**debug_execution.** Run the scenarios; record results and evidence. Forbidden: fixing code here.
**debug_fix.** Find the bugs behind failures, fix them, re-run the affected scenarios.
**debug_validation.** All scenarios pass, `check_all.sh` is green, docs updated, every acceptance
criterion has a verdict.

**execution (Free).** Do the task directly; keep the memory up to date; run `check_all.sh` before
finishing when the project has one.

## 3. Exit criteria (all start `false`; the agent sets them)

| Stage | Keys |
|---|---|
| clarification | has_task_spec, has_acceptance_criteria, constraints_defined, scope_confirmed, implementation_plan_created_for_data_collection |
| data_collection | sources_listed, data_collected, assumptions_recorded, risks_recorded, implementation_plan_created_for_development |
| development | implementation_done, tests_added, check_all_passed, code_modular, code_production_quality, no_hacks_or_workarounds, no_plan_for_audit |
| audit | implementation_reviewed, tests_reviewed, docs_reviewed, integration_reviewed, security_reviewed, check_all_passed, rework_plan_recorded_if_needed, audit_completed, ac_statuses_updated |
| rework | fixes_applied, check_all_passed |
| report | report_written, diffs_recorded |
| architecture_discussion | arch_scope_confirmed, deliverables_defined, decisions_recorded |
| architecture_doc_<doc> | <doc>_written, <doc>_cross_linked, decisions_recorded (doc = product_concept, target_audience, design_system, architecture, check_all_doc, roadmap, decisions_doc, readme_ai) |
| debug_setup | e2e_scripts_written, e2e_framework_selected, test_data_prepared |
| debug_environment | infra_started, server_started, health_check_passed |
| debug_execution | e2e_scripts_executed, results_recorded, evidence_collected |
| debug_fix | bugs_identified, fixes_applied, tests_revalidated |
| debug_validation | all_e2e_passed, check_all_passed, docs_updated, ac_statuses_updated |
| execution | spec_finalized, plan_created, implementation_done, tests_added_or_verified, check_all_passed, docs_updated |

Meanings are in `src/mycelium/modes/pipelines.ts` (one line each). `check_all_passed` means
"`bash check_all.sh` ran in the project and every check was green".

## 4. Auto-plan

Entering a stage replaces the plan with that stage's starter items (our wording), e.g.:
- development: implement the planned change; add tests for every new function; update docs; run check_all.sh until green.
- audit (7 items): re-read the diff; check tests; check docs; check integration points; check security; give every acceptance criterion a verdict; run check_all.sh once at the end.
- architecture_doc_<doc> (4 items): read the existing document and related ones; agree the content with the owner; write or update the document; add cross-links.

## 5. Tool access per stage

Base tools in every stage: `ask_followup_question`, `new_task`, `read_file`, `list_files`,
`search_files`, `list_code_definition_names`, plus all `myc_*` memory tools (`myc_set_stage` is
absent in Free). Additional tools:

| Stage | Extra tools | Flagged "needs confirmation" | Completion |
|---|---|---|---|
| clarification | execute_command, web_search, web_fetch, use_mcp_tool, access_mcp_resource, load_mcp_documentation | execute_command | no |
| data_collection | same as clarification + browser_action | execute_command | no |
| development | write_to_file, replace_in_file, apply_patch, new_rule, execute_command, web_search, web_fetch, browser_action, MCP tools | browser_action | no |
| audit | execute_command, MCP tools | execute_command, use_mcp_tool, myc_create_handoff, myc_set_stage | no |
| rework | same as development | browser_action | no |
| report | attempt_completion, summarize_task, generate_explanation, MCP tools (no files, no commands) | myc_set_stage | yes |
| architecture_discussion | execute_command, web_search, web_fetch, MCP tools, attempt_completion | execute_command | yes |
| architecture_doc_* | write_to_file, replace_in_file, apply_patch, execute_command, web_search, web_fetch, MCP tools, attempt_completion | write_to_file, replace_in_file, apply_patch, execute_command | yes |
| debug_setup | write tools, execute_command, web, MCP tools | execute_command | no |
| debug_environment | write tools, execute_command, web, MCP tools | execute_command, write tools, use_mcp_tool | no |
| debug_execution | execute_command, web, MCP tools | execute_command | no |
| debug_fix | write tools, new_rule, execute_command, browser_action, web, MCP tools, attempt_completion | browser_action | yes |
| debug_validation | execute_command, web, MCP tools, attempt_completion | execute_command, myc_set_stage | yes |
| execution (Free) | every tool | none | yes |

Cline's own `plan_mode_respond`, `act_mode_respond` and `focus_chain` are never offered while a
Mycelium task is active. A disallowed tool is removed from the tool list sent to the model and is
rejected again at execution with a message naming the stages that allow it.

## 6. Stage gate (`myc_set_stage`)

Checks, in order: the target is valid for the mode; a reason and evidence are given (evidence ids
must exist in memory — in `tao` only when given as an id object); the current stage's exit
criteria pass (`tao`: no key is explicitly false; `improved`: every key is true); leaving audit or
a validation stage requires a verdict with a comment on every acceptance criterion; entering
report requires every criterion to pass. On success the history gets an entry, the target stage's
criteria reset to false and its auto-plan is loaded. In `tao` any pipeline stage may be targeted;
in `improved` only the next stage, `rework` from audit, or an explicit step back with a reason —
skipping forward asks the owner. Moving to rework exempts the review criteria.

## 7. Command safety

Classification order: user blacklist → built-in blacklist → user "requires approval" → user
whitelist → built-in whitelist → unknown.

Built-in blacklist (matched anywhere in the command): `rm` (any form), `sudo`, disk tools
(`dd`, `mkfs`, `fdisk`, `parted`, `mkswap`), `chmod 777`, `chown`, `passwd`, user and group
administration, `shutdown|reboot|halt|poweroff` and the `init` command (as a whole word, grouped
correctly, so `git init` and `npm init` are not caught), piping a download into a shell, redirecting
into `/dev/`, `mount`/`umount`, firewall and routing tools, and destructive git commands
(`git checkout -- <path>`, `git checkout .`, `git restore .`, `git reset --hard`, `git clean -f`).

Built-in whitelist (matched against the first command): read-only shell tools (`ls`, `cat`,
`head`, `tail`, `grep`, `rg`, `find`, `wc`, `pwd`, `echo`, `which`, `env`, `tree`, `du`, `df`),
read-only git (`status`, `diff`, `log`, `show`, `branch`, `remote`), everyday git
(`add`, `commit`, `push`, `pull`, `fetch`, `switch`, `checkout <branch>`, `stash`, `tag`),
package managers (`npm`, `npx`, `pnpm`, `yarn`, `pip`, `uv`, `poetry`), build and test tools
(`make`, `cargo`, `go`, `pytest`, `jest`, `vitest`, `mocha`, `tsc`, `eslint`, `biome`, `prettier`),
interpreters (`bash`, `sh`, `python`, `python3`, `node`, `deno`), `docker build|ps|logs|exec`,
`mkdir`, `touch`, `cp`, `mv`.

`tao`: only the first command of a chain is whitelisted, interpreters count as safe, and with
auto-approve-all every non-safe command runs except `rm` and `git checkout --`. `improved`: every
command in a chain is classified, interpreters are unknown unless whitelisted by the owner, and
blacklisted commands always ask.

## 8. Memory kernel (one message rebuilt for each request)

Sections: a header that tells the model this is its persistent memory and how to update it; a
feed of code references, notes and changes, newest first; stage and mode; the spec, acceptance
criteria with their latest verdicts, and constraints; system information; the project bible
(README_AI.md, at most 400 lines); summaries of the last five finished tasks in the workspace;
an algorithm that says every reply must be exactly one tool call; the stage contract; the stage's
exit criteria; a legend of the tags. `tao`: the feed is not counted against the budget, sections
after it are dropped first when space runs out, snippets come from the 25 oldest line references,
the kernel is reused until the spec, the stage or an update-cycle changes it, and the plan travels
in a separate tail message. `improved`: everything counts against the budget, the feed is trimmed
oldest-first, snippets come from the 25 most recent references and are re-read each time, and the
plan is part of the kernel.

## 9. Update-cycle extractor rules

The extractor receives the current memory and a transcript, and returns JSON only. Rules:
- missing a fact is worse than recording a duplicate;
- record code references with real line numbers and why they matter;
- record findings as notes tagged hypothesis, decision, negative_knowledge (something checked and
  ruled out, or "nothing found") or info; record the owner's messages as user_message notes;
- only update the status of existing plan items, never their text, and never change the spec;
- comment on an existing note instead of repeating it; mark a mismatch between notes and code;
- resolve references that no longer apply.

`tao`: triggers after 5 user-role API messages (each tool result counts), reads turns 0..30 without
the model's own text, drops notes that mention a file path, deletes resolved notes, and cuts the
stored history to the last 20 messages afterwards. `improved`: triggers after 4 assistant replies or
30 000 history tokens, reads only unprocessed turns including the model's text, keeps every note
(resolved notes are marked), and keeps the history.

## 10. Repair planner and knowledge migration

Repair triggers: an empty plan, a plan with everything done, no item in progress, several items in
progress, an empty spec, empty acceptance criteria or empty constraints. The first detection is
recorded; if the problem is still there two requests later, a model call proposes plan items and
fills empty fields (JSON). Migration: when a task follows another (same chat, or a handoff file),
one model call selects the references and notes from the previous task that matter for the new
task's request and copies them, with a short summary; when unsure, it leaves things out.
