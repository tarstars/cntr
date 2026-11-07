// Print the prettified innermost function (or statement) of a bundle that contains a byte offset.
// Usage: node show.mjs BUNDLE OFFSET [--stmt] [--max CHARS] [--outer N]
//   --stmt     innermost statement instead of innermost function
//   --outer N  go N function levels further out
//   --max      truncate output (default 40000 chars)
import { createRequire } from "node:module";
import { fingerprintBundle } from "./fingerprint.mjs";

const TOOLS = process.env.TOOLS_DIR || `${process.env.HOME}/database/20261107_cntr_proof_site/code/tools`;
const prettier = createRequire(`${TOOLS}/package.json`)("prettier");

const args = process.argv.slice(2);
const [bundle, offStr] = args;
const off = Number(offStr);
const stmt = args.includes("--stmt");
const max = args.includes("--max") ? Number(args[args.indexOf("--max") + 1]) : 40000;
const outer = args.includes("--outer") ? Number(args[args.indexOf("--outer") + 1]) : 0;

const { src, units } = fingerprintBundle(bundle);
let best = -1;
for (let i = 0; i < units.length; i++) {
  const u = units[i];
  if (u.s <= off && off < u.e && (stmt || u.kind === "fn")) {
    if (best < 0 || u.e - u.s < units[best].e - units[best].s) best = i;
  }
}
if (best < 0) { console.log("no enclosing unit"); process.exit(1); }
for (let k = 0; k < outer; k++) {
  let p = units[best].parent;
  while (p >= 0 && units[p].kind !== "fn") p = units[p].parent;
  if (p < 0) break;
  best = p;
}
const u = units[best];
const pre = src.slice(Math.max(0, u.s - 80), u.s);
let code = src.slice(u.s, u.e);
let out = code;
for (const a of [code, `(${code})`, `({m${code}})`, `({async m${code}})`, `({*m${code}})`, `({async *m${code}})`, `class X{m${code}}`]) {
  try { out = await prettier.format(a, { parser: "babel", printWidth: 110 }); break; } catch { /* next */ }
}
console.log(`// unit @${u.s}..${u.e} (${u.e - u.s} B, ${u.kind}); preceding text: ${JSON.stringify(pre.slice(-60))}`);
console.log(out.length > max ? out.slice(0, max) + `\n// … truncated (${out.length} chars)` : out);
