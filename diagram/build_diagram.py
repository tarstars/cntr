"""Build diagram/taocoder_teardown.html: a one-sheet map of the TAO·CODER pipeline.

Every box/arrow position is defined here; zone references in the notes are computed
from the same coordinates, so the prose and the drawing cannot drift apart.
Run:  python3 -I diagram/build_diagram.py
"""
import html
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
METRICS = json.load(open(os.path.join(ROOT, "data", "proof_metrics_20261107.json"), encoding="utf-8"))

W, H = 1760, 1440
FX0, FY0, FX1, FY1 = 34, 34, 1726, 1406
NCOL, NROW = 8, 6
CW, RH = (FX1 - FX0) / NCOL, (FY1 - FY0) / NROW
ROWS = "ABCDEF"

SVG = []        # drawing elements in paint order
BOX = {}        # id -> (x, y, w, h)
WARN = []

SANS_EM, MONO_EM = 0.47, 0.6
BODY, MONO, TITLE = 12, 10.8, 11.5


def zone(bid):
    x, y, w, h = BOX[bid]
    cx, cy = x + w / 2, y + h / 2
    return f"{ROWS[int((cy - FY0) // RH)]}{int((cx - FX0) // CW) + 1}"


def esc(s):
    return html.escape(s, quote=False)


def segs(s):
    parts = s.split("`")
    return [(p, i % 2 == 1) for i, p in enumerate(parts) if p]


def rich(s, upper=False):
    out = []
    for p, mono in segs(s):
        if mono:
            out.append(f'<tspan class="m">{esc(p)}</tspan>')
        else:
            out.append(esc(p.upper() if upper else p))
    return "".join(out)


def est(s, size=BODY, upper=False):
    w = 0.0
    for p, mono in segs(s):
        if mono:
            w += len(p) * MONO * MONO_EM
        else:
            w += len(p) * size * (0.6 if upper else SANS_EM)
    return w


def text(x, y, s, cls="tb", anchor=None, upper=False, extra=""):
    a = f' text-anchor="{anchor}"' if anchor else ""
    SVG.append(f'<text class="{cls}" x="{x:.1f}" y="{y:.1f}"{a}{extra}>{rich(s, upper)}</text>')


def badge(x, y):
    """A paid LLM call happens here."""
    SVG.append(f'<g class="badge"><circle cx="{x:.1f}" cy="{y:.1f}" r="7.5"/>'
               f'<text x="{x:.1f}" y="{y + 3.6:.1f}" text-anchor="middle">$</text></g>')


def box(bid, x, y, w, h, title=None, lines=(), kind="", ev="code", lh=15.5, pad=12, money=False):
    """lines: str | (str, cls) | None (half gap). cls 'n' = note, 'h' = subheading, 'c' = cost tone."""
    SVG.append(f'<rect class="box {kind} ev-{ev}" x="{x}" y="{y}" width="{w}" height="{h}" rx="3"/>')
    BOX[bid] = (x, y, w, h)
    cy = y + 20
    if title:
        text(x + pad, cy, title, "tt", upper=True)
        if est(title, TITLE, upper=True) > w - 2 * pad - (18 if money else 0):
            WARN.append(f"{bid}: title too wide: {title}")
        if money:
            badge(x + w - pad - 6, cy - 4)
        cy += 21
    for ln in lines:
        if ln is None:
            cy += lh / 2
            continue
        s, cls = (ln if isinstance(ln, tuple) else (ln, ""))
        up = cls == "h"
        text(x + pad, cy, s, ("tt sub" if up else "tb " + cls).strip(), upper=up)
        if est(s, TITLE if up else BODY, upper=up) > w - 2 * pad:
            WARN.append(f"{bid}: line too wide ({est(s):.0f} > {w - 2 * pad}): {s}")
        cy += lh
    if cy - lh + 7 > y + h:
        WARN.append(f"{bid}: content overflows box bottom by {cy - lh + 7 - (y + h):.0f}px")
    return cy


def pill(x, y, w, h, label, kind="", ev="code"):
    SVG.append(f'<rect class="pill {kind} ev-{ev}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{h / 2}"/>')
    SVG.append(f'<text class="pl" x="{x + w / 2:.1f}" y="{y + h / 2 + 3.6:.1f}" text-anchor="middle">{rich(label)}</text>')


def sym(cx, cy, v, r=4.6):
    if v == "●":
        SVG.append(f'<circle class="dot on" cx="{cx:.1f}" cy="{cy:.1f}" r="{r}"/>')
    elif v == "○":
        SVG.append(f'<circle class="dot off" cx="{cx:.1f}" cy="{cy:.1f}" r="{r}"/>')
    else:
        SVG.append(f'<circle class="dot ring" cx="{cx:.1f}" cy="{cy:.1f}" r="{r}"/>'
                   f'<path class="dot ask" d="M{cx:.1f},{cy - r:.1f} A{r},{r} 0 0 1 {cx:.1f},{cy + r:.1f} Z"/>')


def arrow(pts, label=None, at=None, kind="", ev="code", anchor="start", rotate=False):
    d = "M" + " L".join(f"{px:.1f},{py:.1f}" for px, py in pts)
    mk = kind or "ink"
    SVG.append(f'<path class="ar {kind} ev-{ev}" d="{d}" marker-end="url(#mk-{mk})"/>')
    if label:
        lx, ly = at
        if rotate:
            SVG.append(f'<text class="al" x="{lx}" y="{ly}" text-anchor="middle" '
                       f'transform="rotate(-90 {lx} {ly})">{rich(label)}</text>')
        else:
            SVG.append(f'<text class="al" x="{lx}" y="{ly}" text-anchor="{anchor}">{rich(label)}</text>')


