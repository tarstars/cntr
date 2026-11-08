# Our own TAO·CODER-style agent — design

Date: 2026-11-07. Background for everything below: `analysis/ANALYSIS.md`, `analysis/CODE_ANALYSIS.md` and the
per-subsystem reports in `analysis/code/` (memory, control, runtime, perimeter, ui) in this repo. Those documents
describe TAO·CODER 3.1.2 in detail, with offsets into its bundle; this design refers to them instead of repeating them.

Decisions are marked **[user]** when the user made them and **[my call]** when I made them on the user's behalf;
the user may override any [my call].

## 1. Intent

The user wants **their own source code** of an agent that works like TAO·CODER, in order to experiment with it.
TAO's sources are not available (the GitHub repo named in its package is private; only a minified bundle ships), so
"our own copy" means **our own implementation of TAO's design on top of the same open-source base** — readable,
changeable and rebuildable end to end.

The first experiment: use the agent to build the website **"The world of carnivorous fungi of Uzbekistan"** twice —
once with the agent behaving like TAO, once with TAO's ideas done better — and **compare the two sites visually**
[user]. The fungi project itself is a separate, later piece of work with its own brainstorm; this document covers only
the agent.

## 2. Goals

1. **Build from source** into a `.vsix` the user installs in VS Code on this Linux machine [user].
2. **Run on the user's subscriptions and Eliza**, not on paid API keys or local models [user].
3. **Two behaviour profiles in one codebase** [user wants both; one codebase is my call]:
   - `tao` — behaves like TAO·CODER 3.1.2 by design;
   - `improved` — TAO's ideas with the weaknesses found in the analysis fixed.
   Profile is chosen per workspace (default) and can be overridden per task.
4. **First-build scope** [user agreed]: Architect, Developer, Free and Debug modes; Task Context store; kernel prompt;
   update-cycle; stage machine with tool gating and a stage gate; `check_all.sh` integration; per-task metrics; a
   simple Cockpit panel.
5. **Fair comparison**: both profiles write identical metrics and artifacts, so two runs on the same brief can be
   compared on outcome (the site) and on process (calls, tokens, model time, stage history, real check results).
6. **Experiment-friendly code**: TAO-layer code lives in its own directory with small, documented hooks into the
   Cline core; every behaviour that differs between profiles is decided in one place (a profile object), so new
   experiments are new switches, not new forks.

## 3. Non-goals (first build)

Scheduler and autonomous runs; self-delay; custom modes (TAO·MODES, Mode Builder, guide modes); JEV; REST API hub and
`manage_connections`; Ops mode and deployment; Task mode; handoff between modes beyond Architect → Developer;
crash analyst; any account, subscription or launch-metering system; telemetry; Marketplace publishing; mobile PWA.
Some of these may come later as separate work.

## 4. Anti-goals

- **No copying of TAO's code or text.** Behaviour is reproduced from our analysis; prompts and stage contracts are
  written in our own words with the same structure and intent. (TAO's package declares Apache-2.0, but we do not need
  or use its code.) The analysis does not cover everything the `tao` profile needs (Debug-mode contracts, exit
  criteria and allowlists; full Architect allowlists; complete exit-criteria lists; auto-plan items), so the builder
  **may read TAO's bundle and the extracted chunks** in `~/database/20261107_cntr_proof_site/code/novel_ext/chunks/`
  the same way the analysis did. The first plan step is to write `docs/tao-behaviour.md` in our own words from the
  analysis plus the chunks; implementation follows that document, not the bundle [my call].
- **No network traffic started by the extension itself other than the chosen model providers.** No vendor servers,
  beacons, telemetry, Cline account/banner calls or MCP-marketplace fetches. Traffic the *agent* causes through its tools
  (`npm install`, web search/fetch, the browser, MCP servers, `git push`) is allowed: it goes through the normal
  approvals and is logged [my call].
- **No clash with Cline or TAO·CODER** installed on the same machine: own extension id, own global storage directory
  (not `~/.cline`, which TAO and Cline share), own workspace folder name (not `.taocoder`).
