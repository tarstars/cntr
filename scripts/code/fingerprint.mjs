// Fingerprint the functions and statements of a minified JS bundle so two builds can be compared
// even though minifier-chosen identifier names differ between them.
//
// A "unit" is every function/class and every statement directly inside a function body or the
// program body. Its fingerprint hashes the unit's token stream with local identifiers replaced
// by a placeholder; property names (after "." / "?." or as object keys), literals, keywords and
// punctuation are kept.
//
// Exports fingerprintBundle(path) -> { src, units: [{s, e, ntok, h, kind, parent}] }
// CLI: node fingerprint.mjs TAO_BUNDLE UPSTREAM_BUNDLE... -> prints match rate per upstream bundle.
import { createRequire } from "node:module";
import fs from "node:fs";

const TOOLS = process.env.TOOLS_DIR || `${process.env.HOME}/database/20261107_cntr_proof_site/code/tools`;
const require = createRequire(`${TOOLS}/package.json`);
const acorn = require("acorn");

const ACORN_OPTS = { ecmaVersion: "latest", sourceType: "script", allowHashBang: true,
  allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };

function tokenize(src, opts = ACORN_OPTS) {
  const starts = [], labels = [], values = [];
  for (const t of acorn.tokenizer(src, opts)) {
    starts.push(t.start);
    labels.push(t.type.label);
    values.push(t.value);
  }
  const n = starts.length;
  const intern = new Map();
  const ids = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const lab = labels[i];
    let key;
    if (lab === "name") {
      const prev = i > 0 ? labels[i - 1] : "";
      const next = i + 1 < n ? labels[i + 1] : "";
      if (prev === "." || prev === "?.") key = "." + values[i];
      else if (next === ":" && (prev === "{" || prev === ",")) key = "k:" + values[i];
      else key = "ID";
    } else if (lab === "string") key = "s:" + values[i];
    else if (lab === "num") key = "n:" + String(values[i]);
    else if (lab === "template") key = "t:" + values[i];
    else if (lab === "regexp") key = "r:" + (values[i] && values[i].pattern);
    else key = lab;
    // content-derived id, so the same token gets the same id in every bundle
    let id = intern.get(key);
    if (id === undefined) {
      let h = 0x811c9dc5 | 0;
      for (let j = 0; j < key.length; j++) h = Math.imul(h ^ key.charCodeAt(j), 0x01000193);
      id = h >>> 0;
      intern.set(key, id);
    }
    ids[i] = id;
  }
  return { starts: Int32Array.from(starts), ids, n };
}

function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

function hashRange(ids, a, b) {
  let h1 = 0x811c9dc5 | 0, h2 = 0x9747b28c | 0;
  for (let i = a; i < b; i++) {
    const v = ids[i];
    h1 = Math.imul(h1 ^ v, 0x01000193);
    h2 = Math.imul(h2 ^ (v + 0x9e3779b9), 0x85ebca6b) ^ (h2 >>> 13);
  }
  return (h1 >>> 0).toString(36) + "." + (h2 >>> 0).toString(36);
}

const FN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
  "ClassDeclaration", "ClassExpression"]);

function collectUnits(ast) {
  const units = [];
  // iterative DFS, recording parent unit index
  const stack = [[ast, -1, false]];
  while (stack.length) {
    const [node, parentUnit, isStmtSlot] = stack.pop();
    if (!node || typeof node.type !== "string") continue;
    let myParent = parentUnit;
    if (FN.has(node.type) || isStmtSlot) {
      units.push({ s: node.start, e: node.end, kind: FN.has(node.type) ? "fn" : "stmt", parent: parentUnit });
      myParent = units.length - 1;
    }
    // statements directly in a program body or a function body block are units
    let stmtChildren = null;
    if (node.type === "Program") stmtChildren = node.body;
    else if (FN.has(node.type) && node.body && node.body.type === "BlockStatement") stmtChildren = node.body.body;
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const v = node[key];
      if (Array.isArray(v)) {
        for (let i = v.length - 1; i >= 0; i--) {
          const c = v[i];
          if (c && typeof c.type === "string") stack.push([c, myParent, stmtChildren === v]);
        }
      } else if (v && typeof v.type === "string") {
        if (FN.has(node.type) && key === "body" && v.type === "BlockStatement") {
          // descend into the block's statements as statement slots
          for (let i = v.body.length - 1; i >= 0; i--) stack.push([v.body[i], myParent, true]);
        } else {
          stack.push([v, myParent, false]);
        }
      }
    }
  }
  return units;
}

export function fingerprintBundle(path) {
  const src = fs.readFileSync(path, "utf8");
  const t0 = Date.now();
  let opts = ACORN_OPTS, ast;
  try { ast = acorn.parse(src, opts); }
  catch { opts = { ...ACORN_OPTS, sourceType: "module" }; ast = acorn.parse(src, opts); } // Vite/ESM bundles
  const tok = tokenize(src, opts);
  const units = collectUnits(ast);
  for (const u of units) {
    const a = lowerBound(tok.starts, u.s), b = lowerBound(tok.starts, u.e);
    u.ntok = b - a;
    u.h = hashRange(tok.ids, a, b);
  }
  process.stderr.write(`${path}: ${src.length} bytes, ${tok.n} tokens, ${units.length} units, ${Date.now() - t0} ms\n`);
  return { src, units };
}

export const MIN_TOK = 12;

if (import.meta.url === `file://${process.argv[1]}`) {
  const [tao, ...ups] = process.argv.slice(2);
  const T = fingerprintBundle(tao);
  const big = T.units.filter((u) => u.ntok >= MIN_TOK);
  const totalTok = big.filter((u) => u.kind === "fn").reduce((a, u) => a + u.ntok, 0);
  for (const up of ups) {
    const U = fingerprintBundle(up);
    const set = new Set(U.units.filter((u) => u.ntok >= MIN_TOK).map((u) => u.h));
    const m = big.filter((u) => set.has(u.h));
    const mf = m.filter((u) => u.kind === "fn");
    console.log(JSON.stringify({ upstream: up, units_matched: (m.length / big.length).toFixed(4),
      fn_matched: (mf.length / big.filter((u) => u.kind === "fn").length).toFixed(4),
      fn_tokens_matched: (mf.reduce((a, u) => a + u.ntok, 0) / totalTok).toFixed(4) }));
  }
}