def line(x1, y1, x2, y2, cls="rule"):
    SVG.append(f'<line class="{cls}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"/>')


def band(n, y, title, sub):
    SVG.append(f'<text class="bn" x="50" y="{y}">{n}</text>')
    SVG.append(f'<text class="bt" x="76" y="{y}">{esc(title.upper())}</text>')
    tw = len(title) * 25 * 0.43
    SVG.append(f'<text class="bs" x="{76 + tw + 18:.0f}" y="{y}">{rich(sub)}</text>')


# ---------------------------------------------------------------- frame + zone grid
SVG.append(f'<rect class="sh-bg" x="0" y="0" width="{W}" height="{H}"/>')
SVG.append(f'<rect class="frame-o" x="10" y="10" width="{W - 20}" height="{H - 20}"/>')
SVG.append(f'<rect class="frame" x="{FX0}" y="{FY0}" width="{FX1 - FX0}" height="{FY1 - FY0}"/>')
for i in range(NCOL):
    cx = FX0 + CW * (i + 0.5)
    for yy in (26, H - 17):
        text(cx, yy, str(i + 1), "zl", anchor="middle")
    if i:
        xx = FX0 + CW * i
        line(xx, 10, xx, FY0, "tick")
        line(xx, FY1, xx, H - 10, "tick")
for j in range(NROW):
    cy = FY0 + RH * (j + 0.5) + 4
    for xx in (22, W - 22):
        text(xx, cy, ROWS[j], "zl", anchor="middle")
    if j:
        yy = FY0 + RH * j
        line(10, yy, FX0, yy, "tick")
        line(FX1, yy, W - 10, yy, "tick")

# ---------------------------------------------------------------- band 1: project lifecycle
band("1", 70, "Project lifecycle", "outer loop · one repository · days to weeks")

box("owner", 50, 84, 136, 120, "Owner", [
    "describes the product", "answers questions", "approves criteria", "and the audit result"], ev="site")

box("architect", 226, 84, 640, 208, "Architect mode · 9 stages, one document each", [])
stages = ["discussion", "PRODUCT_CONCEPT", "TARGET_AUDIENCE", "DESIGN_SYSTEM", "ARCHITECTURE",
          "CHECK_ALL", "ROADMAP", "DECISIONS", "README_AI"]
PW, PG = 112, 14
for k, sname in enumerate(stages):
    row, col = divmod(k, 5)
    px, py = 242 + col * (PW + PG), 120 + row * 52
    pill(px, py, PW, 28, f"{k + 1} `{sname}`", kind="doc")
    if col < 4 and k < 8:
        arrow([(px + PW + 1, py + 14), (px + PW + PG - 1, py + 14)])
arrow([(242 + 4 * (PW + PG) + PW / 2, 148), (242 + 4 * (PW + PG) + PW / 2, 160), (242 + PW / 2, 160), (242 + PW / 2, 171)])
pill(242 + 4 * (PW + PG), 172, PW, 28, "`create_handoff`", kind="doc", ev="code")
arrow([(242 + 3 * (PW + PG) + PW + 1, 186), (242 + 4 * (PW + PG) - 1, 186)])
for k, s in enumerate([
        "each stage writes one file with the owner, then moves on with `taocoder_set_stage`; the last one hands off",
        "order shown is the v3.1.2 code order (`architecture_doc_*` stages): README_AI.md is written last",
        ("the site's guide lists a different order: … → ARCHITECTURE → DESIGN_SYSTEM → README_AI → ROADMAP → CHECK_ALL", "n")]):
    s, cls = (s if isinstance(s, tuple) else (s, ""))
    text(238, 238 + k * 16, s, ("tb " + cls).strip())

box("repo", 906, 84, 290, 208, "Project repo", [
    None, None, None,
    "`CHECK_ALL.md` + `check_all.sh`",
    "`README_AI.md` · the project bible",
    "`.taocoder/` tasks · check_runs · modes",
    "`src/` · `tests/` · `e2e/` · `deploy.sh`",
    ("decision ids seen: ADR-NNN, DEC-NNN, D-NN", "n")], lh=16)
for k, (a, b) in enumerate([("PRODUCT_CONCEPT.md", "TARGET_AUDIENCE.md"), ("DESIGN_SYSTEM.md", "ARCHITECTURE.md"),
                             ("ROADMAP.md", "DECISIONS.md")]):
    text(918, 125 + k * 16, f"`{a}`", "tb")
    text(1050, 125 + k * 16, f"`{b}`", "tb")

bx = box("roadmap", 1236, 84, 210, 208, "`ROADMAP.md` phases", [])
for k, (lab, st) in enumerate([("Phase 1", "done"), ("Phase 2", "done"), ("Phase 3", "now"), ("Phase N", "")]):
    yy = 114 + k * 24
    SVG.append(f'<rect class="phase {st}" x="1248" y="{yy}" width="186" height="19" rx="2"/>')
    text(1256, yy + 13.5, lab, "tb")
    if st:
        text(1426, yy + 13.5, {"done": "✓ done", "now": "← this task"}[st], "tb n", anchor="end")
