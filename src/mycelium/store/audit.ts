import fs from "node:fs/promises"
import path from "node:path"
import { taskDir } from "../paths"

/** Append one event to `.mycelium/tasks/<task_id>/audit.jsonl` (append-only, one JSON object per line). */
export async function appendAudit(cwd: string, taskId: string, event: string, data?: object): Promise<void> {
	const dir = taskDir(cwd, taskId)
	await fs.mkdir(dir, { recursive: true })
	const line = JSON.stringify({ at: new Date().toISOString(), event, ...data })
	await fs.appendFile(path.join(dir, "audit.jsonl"), `${line}\n`, "utf8")
}
