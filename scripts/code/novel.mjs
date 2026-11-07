// Extract the code of a forked bundle that has no counterpart in the upstream bundle(s).
// Usage: node novel.mjs FORK_BUNDLE OUT_DIR UPSTREAM_BUNDLE...
//
// Output (OUT_DIR):
//   summary.json      match stats and per-topic sizes
//   index.tsv         one row per novel unit: offset, size, class (new|modified), topic, sample strings
//   chunks/NN_<topic>.js   prettified novel units in bundle order, grouped by topic, each with an offset header
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fingerprintBundle, MIN_TOK } from "./fingerprint.mjs";

const TOOLS = process.env.TOOLS_DIR || `${process.env.HOME}/database/20261107_cntr_proof_site/code/tools`;
const require = createRequire(`${TOOLS}/package.json`);
const prettier = require("prettier");

const [forkPath, outDir, ...upPaths] = process.argv.slice(2);
const F = fingerprintBundle(forkPath);
const upHashes = new Set();
const upStrings = new Set();
const STR = /"((?:[^"\\\n]|\\.){6,200})"|`([^`$\\\n]{6,200})`/g;
for (const p of upPaths) {
  const U = fingerprintBundle(p);
  for (const u of U.units) if (u.ntok >= MIN_TOK) upHashes.add(u.h);
  for (const m of U.src.matchAll(STR)) upStrings.add(m[1] ?? m[2]);
}

const units = F.units;
const n = units.length;
const big = new Uint8Array(n), matched = new Uint8Array(n), anyMatchedDesc = new Uint8Array(n);
for (let i = 0; i < n; i++) {
  big[i] = units[i].ntok >= MIN_TOK ? 1 : 0;
  matched[i] = big[i] && upHashes.has(units[i].h) ? 1 : 0;
}
// units are in DFS pre-order: children have larger indices than their parent
for (let i = n - 1; i >= 0; i--) {
  const p = units[i].parent;
  if (p >= 0 && (matched[i] || anyMatchedDesc[i])) anyMatchedDesc[p] = 1;
}
const fullyNovel = (i) => big[i] && !matched[i] && !anyMatchedDesc[i];
const novel = [];
for (let i = 0; i < n; i++) {
  if (!fullyNovel(i)) continue;
  const p = units[i].parent;
  if (p >= 0 && fullyNovel(p)) continue; // report only the outermost fully-novel unit
  novel.push(i);
}

const TOPICS = [
  ["subscription", /api\.taocoder|subscription|LAUNCH_LIMIT|\/api\/launch|\/api\/plans|launchToken|notifications\/unread/i],
  ["jev", /\bjev|typesafe|noul\b/i],
  ["update_cycle", /update[_-]?cycle|raw[_ ]tail|PERMANENTLY DELETED|extract(or|ion)|stale attention|knowledge[_ ]migration/i],
  ["kernel_prompt", /kernel|prompt_recent|hot_budget|target_tokens|Task Context Kernel|recentWindow|chronological feed/i],
  ["stages_modes", /taocoder_set_stage|exit[_ ]criteria|stage_history|acceptance[_ ]criteria|architecture_doc|ops_diagnosis|debug_setup|role_mode|builtin-modes|mode\.json|stage_exit|requireConfirm/i],
  ["task_context_store", /task_context|snapshot|relevant_code|negative_knowledge|handoff_bundle|\.taocoder\b|audit\.jsonl|implementation_plan/i],
  ["scheduler", /schedul|self_delay|cron|next_run|missed run|AUTONOMOUS/i],
  ["command_safety", /classifyCommand|blacklist|whitelist|require_approval|command_safety|dangerous/i],
  ["secrets", /SECRET:|secret|oauth|pkce|code_verifier/i],
  ["rest_api", /rest[_ ]?api|openapi|restApi/i],
  ["tools", /taocoder_[a-z_]+|describe_tool|use_rest_api|manage_connections/i],
  ["providers_models", /deepseek|qwen|dashscope|openrouter|model(Id|Info|s)\b|contextWindow|inputPrice/i],
  ["webview_ui_glue", /webview|postMessage|grpc|proto\b|Service(Client|Handler)/i],
];
function topicOf(text) {
  for (const [name, re] of TOPICS) if (re.test(text)) return name;
  return "other";
}