for k, s in enumerate(["owner selects the phase text,", "“Add to TaoCoder”, then types", "«Выполняем Этап N»",
                       ("4–24 phases per repo on /proof", "n")]):
    s, cls = (s if isinstance(s, tuple) else (s, ""))
    text(1248, 228 + k * 15.5, s, ("tb " + cls).strip())

box("ops", 1486, 84, 240, 98, "Ops mode", [
    "`diagnosis → change →`", "`validation → escalation`", "`deploy_remote.sh` → `deploy.sh`,", "Docker on a shared VPS"], lh=15)
box("debug", 1486, 194, 240, 98, "Debug mode", [
    "`setup → environment →`", "`execution → fix → validation`", "E2E tests against the running", "stack (pytest + httpx, Playwright)"], lh=15)

arrow([(186, 144), (224, 144)], "dialog", (205, 138), anchor="middle")
arrow([(866, 188), (904, 188)], "writes", (885, 182), anchor="middle")
arrow([(1196, 188), (1234, 188)], "plan", (1215, 182), anchor="middle")
arrow([(1446, 133), (1484, 133)], "deploy", (1465, 127), anchor="middle")
arrow([(1446, 243), (1484, 243)], "E2E", (1465, 237), anchor="middle")

# ---------------------------------------------------------------- band 2: one task
band("2", 350, "One task", "inner loop inside the VS Code extension (a Cline fork, tao-coder 3.1.2) · minutes to hours")

# column A: triggers + custom modes
box("triggers", 50, 372, 190, 514, "A task starts from", [
    ("chat", "h"), "the owner types a task or", "adds selected ROADMAP text", None,
    ("schedule", "h"), "`.taocoder/schedules.json`", "checked every 60 s while", "VS Code is open; missed runs:", "run now / skip / reschedule",
    "autonomous: no questions,", "`rm` and unknown cmds blocked", None,
    ("handoff", "h"), "`taocoder_create_handoff`", "→ `handoff_bundle.json`", "  + `handoff_summary.md`", "new task id, fresh context",
    ("migration: one LLM call", "n"), None,
    ("self-delay", "h"), "`taocoder_self_delay`:", "the same task resumes later", None,
    ("parallel", "h"), "10+ tasks at once, each with", "its own context and terminals"], lh=15.2)
badge(228, 372 + 20 + 21 + 15.2 * 12 + 7.6 * 2 - 4)  # next to "handoff" heading

box("modes", 50, 922, 190, 150, "TAO·MODES", [
    "custom modes on disk:", "`.taocoder/modes/<id>/`", "`mode.json` + stage files:", "prompt, allowed / forbidden",
    "tools, exit criteria, hooks", ("Mode Builder ships as one", "n")], lh=15.2)

# column B: prompt builder + LLM
box("prompt", 288, 372, 404, 344, "Prompt builder · rebuilt for every LLM request", [])
box("sys", 300, 402, 380, 70, "system prompt · Cline builder", [
    "agent role, stage tool instructions, tool specs,", "MCP servers, rules (`.taocoderules`), skills"], kind="sub", lh=15)
box("kernel", 300, 480, 380, 168, "messages[0] · Task Context kernel", [
    "header: “Task Context Kernel — YOUR PERSISTED MEMORY”",
    "fixed top: mode, stage, spec, acceptance criteria,",
    "constraints, plan, exit criteria",
    "`README_AI.md` (once) · results of the last 5 tasks",
    "rule: “Every response MUST be a tool call”",
    "feed, newest first: code snippets re-read from disk",
    "(≤ 25 × 150 lines), notes, changes",
    ("budget: 25k tokens target, 50k hard", "n")], kind="mem", lh=14.6)
box("recent", 300, 656, 380, 52, "messages[1..n] · recent window", [
    "last 10 raw turns + up to 8 more, capped at 50k tokens"], kind="sub", lh=15)

box("llm", 288, 752, 404, 134, "LLM provider · one paid call per turn", [
    "DeepSeek V4 Flash / Pro recommended; Anthropic, OpenAI,",
    "Gemini, Qwen, OpenRouter, Bedrock, Vertex, Azure, Ollama",
    "reply: exactly one tool call, in Cline's tool format",
    ("/proof average per task: 121 calls · $1.44 · 1 h 37 m", "c")], kind="cost", money=True)

# column C: task context + write paths
box("tc", 740, 372, 392, 248, "Task Context · `.taocoder/tasks/<task_id>/`", [
    "`task_context.json`, the agent's only long-term memory:",
    "task · spec, acceptance criteria, constraints, plan (≤ 50)",
    "stage · stage_history · exit_criteria",
    "relevant_code · path + line range + sha256 anchor;",
    "stale refs are re-found by hash, else flagged",
    "notes · hypothesis / decision / negative_knowledge / info",
    "changes (diff refs) · execution_log · feedback · user notes",
    ("metrics · api_call_count, total_cost, duration_ms,", "c"),
    ("tokens, tool_call_count (summed later on /proof)", "c"),
    "next to it: `audit.jsonl`, `snapshots/<id>/`, `artifacts/diffs/`"], kind="mem", lh=15.6)

box("writes", 740, 648, 392, 238, "Three ways into Task Context", [])
box("uc", 752, 672, 368, 88, "update-cycle · automatic", [
    "every 5 new user turns, or kernel deltas over 10k tokens",
    "extractor reads turns “about to be PERMANENTLY DELETED”",
    "→ JSON: code refs, notes, plan statuses; snapshot, merge"], kind="mem", lh=15, money=True)
