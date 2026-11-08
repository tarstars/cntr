import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { checkRunsDir } from "../paths"
import type { CheckRun } from "../store/schema"

const DEFAULT_TIMEOUT_MS = 900_000
const KILL_GRACE_MS = 1_000
/** How long to keep reading output after the script exits before closing the pipes. */
const EXIT_GRACE_MS = 300
/** Keep at most the last 1 M characters of output. */
const MAX_LOG_CHARS = 1_000_000
const SECRET_ENV = /TOKEN|KEY|SECRET|PASSWORD/i

/** Workspace-relative places check_all.sh is looked for, in order. */
const CANDIDATES = ["check_all.sh", path.join("scripts", "check_all.sh")]

async function findScript(cwd: string): Promise<string | undefined> {
	for (const rel of CANDIDATES) {
		try {
			await fs.access(path.join(cwd, rel))
			return rel
		} catch {
			// try next
		}
	}
	return undefined
}

/** Replace values of secret-looking environment variables so they never land in a saved log. */
function maskSecrets(text: string, env: NodeJS.ProcessEnv): string {
	let out = text
	for (const [name, value] of Object.entries(env)) {
		if (value && value.length >= 4 && SECRET_ENV.test(name)) {
			out = out.split(value).join("***")
		}
	}
	return out
}

async function saveLog(cwd: string, startedAt: Date, text: string): Promise<string> {
	const dir = checkRunsDir(cwd)
	await fs.mkdir(dir, { recursive: true })
	const file = path.join(dir, `${startedAt.toISOString().replace(/[:.]/g, "-")}.log`)
	await fs.writeFile(file, text, "utf8")
	await fs.copyFile(file, path.join(dir, "latest.log"))
	return file
}

/**
 * Run the workspace's check_all.sh with bash in its own process group, so a timeout kills the whole
 * tree (SIGTERM, then SIGKILL after 5 s). The combined output is saved under .mycelium/check_runs/.
 */
export async function runCheckAll(cwd: string, opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<CheckRun> {
	const startedAt = new Date()
	const env = opts.env ?? process.env
	const rel = await findScript(cwd)
	if (!rel) {
		return {
			started_at: startedAt.toISOString(),
			duration_ms: 0,
			exit_code: null,
			status: "missing",
			source: "extension",
			command: "bash check_all.sh",
		}
	}
	const command = `bash ${rel}`
	const child = spawn("bash", [rel], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
	let output = ""
	const collect = (d: Buffer) => {
		output += d
		if (output.length > MAX_LOG_CHARS) output = output.slice(output.length - MAX_LOG_CHARS)
	}
	child.stdout.on("data", collect)
	child.stderr.on("data", collect)
	const killGroup = (signal: NodeJS.Signals) => {
		try {
			if (child.pid) process.kill(-child.pid, signal)
		} catch {
			// already gone
		}
	}
	let timedOut = false
	// Settle on the script's own exit (not on stdio close: a background child may hold the pipes open),
	// and in any case by the hard deadline, so a stray or detached child can never hang the gate.
	const exitCode: number | null = await new Promise((resolve) => {
		let settled = false
		const settle = (code: number | null) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			clearTimeout(deadline)
			setTimeout(() => {
				child.stdout.destroy()
				child.stderr.destroy()
			}, EXIT_GRACE_MS).unref()
			resolve(code)
		}
		const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
		const timer = setTimeout(() => {
			timedOut = true
			killGroup("SIGTERM")
			setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS).unref()
		}, timeoutMs)
		const deadline = setTimeout(
			() => {
				timedOut = true
				killGroup("SIGKILL")
				settle(null)
			},
			timeoutMs + KILL_GRACE_MS + EXIT_GRACE_MS,
		)
		child.on("close", (code) => settle(code))
		child.on("exit", (code) => setTimeout(() => settle(code), EXIT_GRACE_MS))
		child.on("error", () => settle(null))
	})
	const log_path = await saveLog(cwd, startedAt, maskSecrets(output, env))
	return {
		started_at: startedAt.toISOString(),
		duration_ms: Date.now() - startedAt.getTime(),
		exit_code: timedOut ? null : exitCode,
		status: timedOut ? "timeout" : exitCode === 0 ? "passed" : "failed",
		log_path,
		source: "extension",
		command,
	}
}

/** True when a shell command (possibly a chain) runs check_all.sh, as opposed to reading or editing it. */
export function isCheckAllCommand(command: string): boolean {
	return command
		.split(/&&|\|\||;|\||\n/)
		.map((s) => s.trim())
		.some((s) => /^(?:(?:bash|sh)\s+)?(?:\.\/)?(?:[\w.-]+\/)*check_all\.sh(?:\s|$)/.test(s))
}

/** Record a check_all run the agent started through execute_command. */
export async function recordObservedRun(
	cwd: string,
	command: string,
	exitCode: number | undefined,
	output: string,
): Promise<CheckRun> {
	const startedAt = new Date()
	const log_path = await saveLog(cwd, startedAt, maskSecrets(output, process.env))
	return {
		started_at: startedAt.toISOString(),
		duration_ms: 0,
		exit_code: exitCode ?? null,
		status: exitCode === undefined ? "unknown" : exitCode === 0 ? "passed" : "failed",
		log_path,
		source: "agent_command",
		command,
	}
}
