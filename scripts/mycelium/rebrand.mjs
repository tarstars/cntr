#!/usr/bin/env node
// Rename the extension from Cline to Mycelium in package.json. Idempotent.
// Same transform as Cline's own scripts/publish-nightly.mjs (updatePackageJson): every
// "claude-dev" becomes the new package name and every "cline.<command>" gets the new prefix.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const NAME = "mycelium-coder"
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const file = path.join(root, "package.json")
const raw = fs.readFileSync(file, "utf8")
const replaced = raw.replaceAll("claude-dev", NAME).replaceAll('"cline.', `"${NAME}.`)
const pkg = JSON.parse(replaced)
pkg.name = NAME
pkg.publisher = "local"
pkg.displayName = "Mycelium"
pkg.description = "Coding agent with task memory, a stage pipeline and two behaviour profiles (fork of Cline)."
fs.writeFileSync(file, `${JSON.stringify(pkg, null, "\t")}\n`)
console.log(`package.json rebranded to ${pkg.publisher}.${pkg.name}`)