box("tools_mem", 752, 766, 368, 64, "taocoder_* tools · deliberate", [
    "`update_task_spec` · `add_relevant_code_ref` · `add_note`",
    "`update_implementation_plan` · `update_exit_criteria` …"], kind="mem", lh=14)
box("cockpit", 752, 836, 368, 44, "Cockpit panel · the owner", [], kind="mem")
text(764, 872, "edits spec / plan / criteria, private notes; snapshot and roll back", "tb")

# column D: stage machine, gate, exit criteria, access matrix
box("stages", 1180, 372, 546, 144, "Stage machine · Developer mode (default pipeline)", [], kind="gate")
dev = ["clarification", "data_collection", "development", "audit", "report"]
widths = [len(s) * 6.3 + 18 for s in dev]
gap = (546 - 24 - sum(widths)) / 4
px = 1192.0
pos = {}
for sname, pw in zip(dev, widths):
    pill(round(px, 1), 404, round(pw, 1), 26, f"`{sname}`", kind="stage")
    pos[sname] = (px, pw)
    px += pw + gap
for a, b in zip(dev, dev[1:]):
    ax, aw = pos[a]
    bx_, _ = pos[b]
    arrow([(ax + aw + 1, 417), (bx_ - 1, 417)], kind="gate")
ax, aw = pos["audit"]
rx = ax + aw / 2 - 28
pill(round(rx, 1), 450, 56, 24, "`rework`", kind="stage")
arrow([(ax + aw / 2 - 8, 431), (ax + aw / 2 - 8, 449)], kind="gate")
arrow([(ax + aw / 2 + 8, 449), (ax + aw / 2 + 8, 431)], kind="gate")
text(rx - 8, 466, "audit fails → rework → audit again", "tb n", anchor="end")
text(1192, 500, "each → is a `taocoder_set_stage(reason, evidence_refs)` call that must pass the gate", "tb")
rep_x, rep_w = pos["report"]
REPORT_TOP = (rep_x + rep_w / 2, 404)

box("gate", 1180, 532, 250, 226, "Stage gate · checks in order", [
    "1  target is in the pipeline, or rework",
    "2  reason + evidence ids, each of",
    "    which must exist in Task Context",
    "3  every exit criterion here is true",
    "4  leave audit: each AC has a verdict;",
    "    enter report: every AC = pass",
    "5  custom modes only: required",
    "    secrets, stage_exit hooks (JEV)",
    ("then stage_history += 1 and the next", "n"),
    ("stage's criteria are reset to false", "n"),
    ("audit → report needs the owner", "n")], kind="gate", lh=14.8)
box("exit", 1446, 532, 280, 226, "Exit criteria · development", [
    "`implementation_done` · `tests_added`",
    "`check_all_passed` · `code_modular`",
    "`code_production_quality`",
    "`no_hacks_or_workarounds`",
    "set true by the agent with",
    "`taocoder_update_exit_criteria`",
    None,
    ("check_all.sh", "h"),
    "`bash check_all.sh` runs typecheck, lint,",
    "tests, doc coverage, integration",
    "log: `.taocoder/check_runs/latest.log`",
    ("no code parses that log: the agent", "n"),
    ("reports `check_all_passed` itself", "n")], kind="gate", lh=14.6)

box("matrix", 1180, 772, 546, 114, "Tool access by stage", [], kind="gate")
for lx, v, lab in [(1490, "●", "allowed"), (1556, "◐", "asks the owner"), (1650, "○", "blocked")]:
    sym(lx, 788, v)
    text(lx + 9, 792, lab, "tb n")
cols = ["clarify", "collect", "develop", "audit", "rework", "report"]
c0, cw_ = 1352, (1714 - 1352) / 6
for k, c in enumerate(cols):
    text(c0 + cw_ * (k + 0.5), 812, c, "tb mh", anchor="middle")
rows = [("edit files", "○○●○●○"), ("run commands", "◐◐●◐●○"), ("change stage", "●●●◐●◐"),
        ("finish (`attempt_completion`)", "○○○○○●")]
for r, (lab, vals) in enumerate(rows):
    yy = 829 + r * 15.5
    text(1192, yy, lab, "tb")
    for k, v in enumerate(vals):
        sym(c0 + cw_ * (k + 0.5), yy - 4, v)

# row E: tool execution
box("exec", 288, 922, 1438, 150, "Tool execution · what one tool call can touch", [])
box("read", 300, 952, 230, 112, "read", [
    "`read_file` · `search_files`", "`list_files` · `search_in_file`", "`list_code_definition_names`",
    ("allowed in every stage but report", "n")], kind="sub", lh=15.5)
box("write", 546, 952, 220, 112, "write", [
    "`write_to_file`", "`replace_in_file`", "`apply_patch` · `new_rule`", ("development and rework only", "n")],
    kind="sub", lh=15.5)
box("safety", 782, 952, 600, 112, "`execute_command` → command safety", [
    "`classifyCommand`: user blacklist → built-in blacklist → user require_approval → user whitelist",
    "→ built-in whitelist → else unknown · blacklist: `rm`, `sudo`, `git reset --hard`, `curl … | sh`",
    "dangerous, requires_approval, unknown → the owner approves · safe → runs if auto-approve allows",
    "JEV (off by default): unknown + noul(“is it SAFE?”) ≥ 0.7 → safe; on an error it fails open",
    "`{{SECRET:KEY}}` is substituted just before the command runs"], kind="gate", lh=14.6)