- **No hidden differences between profiles.** Anything the profiles do differently is listed in §7 and in the profile
  object; everything else is shared code.
- **No silent failure in `improved`.** Truncated streams, failed extractions, skipped checks and unloadable memory
  must be visible to the user and recorded in metrics.

## 5. Constraints

- **Base: Cline `v3.79.0`** (tag on github.com/cline/cline, commit `9405419efebb76a518c12daedd87a8b6cfb653b9`,
  Apache-2.0) — the release TAO forked [my call; confirmed by the code analysis]. Keep Cline's LICENSE and add a NOTICE
  for our changes. Add `cline/cline` as the `upstream` remote so later upstream merges stay possible.
- **Machine**: Linux, 31 GB RAM, VS Code installed, Node 18 via nvm (Cline's build may need a newer Node — install the
  version its `.nvmrc`/`engines` asks for via nvm).
- **Filesystem rule (user's global instructions)**: never walk `~/prj` broadly or the network-mounted directories.
  Keep build tools, watchers and the agent's own workspace scans inside
  the project directory.
- **Storage convention (user's)**: compact artifacts in git; large ones (built `.vsix` files, captured prompts, run
  logs, screenshots) in a subfolder of `~/database/`.
- **Models are quota-limited subscriptions**, so extra calls (update-cycle, repair) cost quota, not money; metrics
  must still record tokens and, where the provider reports it, cost.

## 6. Names and locations [my call]

- Working name **Mycelium** (a memory network that grows with the work; fits the first project). Extension id
  `local.mycelium-coder`, display name "Mycelium".
- Agent repo: `~/prj/mycelium` (new git repo, fork of `cline/cline` at `v3.79.0`).
- TAO-layer source: `src/mycelium/` (store, kernel, update-cycle, stages, gate, command safety, metrics, profiles),
  plus Cockpit UI under the webview's own directory.
- Per-workspace data: `<workspace>/.mycelium/` (`tasks/<task_id>/task_context.json`, `audit.jsonl`, `snapshots/`,
  `check_runs/`, `metrics/`, `profile.json`).
- Global data: `~/.mycelium/` (settings and secrets store of our own; see §8.11).
- Large artifacts: `~/database/<date>_mycelium/` (builds, run logs, screenshots).
- Fungi experiment workspaces (later): `~/prj/fungi-uz-tao` and `~/prj/fungi-uz-improved`.

## 7. Profile differences (the experiment's independent variable)

| Area | `tao` (faithful to TAO 3.1.2 design) | `improved` |
|---|---|---|
| Update-cycle trigger | every 5 user-role API messages (each tool result counts) | every N real user/assistant exchanges or when history tokens pass a threshold (builder picks defaults, configurable) |
| Update-cycle failure | retried on every request | retried after 2, 4, 8… (at most 16) requests; a success resets it (`updateCycle.backoffOnFailure`) |
| Extractor input | tool calls and results only; assistant prose/reasoning dropped; turns 0..30 | includes assistant text and reasoning summaries; only turns not yet processed |
| History after a cycle | stored API history cut to last 20 messages, nothing archived | full history archived to disk; prompt uses a window; nothing deleted |
| Note sanitising | notes mentioning a file path are dropped; `resolve_note` deletes | path mentions allowed; resolve marks notes resolved, never deletes |
| Kernel feed | outside the budget, never trimmed | inside the budget, trimmed by recency and relevance |
| Kernel snippets | first 25 line-refs in storage order (oldest), ≤150 lines, kernel cached between cycles | most recently relevant refs first, re-read every request |
| Plan placement | ephemeral tail message | in the kernel |
| Stage targets | any pipeline stage (skipping allowed) | next stage, `rework`, or an explicit "go back" with reason; skipping needs owner approval |
| Gate on exit criteria | blocks only on criteria explicitly `false`; flags self-reported | every criterion must be `true`; `check_all_passed` can be set **only** by the extension after it runs `check_all.sh` itself and gets exit code 0 |
| Evidence ids | validated only in the object form | always validated |
| "Needs confirmation" flags | present but inert (as in TAO) | really ask the owner; stage changes out of audit ask the owner |
| Command safety | TAO's order; whitelist on first segment; `bash/python/node/npx` safe; auto-approve-all runs blacklisted commands except `rm`, `git checkout --` | every segment classified (a lone `&` separates); interpreters and package runners (`npx`, `npm exec`, `pnpm dlx`…) are not auto-safe; `$(…)`, backticks and `<(…)` make a command unknown; `env`/`VAR=` prefixes are looked through; `find -delete` and forced pushes are dangerous; blacklisted commands always ask (`commands.strictShell`) |
| Large-file rewrite | approval prompt over 300 lines unless auto-approve | same prompt, plus the 50 % truncation guard on by default |
| Duration metric | time inside LLM calls (TAO's definition) | recorded as both model time and wall-clock task time (both profiles record both; `tao` *reports* the TAO one on its summary) |

The `tao` profile copies TAO's **design**, not its accidental bugs [my call]: no 5-minute stream cut-off, no 180-second
tool timeout, no debug beacons, no writes to the wrong file, no ungrouped-regex false positives. If fidelity to a
specific bug becomes interesting, add it later as its own named switch.

## 8. Components (both profiles unless §7 says otherwise)

1. **Task Context store.** One JSON per task with TAO's schema as documented in `analysis/code/memory.md` §4: task
   (spec, acceptance criteria, constraints, implementation plan), stage, stage history, exit criteria, relevant code
   refs (path, line range, sha256 anchor, why, trust, stale), notes with tags and comments, changes (diff refs),
   execution log, user notes, metrics; snapshots and rollback; `audit.jsonl` event log; chat → task index. Atomic
   writes; a per-task lock that also covers the request path.
2. **Agent tools.** Equivalents of `set_stage`, `update_task_spec`, `add_relevant_code_ref`, `add_note`,
   `add_note_comment`, `update_implementation_plan`, `update_exit_criteria`, `update_acceptance_criteria`,
   `create_handoff` (Architect → Developer only), registered alongside Cline's tools under our own names.
3. **Kernel prompt.** One message rendered from the store with TAO's sections (header, feed, stage/spec/criteria,
   project bible `README_AI.md`, recent finished tasks, ALGORITHM "every response must be a tool call", stage contract,
   exit criteria, legend), then a window of history and a tail — with the per-profile rules of §7.
4. **Update-cycle.** A separate LLM call that extracts code refs, notes and plan-status changes into the store,
   snapshot first, then merge, per §7. Its model is configurable separately from the main model.
5. **Modes and stages.** Architect: discussion → product concept → target audience → design system → architecture →
   check_all → roadmap → decisions → README_AI, one document per stage, then a handoff to a Developer task.
   Developer: clarification → data_collection → development → audit (⇄ rework) → report. Debug: setup → environment →
   execution → fix → validation. Free: no stages, memory still kept. Stage contracts, exit-criteria lists and auto-plan
   items follow `analysis/code/control.md` §1 in substance.
6. **Tool gating.** Per-stage allowlist (table in `analysis/ANALYSIS.md` §2 and `analysis/code/control.md` §2):
   disallowed tools are removed from what the model sees and rejected again at execution with a message naming the
   stage that allows them.
7. **Stage gate and `check_all.sh`.** As §7. In both profiles the extension records every `check_all.sh` run it can
   observe (command, exit code, duration, log path under `.mycelium/check_runs/`), so the comparison can show whether
   "checks passed" was true.
8. **Command safety.** Classifier with built-in and user rule lists (stored in `.mycelium/command_safety.json`) and the
   approval flow of §7.
9. **Debug mode browser checks.** Use the browser tool Cline already has to open the locally served site, take
   screenshots and save them under the workspace and `~/database/` for side-by-side review. Playwright-based E2E is
   optional.
10. **Metrics.** Per task: API calls, tokens in/out/cache, cost when known, model time, wall-clock time, tool time,
    broken down by call type (agent, update_cycle, repair, handover, migration) **and** by stage; stage history;
    check_all runs. Plus a small script that aggregates a workspace into one JSON/HTML summary (the counterpart of
    TAO's /proof page), so the two fungi runs can be compared in numbers as well as visually.
11. **Providers and model routing.**
    - Claude through the **Claude Code CLI provider** already in Cline 3.79 (uses the user's Claude subscription).
    - ChatGPT through the **OpenAI Codex provider** already in Cline 3.79 (ChatGPT subscription).
    - **Eliza** through a custom-base-URL provider (OpenAI- or Anthropic-compatible, whichever Eliza exposes); the
      connection details come from the user's existing example projects.
    - Routing by role: main agent model, auxiliary model (update-cycle, repair), each selectable per profile and
      per workspace, so both fungi runs can use identical models.
    - Secrets in VS Code SecretStorage (not a plaintext file), never written into prompts, logs or metrics.
    - Risk checked during review: Cline 3.79's Claude Code provider passes the system prompt with `--system-prompt`
      and the whole message array on stdin with `--max-turns 1`, so the kernel + window + tail structure should
      survive it; confirm early in practice. The OpenAI Codex provider talks to `chatgpt.com/backend-api/codex`.
    - Eliza connection details: the owner's private notes, kept outside the repository (the endpoint goes in
      `~/.mycelium/.env`). Authentication: see §12.
12. **Repair planner and knowledge migration** [my call: in the first build, both profiles]. Repair planner: an LLM
    call that fixes an empty or broken plan, spec, acceptance criteria or constraints (TAO's triggers: empty plan,
    all-done plan, zero or several in-progress items, empty spec/AC/constraints; 2-turn delay). Knowledge migration:
    an LLM call that carries refs and notes from the previous task (e.g. the Architect task) into a new task. In `tao`
    they behave as TAO's do (repairs counted only when applied, migration not counted); in `improved` every run is
    announced in chat, shown in the Cockpit and always counted.
13. **Cockpit panel (simple).** A webview showing the current task's profile, stage and stage history, spec,
    acceptance criteria, plan, exit criteria, notes and refs, and metrics; editing of spec, acceptance criteria and
    plan; snapshot and rollback. Visual polish is not a goal.

## 9. How the first experiment will run (context for the builder)

Same brief, same models, two fresh workspaces, one per profile. In each: Architect mode produces the document set and
roadmap; Developer tasks work through roadmap phases; Debug mode checks pages in the browser. Both sites are served
locally and screenshotted; the user compares them visually, with the aggregated metrics alongside.

## 10. Done for this piece of work

- `npm`-based build from the repo produces a `.vsix`; installing it in VS Code works next to Cline and TAO·CODER without
  shared state.
- With each profile, on a throwaway sample project: Architect mode produces the 8 documents plus `check_all.sh` and a
  roadmap; a Developer task completes one roadmap phase through all stages; Debug mode opens a local page and saves a
  screenshot.
- Task Context, audit log, check-run records and metrics appear under `.mycelium/`; the aggregate script summarises
  them; the Cockpit shows them.
- At least one subscription provider and Eliza work as main and auxiliary models.
- No network traffic besides the model providers.

## 11. Left to the builder

Build tooling and Node version; how hooks into Cline core are structured; test strategy and test depth; exact prompt
wording (in our own words, same structure as TAO); Cockpit implementation details; default thresholds for the
`improved` update-cycle; how the aggregate summary looks; Eliza's exact connection setup (from the user's examples);
order of implementation.

## 12. Eliza access [user]

Use the user's **own Eliza access token**, entered once in Mycelium's settings and kept in VS Code SecretStorage;
never written to files, prompts, logs or metrics. Endpoint, wire format (OpenAI- or Anthropic-compatible) and model
names come from the user's example projects (entry point in §8.11). Models stay selectable per role and per
workspace so both fungi runs use identical models.
