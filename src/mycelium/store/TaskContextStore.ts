import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { type ModeId, PIPELINES, STAGES, type StageId } from "../modes/pipelines"
import { indexFile, taskDir } from "../paths"
import type { ProfileId } from "../profile"
import { appendAudit } from "./audit"
import { emptyMetrics, type PlanItem, SCHEMA_VERSION, type TaskContext } from "./schema"

const CONTEXT_FILE = "task_context.json"
const META_FILE = "meta.json"
const LOCK_FILE = ".lock"
const LOCK_STALE_MS = 10_000
const LOCK_WAIT_MS = 15_000

interface TaskMeta {
	task_id: string
	cline_task_id: string
	mode: ModeId
	profile: ProfileId
	previous_task_id?: string
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0")
function newTaskId(now = new Date()): string {
	const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
	return `t_${ts}_${randomBytes(3).toString("hex")}`
}

/** Plan items for entering `stage`; ids are stable per stage and position. */
export function autoPlanFor(stage: StageId): PlanItem[] {
	return STAGES[stage].autoPlan.map((text, i) => ({ id: `auto_${stage}_${i + 1}`, text, status: "todo" }))
}

export function criteriaFor(stage: StageId): Record<string, boolean> {
	return Object.fromEntries(Object.keys(STAGES[stage].exitCriteria).map((k) => [k, false]))
}

async function writeAtomic(file: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true })
	const tmp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`
	await fs.writeFile(tmp, content, "utf8")
	await fs.rename(tmp, file)
}

/**
 * Per-task JSON memory under `.mycelium/tasks/<task_id>/`. Writes are atomic (temp file + rename) and
 * serialised per task: an in-process promise chain plus a `.lock` file for other VS Code windows.
 */
export class TaskContextStore {
	private readonly chains = new Map<string, Promise<unknown>>()

	constructor(readonly cwd: string) {}

	private file(taskId: string, name = CONTEXT_FILE) {
		return path.join(taskDir(this.cwd, taskId), name)
	}

	async create(args: { clineTaskId: string; mode: ModeId; profile: ProfileId; previousTaskId?: string }): Promise<TaskContext> {
		const now = new Date()
		const meta: TaskMeta = {
			task_id: newTaskId(now),
			cline_task_id: args.clineTaskId,
			mode: args.mode,
			profile: args.profile,
			previous_task_id: args.previousTaskId,
		}
		const ctx = this.fresh(meta, now.toISOString())
		await writeAtomic(this.file(meta.task_id, META_FILE), JSON.stringify(meta, null, 2))
		await writeAtomic(this.file(meta.task_id), JSON.stringify(ctx, null, 2))
		await this.indexTask(args.clineTaskId, meta.task_id)
		await appendAudit(this.cwd, meta.task_id, "task_context_created", { mode: args.mode, profile: args.profile })
		return ctx
	}

	private fresh(meta: TaskMeta, at: string): TaskContext {
		const stage = PIPELINES[meta.mode][0]
		return {
			schema_version: SCHEMA_VERSION,
			task_id: meta.task_id,
			cline_task_id: meta.cline_task_id,
			previous_task_id: meta.previous_task_id,
			profile: meta.profile,
			mode: meta.mode,
			stage,
			status: "active",
			created_at: at,
			updated_at: at,
			stage_history: [],
			exit_criteria: criteriaFor(stage),
			task: { spec: "", acceptance_criteria: [], constraints: [], plan: autoPlanFor(stage) },
			ac_rounds: [],
			refs: [],
			notes: [],
			changes: [],
			user_notes: [],
			execution_log: [],
			update_cycle: { processed_until: 0, turn_counter: 0, pending_force: false },
			repair: {},
			migration: {},
			metrics: emptyMetrics(at),
		}
	}

	/**
	 * Load a task's context. A corrupt file, or one with an unknown schema version, is renamed aside
	 * (never overwritten) and a fresh context is created from the task's meta.json.
	 */
	async load(taskId: string): Promise<TaskContext> {
		const file = this.file(taskId)
		const raw = await fs.readFile(file, "utf8")
		let parsed: TaskContext
		try {
			parsed = JSON.parse(raw)
		} catch (error) {
			return this.recover(taskId, `task_context.corrupt.${Date.now()}.json`, "context_quarantined", String(error))
		}
		if (parsed.schema_version !== SCHEMA_VERSION) {
			return this.recover(
				taskId,
				`task_context.v${parsed.schema_version}.${Date.now()}.json`,
				"context_schema_mismatch",
				`schema_version ${parsed.schema_version}`,
			)
		}
		return parsed
	}

	private async recover(taskId: string, asideName: string, event: string, reason: string): Promise<TaskContext> {
		await fs.rename(this.file(taskId), this.file(taskId, asideName))
		let meta: TaskMeta
		try {
			meta = JSON.parse(await fs.readFile(this.file(taskId, META_FILE), "utf8"))
		} catch {
			meta = { task_id: taskId, cline_task_id: "", mode: "developer", profile: "improved" }
		}
		const ctx = this.fresh(meta, new Date().toISOString())
		await writeAtomic(this.file(taskId), JSON.stringify(ctx, null, 2))
		await appendAudit(this.cwd, taskId, event, { moved_to: asideName, reason })
		return ctx
	}

	async findByClineTask(clineTaskId: string): Promise<TaskContext | undefined> {
		const index = await this.readIndex()
		const taskId = index[clineTaskId]
		return taskId ? this.load(taskId) : undefined
	}

	/** Load, apply `fn` (mutate in place or return a replacement), save atomically; serialised per task. */
	update(taskId: string, fn: (ctx: TaskContext) => TaskContext | void): Promise<TaskContext> {
		return this.exclusive(taskId, async () => {
			const current = await this.load(taskId)
			const next = fn(current) ?? current
			next.updated_at = new Date().toISOString()
			await writeAtomic(this.file(taskId), JSON.stringify(next, null, 2))
			return next
		})
	}

	async snapshot(taskId: string, reason: string): Promise<string> {
		return this.exclusive(taskId, async () => {
			const id = `s_${Date.now()}_${randomBytes(3).toString("hex")}`
			const raw = await fs.readFile(this.file(taskId), "utf8")
			await writeAtomic(path.join(taskDir(this.cwd, taskId), "snapshots", `${id}.json`), raw)
			await appendAudit(this.cwd, taskId, "snapshot", { snapshot_id: id, reason })
			return id
		})
	}

	async rollback(taskId: string, snapshotId: string): Promise<TaskContext> {
		return this.exclusive(taskId, async () => {
			const raw = await fs.readFile(path.join(taskDir(this.cwd, taskId), "snapshots", `${snapshotId}.json`), "utf8")
			await writeAtomic(this.file(taskId), raw)
			await appendAudit(this.cwd, taskId, "rollback", { snapshot_id: snapshotId })
			return JSON.parse(raw) as TaskContext
		})
	}

	async listTasks(): Promise<TaskContext[]> {
		let ids: string[]
		try {
			ids = await fs.readdir(path.join(taskDir(this.cwd, "x"), ".."))
		} catch {
			return []
		}
		const out: TaskContext[] = []
		for (const id of ids) {
			try {
				out.push(await this.load(id))
			} catch {
				// not a task directory
			}
		}
		return out
	}

	private async readIndex(): Promise<Record<string, string>> {
		try {
			return JSON.parse(await fs.readFile(indexFile(this.cwd), "utf8"))
		} catch {
			return {}
		}
	}

	private async indexTask(clineTaskId: string, taskId: string): Promise<void> {
		await this.exclusive("__index__", async () => {
			const index = await this.readIndex()
			index[clineTaskId] = taskId
			await writeAtomic(indexFile(this.cwd), JSON.stringify(index, null, 2))
		})
	}

	/** Run `fn` after every earlier operation on `key` in this process, holding the cross-process lock file. */
	private exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.chains.get(key) ?? Promise.resolve()
		const run = prev.then(async () => {
			const release = key === "__index__" ? async () => {} : await this.acquireLock(key)
			try {
				return await fn()
			} finally {
				await release()
			}
		})
		this.chains.set(
			key,
			run.catch(() => undefined),
		)
		return run
	}

	private async acquireLock(taskId: string): Promise<() => Promise<void>> {
		const lock = this.file(taskId, LOCK_FILE)
		await fs.mkdir(path.dirname(lock), { recursive: true })
		const deadline = Date.now() + LOCK_WAIT_MS
		for (;;) {
			try {
				await fs.writeFile(lock, `${process.pid}:${Date.now()}`, { flag: "wx" })
				return async () => {
					await fs.rm(lock, { force: true })
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
					throw error
				}
				const [, ts] = (await fs.readFile(lock, "utf8").catch(() => ":0")).split(":")
				if (Date.now() - Number(ts) > LOCK_STALE_MS || Date.now() > deadline) {
					await fs.rm(lock, { force: true })
					continue
				}
				await new Promise((r) => setTimeout(r, 20))
			}
		}
	}
}