box("outside", 1398, 952, 316, 112, "outside world", [
    "`use_mcp_tool` · `use_rest_api`", "`web_search` / `web_fetch`: Tavily, Brave, Serper",
    "`browser_action`", ("MCP and REST secrets stay as placeholders", "n")], kind="sub", lh=15.5)

# band 2 arrows
arrow([(1262, 292), (1262, 306), (42, 306), (42, 400), (48, 400)],
      "each roadmap phase becomes one Developer task", (1000, 321), anchor="middle")
arrow([(REPORT_TOP[0], REPORT_TOP[1] - 1), (REPORT_TOP[0], 314), (1400, 314), (1400, 294)],
      "report → phase done, docs updated", (1543, 327), anchor="middle")
arrow([(240, 430), (286, 430)], "start", (263, 424), anchor="middle")
arrow([(740, 560), (694, 560)], "render", (717, 554), anchor="middle", kind="mem")
arrow([(490, 716), (490, 750)], "request", (498, 737))
arrow([(692, 690), (750, 690)], "raw tail", (721, 684), anchor="middle", kind="mem")
arrow([(692, 803), (750, 803)], "tool call", (721, 797), anchor="middle", kind="mem")
arrow([(936, 648), (936, 622)], "writes", (944, 640), kind="mem")
arrow([(1132, 590), (1178, 590)], "reads", (1155, 584), anchor="middle")
arrow([(1300, 516), (1300, 530)], kind="gate")
arrow([(420, 886), (420, 920)], "tool call", (428, 907))
arrow([(1453, 886), (1453, 920)], "allowlist of the current stage", (1461, 907), kind="gate")
arrow([(288, 1010), (264, 1010), (264, 684), (286, 684)], "tool result → next turn", (258, 850), rotate=True)

# ---------------------------------------------------------------- band 3: publication
band("3", 1104, "Publication", "how the task logs become цнтр.рф/proof · and who writes the blog")
flow = [
    ("p_repos", "8 project repos", ["`.taocoder/tasks/*/`", "`task_context.json` (C5)",
                                    "+ ARCHITECTURE, README,", "README_AI docs"], "code"),
    ("p_projects", "`projects.json`", ["in the site repo; which", "repos to show, names,", "status labels",
                                       ("e.g. «Тестируется»", "n")], "site"),
    ("p_gen", "`generate-proof.ts`", ["in the site repo; sums", "per-task metrics, turns", "the 24 docs into HTML",
                                      ("totals = exact sums", "n")], "site"),
    ("p_frag", "HTML fragment", ["between comment markers", "`PROOF_DATA_START`…`END`:", "metric cards + JSON with", "24 docs (1.1 MB)"], "code"),
    ("p_astro", "Astro site", ["Astro 6, ru and en builds", "Docker behind nginx", "on the shared VPS",
                               ("reused for a second site", "n")], "code"),
    ("p_proof", "/proof", ["цнтр.рф/proof", "thinkingos.tech/proof", "same numbers on both", ("updated 6 Nov 2026", "n")], "code"),
]
verbs = ["listed", "read", "emits", "built", "served"]
FW, FG = 186, 36
for k, (bid, title, lines, ev) in enumerate(flow):
    x0 = 50 + k * (FW + FG)
    box(bid, x0, 1124, FW, 104, title, lines, ev=ev, lh=15)
    if k < 5:
        arrow([(x0 + FW, 1176), (x0 + FW + FG - 2, 1176)], verbs[k], (x0 + FW + FG / 2, 1170), anchor="middle")

agg = METRICS["aggregate_as_published"]
tot = "  ·  ".join([
    "6 Nov 2026 totals", "8 projects", "1,496 tasks", "2,418 h 25 m", "180,622 LLM calls",
    "$2,156.81", "818,967 lines", "3,621 files"])
text(50, 1250, f"`{tot}`", "tb strong")
text(50, 1267, "tasks, hours, calls and cost exist per task in task_context.json; the agent keeps no line or file counter, "
               "so lines and files are probably counted in the repos (inferred)", "tb n")

text(50, 1296, "Content factory · the same agent on a schedule", "tt", upper=True)
cf = [
    ("c_news", "News Analytics · on /proof", ["RSS and HTML feeds → SQLite FTS5", "→ read-only MCP for agents",
                                             ("sample output: ai_digest_2026-09-29.md", "n")], "site"),
    ("c_mode", "Scheduled TAO·MODES run", ["example modes `news_analyst` → `blog_writer`",
                                          "cron entry in `.taocoder/schedules.json`",
                                          ("reviews: Mon + Thu, then weekly on Wed", "n")], "inf"),
    ("c_blog", "Blog post · /blog", ["10 AI-industry reviews end with", "«Статья написана ИИ инструментом",
                                     "TAO•MODES …»"], "code"),
    ("c_pub", "Telegram · MAX · VK MCP · on /proof", ["MCP server with 15 publishing tools", "probably cross-posts to the channels",
                                                      ("no page says so (inferred)", "n")], "inf"),
]
CF_W, CF_G = 296, 34
for k, (bid, title, lines, ev) in enumerate(cf):
    x0 = 50 + k * (CF_W + CF_G)
    box(bid, x0, 1308, CF_W, 90, title, lines, ev=ev, lh=15)
    if k < 3:
        arrow([(x0 + CF_W, 1352), (x0 + CF_W + CF_G - 2, 1352)], ["feeds", "writes", "posts"][k],
              (x0 + CF_W + CF_G / 2, 1346), anchor="middle", ev="inf" if k != 1 else "inf")

