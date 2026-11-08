import fs from "node:fs/promises"
import { commandRulesFile } from "../paths"
import type { Profile } from "../profile"

export type CommandClass = "safe" | "dangerous" | "requires_approval" | "unknown"

/** User rules from `.mycelium/command_safety.json`; each entry is a case-insensitive glob (`*` = anything). */
export interface CommandRules {
	whitelist: string[]
	blacklist: string[]
	require_approval: string[]
}

/** Built-in blacklist, matched anywhere in the whole command (docs/tao-behaviour.md §7). */
const BLACKLIST: readonly RegExp[] = [
	/\brm\b/,
	/\bsudo\b/,
	/\b(dd|mkfs(\.\w+)?|fdisk|parted|mkswap)\b/,
	/\bchmod\s+(-R\s+)?777\b/,
	/\bchown\b/,
	/\bpasswd\b/,
	/\b(useradd|userdel|usermod|groupadd|groupdel|groupmod)\b/,
	/(^|[;&|]\s*)(shutdown|reboot|halt|poweroff|init)\b/,
	/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|ksh|dash)\b/,
	/>\s*\/dev\/(?!null\b|stdout\b|stderr\b|tty\b)/,
	/\b(mount|umount)\b/,
	/(^|[;&|]\s*)(iptables|ufw|firewall-cmd|route)\b/,
	/\bgit\s+checkout\s+(\S+\s+)?--\s+\S/,
	/\bgit\s+checkout\s+\.(\s|$)/,
	/\bgit\s+restore\s+\.(\s|$)/,
	/\bgit\s+reset\s+--hard\b/,
	/\bgit\s+clean\s+-[a-z]*f/,
]

/** Always ask, whatever auto-approve says (TAO's behaviour in both profiles). */
const ALWAYS_ASK: readonly RegExp[] = [/\brm\b/, /\bgit\s+checkout\s+(\S+\s+)?--\s/]

const SAFE_PROGRAMS = new Set([
	"ls",
	"cat",
	"head",
	"tail",
	"grep",
	"rg",
	"find",
	"wc",
	"pwd",
	"echo",
	"which",
	"env",
	"tree",
	"du",
	"df",
	"stat",
	"file",
	"sort",
	"uniq",
	"diff",
	"cd",
	"mkdir",
	"touch",
	"cp",
	"mv",
	"true",
	"npm",
	"npx",
	"pnpm",
	"yarn",
	"bun",
	"pip",
	"pip3",
	"uv",
	"poetry",
	"make",
	"cargo",
	"go",
	"pytest",
	"jest",
	"vitest",
	"mocha",
	"tsc",
	"eslint",
	"biome",
	"prettier",
	"ruff",
	"mypy",
	"black",
	"gradle",
	"mvn",
])
const INTERPRETERS = new Set(["bash", "sh", "python", "python3", "node", "deno"])
const SAFE_GIT = new Set([
	"status",
	"diff",
	"log",
	"show",
	"branch",
	"remote",
	"rev-parse",
	"ls-files",
	"blame",
	"describe",
	"add",
	"commit",
	"push",
	"pull",
	"fetch",
	"switch",
	"stash",
	"tag",
	"merge",
	"rebase",
	"cherry-pick",
	"revert",
	"checkout",
	"restore",
	"init",
	"clone",
	"mv",
])
const SAFE_DOCKER = new Set(["build", "ps", "logs", "exec", "images"])

/** Split a shell command on unquoted `;`, `&&`, `||`, `|` and newlines. */
export function splitSegments(command: string): string[] {
	const out: string[] = []
	let cur = ""
	let quote: string | null = null
	for (let i = 0; i < command.length; i++) {
		const ch = command[i]
		if (quote) {
			cur += ch
			if (ch === quote) quote = null
			continue
		}
		if (ch === "'" || ch === '"') {
			quote = ch
			cur += ch
			continue
		}
		const two = command.slice(i, i + 2)
		if (two === "&&" || two === "||") {
			out.push(cur)
			cur = ""
			i++
			continue
		}
		if (ch === ";" || ch === "|" || ch === "\n") {
			out.push(cur)
			cur = ""
			continue
		}
		cur += ch
	}
	out.push(cur)
	return out.map((s) => s.trim()).filter(Boolean)
}

function globToRegExp(glob: string): RegExp {
	const body = glob
		.trim()
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join(".*")
	return new RegExp(`^${body}$`, "i")
}
const anyGlob = (globs: string[], text: string) => globs.some((g) => globToRegExp(g).test(text))

function builtinSafe(segment: string, profile: Profile): boolean {
	const words = segment.split(/\s+/).filter((w) => !/^\w+=/.test(w))
	const [program, sub] = words
	if (!program) return false
	if (program === "git") return SAFE_GIT.has(sub ?? "")
	if (program === "docker") return SAFE_DOCKER.has(sub ?? "")
	if (program === "chmod") return sub === "+x"
	if (INTERPRETERS.has(program)) return profile.commands.interpretersSafe
	return SAFE_PROGRAMS.has(program)
}

/**
 * Classify a command. Order: user blacklist → built-in blacklist → user require_approval → user
 * whitelist → built-in whitelist → unknown. Blacklists see the whole command; whitelists see the first
 * segment (tao) or every segment (improved).
 */
export function classifyCommand(command: string, rules: CommandRules, profile: Profile): CommandClass {
	const cmd = command.trim().replace(/[ \t]+/g, " ")
	if (anyGlob(rules.blacklist, cmd) || BLACKLIST.some((re) => re.test(cmd))) return "dangerous"
	if (anyGlob(rules.require_approval, cmd)) return "requires_approval"
	const segments = splitSegments(cmd)
	const checked = profile.commands.classifyAllSegments ? segments : segments.slice(0, 1)
	const safe = checked.length > 0 && checked.every((s) => anyGlob(rules.whitelist, s) || builtinSafe(s, profile))
	return safe ? "safe" : "unknown"
}

/** Whether to run a classified command without asking. */
export function decideCommand(
	cls: CommandClass,
	command: string,
	auto: { safe: boolean; all: boolean },
	profile: Profile,
): "run" | "ask" {
	if (ALWAYS_ASK.some((re) => re.test(command))) return "ask"
	if (cls === "safe") return auto.safe ? "run" : "ask"
	if (!auto.all) return "ask"
	if (profile.commands.autoApproveAllRunsBlacklisted) return "run"
	return cls === "unknown" ? "run" : "ask"
}

export async function loadCommandRules(cwd: string): Promise<CommandRules> {
	try {
		const parsed = JSON.parse(await fs.readFile(commandRulesFile(cwd), "utf8"))
		const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
		return {
			whitelist: list(parsed.whitelist),
			blacklist: list(parsed.blacklist),
			require_approval: list(parsed.require_approval),
		}
	} catch {
		return { whitelist: [], blacklist: [], require_approval: [] }
	}
}