async function pretty(code) {
  const attempts = [code, `(${code})`, `({m${code}})`, `({async m${code}})`, `({*m${code}})`, `({async *m${code}})`, `class X{m${code}}`];
  for (const a of attempts) {
    try { return await prettier.format(a, { parser: "babel", printWidth: 110 }); } catch { /* try next */ }
  }
  return code;
}

// nearest enclosing function head, e.g. "async recursivelyMakeClineRequests(t,e,r){" (names of methods survive minification)
function enclosingHead(i) {
  let p = units[i].parent;
  while (p >= 0 && units[p].kind !== "fn") p = units[p].parent;
  if (p < 0) return "(top level)";
  // for a method, the FunctionExpression starts at "(": include the preceding method name
  const s = units[p].s;
  const back = F.src.slice(Math.max(0, s - 60), s).match(/([A-Za-z_$][\w$]*\s*)$/);
  const head = F.src.slice(s, Math.min(units[p].e, s + 90)).split("{")[0];
  return ((back && /^[\(]/.test(head) ? back[1] : "") + head).replace(/\s+/g, " ");
}
const hooks = new Map(); // enclosing upstream function -> novel bytes inside it (only where that function itself matched nothing new)
const rows = [];
const byTopic = new Map();
let newBytes = 0, modBytes = 0;
for (const i of novel) {
  const u = units[i];
  const text = F.src.slice(u.s, u.e);
  const strs = [...text.matchAll(STR)].map((m) => m[1] ?? m[2]);
  const known = strs.filter((s) => upStrings.has(s)).length;
  const ratio = strs.length ? known / strs.length : 0;
  // a big unit whose strings are mostly upstream strings is an upstream unit with small edits
  const cls = strs.length >= 3 && ratio >= 0.8 ? "modified" : "new";
  const topic = topicOf(text);
  if (cls === "new") newBytes += text.length; else modBytes += text.length;
  const sample = strs.filter((s) => !upStrings.has(s)).slice(0, 3).map((s) => s.slice(0, 60)).join(" | ");
  const ctx = enclosingHead(i);
  rows.push([u.s, u.e - u.s, u.ntok, u.kind, cls, ratio.toFixed(2), topic, sample.replace(/\t|\n/g, " "), ctx.replace(/\t/g, " ")]);
  if (ctx !== "(top level)") hooks.set(ctx, (hooks.get(ctx) || 0) + text.length);
  if (!byTopic.has(topic)) byTopic.set(topic, []);
  byTopic.get(topic).push({ u, text, cls, ratio, ctx });
}

fs.mkdirSync(path.join(outDir, "chunks"), { recursive: true });
fs.writeFileSync(path.join(outDir, "index.tsv"),
  "offset\tbytes\ttokens\tkind\tclass\tupstream_string_ratio\ttopic\tnew_strings\tinside\n" + rows.map((r) => r.join("\t")).join("\n") + "\n");

const summary = { fork: forkPath, upstream: upPaths, fork_bytes: F.src.length, units: n,
  novel_units: novel.length, new_bytes: newBytes, modified_bytes: modBytes, topics: {} };
let k = 0;
const MAX_CHUNK = 160_000;
for (const [topic, list] of [...byTopic.entries()].sort()) {
  let part = 0, buf = "", total = 0;
  const flush = () => {
    if (!buf) return;
    const name = `${String(k).padStart(2, "0")}_${topic}${part ? "_" + part : ""}.js`;
    fs.writeFileSync(path.join(outDir, "chunks", name), buf);
    k++; part++; buf = "";
  };
  for (const { u, text, cls, ratio, ctx } of list) {
    const body = await pretty(text);
    const head = `// ==== @${u.s} +${u.e - u.s}B ${u.kind} ${cls} (upstream-string ratio ${ratio.toFixed(2)})\n// inside: ${ctx}\n`;
    buf += head + body + "\n";
    total += text.length;
    if (buf.length > MAX_CHUNK) flush();
  }
  flush();
  summary.topics[topic] = { units: list.length, bytes: total,
    new_bytes: list.filter((x) => x.cls === "new").reduce((a, x) => a + x.text.length, 0) };
}
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, "hooks.tsv"), "novel_bytes\tenclosing_function\n" +
  [...hooks.entries()].sort((a, b) => b[1] - a[1]).map(([h, b]) => `${b}\t${h}`).join("\n") + "\n");
console.log(JSON.stringify(summary, null, 2));