# ---------------------------------------------------------------- title block
TX, TY, TW, TH = 1380, 1124, 346, 282
SVG.append(f'<rect class="tblock" x="{TX}" y="{TY}" width="{TW}" height="{TH}"/>')
BOX["title"] = (TX, TY, TW, TH)
SVG.append(f'<text class="tbn" x="{TX + 16}" y="{TY + 40}">TAO·CODER TEARDOWN</text>')
text(TX + 16, TY + 62, "pipeline of the agent behind цнтр.рф/proof", "tb")
line(TX, TY + 76, TX + TW, TY + 76, "trule")
text(TX + 16, TY + 93, "Sources", "tl", upper=True)
text(TX + 16, TY + 110, "цнтр.рф, 75 pages · /proof with 24 project docs", "tb")
text(TX + 16, TY + 126, "`tao-coder` 3.1.2 VSIX from the Marketplace", "tb")
line(TX, TY + 136, TX + TW, TY + 136, "trule")
for k, (lab, val) in enumerate([("Snapshot", "2026-11-07"), ("Sheet", "1 / 1"), ("Rev", "A")]):
    cx0 = TX + [0, 150, 250][k]
    if k:
        line(cx0, TY + 136, cx0, TY + 172, "trule")
    text(cx0 + 16, TY + 151, lab, "tl", upper=True)
    text(cx0 + 16, TY + 166, f"`{val}`", "tb")
line(TX, TY + 172, TX + TW, TY + 172, "trule")
text(TX + 16, TY + 189, "Line = evidence", "tl", upper=True)
for k, (ev, lab) in enumerate([("code", "seen in the v3.1.2 code or page source"),
                               ("site", "stated on the site or in project docs"),
                               ("inf", "inferred from the evidence")]):
    yy = TY + 204 + k * 15
    SVG.append(f'<line class="lkey ev-{ev}" x1="{TX + 16}" y1="{yy - 4}" x2="{TX + 56}" y2="{yy - 4}"/>')
    text(TX + 66, yy, lab, "tb")
line(TX, TY + 246, TX + TW, TY + 246, "trule")
for k, (cls, lab) in enumerate([("mem", "memory"), ("gate", "gates and control"), ("cost", "paid LLM call")]):
    xx = TX + 16 + k * 108
    SVG.append(f'<rect class="sw {cls}" x="{xx}" y="{TY + 258}" width="14" height="14" rx="2"/>')
    text(xx + 20, TY + 270, lab, "tb")
badge(TX + TW - 20, TY + 265)

# ---------------------------------------------------------------- assemble page
Z = {k: zone(k) for k in BOX}
svg = (f'<svg id="sheet" viewBox="0 0 {W} {H}" role="img" aria-label="Engineering-style sheet of the TAO·CODER '
       f'pipeline: band 1 is the project lifecycle (Architect documents, roadmap phases, Ops and Debug), band 2 is one '
       f'task inside the extension (prompt builder, LLM, Task Context memory, stage gate and tool access), band 3 shows '
       f'how per-task metrics are rolled up into the /proof page and how the blog is produced.">'
       '<defs>'
       + "".join(f'<marker id="mk-{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
                 f'orient="auto-start-reverse"><path class="mk {k}" d="M0,1 L10,5 L0,9 z"/></marker>'
                 for k in ("ink", "mem", "gate", "cost"))
       + '</defs>' + "\n".join(SVG) + '</svg>')

P = METRICS["projects"]
WHAT = {
    "ai_tsu_crm": "CRM for organisations of up to 25 people; deployed at crm.thinkingos.tech",
    "cayman_erp": "ERP for a meat-processing plant with 1C integration",
    "tao_llmhub": "OpenAI-compatible LLM gateway reselling OpenRouter, paid in roubles",
    "tao_cortex": "platform for managing teams and tasks with AI proposals",
    "milenazhadobina": "an author's website, forked from the company site repo",
    "news_analytics": "RSS/HTML news collector with an MCP interface for agents",
    "telegram_max_vk_publish_mcp": "MCP server that publishes to Telegram, MAX and VK",
    "visual_scene_language": "compact JSON format of web pages for browser agents, with an MCP server",
}


def n(v, d=0):
    return f"{v:,.{d}f}"


rows_html = "\n".join(
    f'<tr><th scope="row">{esc(p["name"])}<span class="what">{esc(WHAT[p["id"]])}</span></th>'
    f'<td class="st">{esc(p["status"])}</td><td>{n(p["tasks"])}</td><td>{n(p["hours"], 0)}</td>'
    f'<td>{n(p["llm_calls"])}</td><td>${n(p["cost_usd"], 2)}</td><td>{n(p["lines"])}</td>'
    f'<td>${p["derived"]["usd_per_task"]:.2f}</td><td>{n(p["derived"]["llm_calls_per_task"])}</td>'
    f'<td>{p["derived"]["hours_per_task"]:.1f}</td></tr>' for p in P)
