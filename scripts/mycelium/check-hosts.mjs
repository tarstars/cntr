#!/usr/bin/env node
// List every http(s) host that appears in a bundle and fail on hosts that are not
// accounted for in scripts/mycelium/allowed-hosts.txt (providers, or dormant strings
// with a reason). This is a static inventory; the runtime check is acceptance step 7.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const bundle = process.argv[2]
if (!bundle) {
	console.error("usage: check-hosts.mjs <bundle.js>")
	process.exit(2)
}
const here = path.dirname(fileURLToPath(import.meta.url))
const allowed = new Set(
	fs
		.readFileSync(path.join(here, "allowed-hosts.txt"), "utf8")
		.split("\n")
		.map((l) => l.replace(/#.*/, "").trim())
		.filter(Boolean),
)
const src = fs.readFileSync(bundle, "utf8")
const hosts = new Set()
for (const m of src.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?=[/:"'`\s)?]|$)/gi)) {
	hosts.add(m[1].toLowerCase())
}
const unknown = [...hosts].filter(
	(h) => !allowed.has(h) && ![...allowed].some((a) => a.startsWith("*.") && h.endsWith(a.slice(1))),
)
console.log(`${hosts.size} hosts found, ${hosts.size - unknown.length} accounted for`)
if (unknown.length) {
	console.log("not in allowed-hosts.txt:\n  " + unknown.sort().join("\n  "))
	process.exit(1)
}
console.log("OK")