S = METRICS["sum_of_projects"]
rows_html += (f'\n<tr class="total"><th scope="row">All 8 projects</th><td></td><td>{n(S["tasks"])}</td>'
              f'<td>{n(S["hours"], 0)}</td><td>{n(S["llm_calls"])}</td><td>${n(S["cost_usd"], 2)}</td>'
              f'<td>{n(S["lines"])}</td><td>${S["cost_usd"] / S["tasks"]:.2f}</td>'
              f'<td>{n(S["llm_calls"] / S["tasks"])}</td><td>{S["hours"] / S["tasks"]:.1f}</td></tr>')


def zb(k):
    return f'<span class="z">{Z[k]}</span>'


steps = [
    (["architect", "repo"], "The owner starts in <b>Architect mode</b>. The agent walks nine stages and writes one "
     "document per stage with the owner: product concept, audience, design system, architecture, the "
     "<code>check_all.sh</code> contract, the roadmap, decisions and finally <code>README_AI.md</code>, the "
     "“project bible” every later task reads."),
    (["roadmap", "triggers"], "The roadmap is cut into phases sized for one task. The owner selects a phase, adds it "
     "to the chat and writes «Выполняем Этап N». A Developer task starts with its own folder under "
     "<code>.taocoder/tasks/</code>. Tasks can also start from a cron schedule (then autonomously), a handoff "
     "from another mode, or a self-delay."),
    (["prompt", "kernel"], "Before <em>every</em> model call the extension rebuilds the prompt: Cline's system prompt, "
     "then one message rendered from <code>task_context.json</code> (spec, criteria, plan, exit criteria, "
     "README_AI, code snippets re-read from disk, notes), then only the last 10–18 turns. The chat history does "
     "not pile up in the prompt; the kernel is the memory. That is the whole “bounded context” idea."),
    (["llm"], "The model must answer with exactly one tool call. Each call adds to the task's call counter and cost, "
     "which is where the /proof numbers come from: 121 calls and $1.44 per task on average."),
    (["matrix", "exec"], "The current stage's allowlist decides whether the call may run. Clarification and data "
     "collection can read and ask but not edit; development and rework can edit and run commands; audit can run "
     "checks with approval; only report can finish the task."),
    (["safety"], "Shell commands go through a fixed classifier: blacklists, then approval rules, then whitelists, "
     "else “unknown”. Dangerous and unknown commands need the owner. Secrets are written as "
     "<code>{{SECRET:KEY}}</code> and substituted only at execution time."),
    (["writes", "uc"], "Memory is written three ways: the agent calls <code>taocoder_*</code> tools on purpose; every "
     "5 user turns an <b>update-cycle</b> LLM call extracts facts from the turns that are about to leave the prompt; "
     "and the owner edits the Cockpit panel. Each update-cycle takes a snapshot first, so the context can be "
     "rolled back."),
    (["stages", "gate", "exit"], "To move on, the agent calls <code>taocoder_set_stage</code> with a reason and evidence "
     "ids. The gate checks the ids exist, every exit criterion is true and, around audit, that each acceptance "
     "criterion has a verdict. <code>check_all_passed</code> is one of those criteria: the agent runs "
     "<code>bash check_all.sh</code> and sets the flag itself. Failing audit sends the task to rework."),
    (["stages", "roadmap", "ops"], "The report stage ends the task. The owner goes back to the roadmap for the next "
     "phase; Ops mode deploys (<code>deploy_remote.sh</code> → <code>deploy.sh</code> → Docker) and Debug mode runs "
     "E2E tests against the running stack. On /proof that loop averages 2–48 tasks per roadmap phase, because "
     "fixes and rework are separate tasks."),
    (["p_gen", "p_frag", "p_proof"], "Outside the agent, a script in the site repo (<code>scripts/generate-proof.ts</code> "
     "with <code>projects.json</code>) rolls the task data of eight repos into the HTML block between "
     "<code>PROOF_DATA</code> markers and embeds 24 project documents. The Astro site serves it at /proof in "
     "Russian and English."),
    (["c_mode", "c_blog"], "The same tool also writes the blog. Ten AI-industry reviews are signed «Статья написана ИИ "
     "инструментом TAO•MODES». Their Monday/Thursday cadence and the News Analytics project point to a scheduled "
     "custom mode, though no page says so outright."),
]
steps_html = "\n".join(f'<li><span class="zs">{"".join(zb(k) for k in ks)}</span><p>{t}</p></li>' for ks, t in steps)

diffs = [
    ("Quality gate", "“Задача не завершится, пока check_all.sh не покажет зелёный статус.”",
     "No code runs or parses <code>check_all.sh</code>. <code>check_all_passed</code> is a flag the agent sets; the gate checks only the flag."),
    ("Secrets", "Stored in VS Code SecretStorage; never on disk in plain text.",
     "Migrated into <code>~/.cline/data/secrets.json</code>: plain JSON with 0600 permissions, in upstream Cline's folder."),
    ("Cost breakdown", "By stage and by role mode.",
     "By call type only: agent, handover, update_cycle, repair, crash_analyst."),
    ("JEV decision model", "Probabilistic validation of stage transitions.",
     "Off by default. When on: unknown shell commands, a self-check tool, and hooks in custom modes. Built-in modes have no hooks."),
    ("Prompt history", "“The last few turns” (10–15 in the README).",
     "Raw tail of 10 plus a window of 8, capped at 50k tokens."),
    ("Architect order", "… → README_AI → ROADMAP → CHECK_ALL.",
     "… → ARCHITECTURE → CHECK_ALL → ROADMAP → DECISIONS → README_AI."),
    ("Telemetry and price", "“Никакой телеметрии.” Guide: free; product page: $100/month.",
     "Marketplace says Free. Cline's telemetry code is bundled but keyless by default; a client for "
     "<code>api.taocoder.thinkingos.tech</code> handles subscription status and per-launch checks."),
]
diffs_html = "\n".join(f"<tr><th scope=\"row\">{a}</th><td>{b}</td><td>{c}</td></tr>" for a, b, c in diffs)

CSS = open(os.path.join(HERE, "teardown.css"), encoding="utf-8").read()
page = f"""<title>TAO·CODER Teardown</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Sofia+Sans+Extra+Condensed:wght@700;800&display=swap">
<style>
{CSS}
</style>
<header class="head">
  <p class="eyebrow">Reverse-engineering notes · snapshot of 7 November 2026</p>
  <h1>TAO·CODER Teardown</h1>
  <p class="lede">How the coding agent behind <b>цнтр.рф/proof</b> turns a product brief into code, and how its task
  logs become the numbers on that page. Rebuilt from 75 site pages, the 24 project documents embedded in /proof and
  the published VS Code extension (<code>tao-coder</code> 3.1.2, a fork of Cline).</p>
</header>

<section class="sheet-sec" aria-label="Pipeline sheet">
  <div class="sheet-bar">
    <p>Sheet 1 / 1 · zones A–F × 1–8 are cited in the notes below</p>
    <div class="seg" role="group" aria-label="Sheet size">
      <button type="button" id="fit" aria-pressed="true">Fit to width</button>
      <button type="button" id="actual" aria-pressed="false">Actual size</button>
    </div>
  </div>
  <figure>
    <div class="sheet-wrap" id="wrap">
{svg}
    </div>
    <figcaption>Band 1 is the outer loop over one repository, band 2 is a single task inside the extension, and
    band 3 is what happens to the task logs after the agent stops. Box outlines mark how sure each part is: solid
    was read in the code or page source, dashed is stated on the site, dotted is inferred.</figcaption>
  </figure>
</section>

<main class="notes">
  <section>
    <h2>One roadmap phase, start to finish</h2>
    <ol class="steps">
{steps_html}
    </ol>
  </section>

  <section>
    <h2>Where the site and the code disagree</h2>
    <p class="intro">What the marketing pages and guide say, next to what version 3.1.2 of the extension actually
    does. None of these breaks the pipeline; they change how much you can trust the gate and the numbers.</p>
    <div class="tbl-wrap"><table class="diff">
      <thead><tr><th scope="col">Topic</th><th scope="col">The site says</th><th scope="col">The v3.1.2 code does</th></tr></thead>
      <tbody>
{diffs_html}
      </tbody>
    </table></div>
  </section>

  <section>
    <h2>The eight projects on /proof</h2>
    <p class="intro">Published figures as of 6 November 2026, with per-task ratios worked out from them. “Hours” is
    summed task time, not calendar time. The page's totals equal the sum of the rows, except cost, which is 2 cents
    higher on the page ($2,156.81), probably from rounding.</p>
    <div class="tbl-wrap"><table class="nums">
      <thead><tr><th scope="col">Project</th><th scope="col">Status</th><th scope="col">Tasks</th><th scope="col">Hours</th>
      <th scope="col">LLM calls</th><th scope="col">Cost</th><th scope="col">Lines</th><th scope="col">$ / task</th>
      <th scope="col">Calls / task</th><th scope="col">h / task</th></tr></thead>
      <tbody>
{rows_html}
      </tbody>
    </table></div>
  </section>

  <section class="src">
    <h2>Sources</h2>
    <ul>
      <li>Site snapshot, 7 Nov 2026: all 75 sitemap pages, robots.txt and the English mirror of /proof
      (<code>~/database/20261107_cntr_proof_site/</code>).</li>
      <li>/proof embedded data: 24 documents (Architecture, README, README_AI for 8 projects) from the
      <code>proof-docs-data</code> JSON block.</li>
      <li>VS Code Marketplace package <code>thinkingos.tao-coder</code> 3.1.2 (9.6 MB VSIX; read, not run): stage tables,
      tool specs, Task Context store, update-cycle, command classifier.</li>
      <li>Blog posts on the release notes (3.0.1, 3.1.0), custom modes and scheduling, bounded context, JEV, MCP secrets and the
      methodology guide.</li>
    </ul>
  </section>
</main>
<script>
(function () {{
  var wrap = document.getElementById('wrap');
  var fit = document.getElementById('fit');
  var act = document.getElementById('actual');
  function set(actual) {{
    wrap.classList.toggle('actual', actual);
    fit.setAttribute('aria-pressed', String(!actual));
    act.setAttribute('aria-pressed', String(actual));
  }}
  fit.addEventListener('click', function () {{ set(false); }});
  act.addEventListener('click', function () {{ set(true); }});
}})();
</script>
"""

out = os.path.join(HERE, "taocoder_teardown.html")
open(out, "w", encoding="utf-8").write(page)
print(out, len(page), "bytes")
print("zones:", json.dumps(Z, ensure_ascii=False))
for w in WARN:
    print("WARN", w)
