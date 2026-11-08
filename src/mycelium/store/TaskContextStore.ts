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
const INDEX_KEY = "__index__"

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

/** task_context.json cannot be used: not JSON, an unknown schema version, or a broken structure. */
export class ContextCorruptError extends Error {
	constructor(
		readonly kind: "corrupt" | "schema" | "invalid",
		readonly file: string,
		readonly reason: string,
	) {
		super(`${file}: ${reason}`)
		this.name = "ContextCorruptError"
	}

	get taskId(): string {
		return path.basename(path.dirname(this.file))
	}
}

const PLAN_STATUSES: ReadonlySet<unknown> = new Set(["todo", "next", "in_progress", "done"])
const isStr = (v: unknown): v is string => typeof v === "string"
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v)

/** The first structural problem in a parsed task_context.json (e.g. after a hand edit), or undefined. */
export function contextProblem(c: unknown): string | undefined {
	if (!isObj(c)) return "not a JSON object"
	if (!isStr(c.task_id)) return "task_id must be a string"
	if (!isStr(c.mode) || !Object.hasOwn(PIPELINES, c.mode)) return `mode "${c.mode}" is not a known mode`
	if (!PIPELINES[c.mode as ModeId].includes(c.stage)) return `stage "${c.stage}" is not a stage of ${c.mode}`
	if (c.profile !== "tao" && c.profile !== "improved") return `profile "${c.profile}" must be tao or improved`
	if (!isObj(c.task)) return "task must be an object"
	if (!isStr(c.task.spec)) return "task.spec must be a string"
	for (const k of ["acceptance_criteria", "constraints"]) {
		if (!Array.isArray(c.task[k]) || !c.task[k].every(isStr)) return `task.${k} must be a list of strings`
	}
	if (
		!Array.isArray(c.task.plan) ||
		!c.task.plan.every((p: any) => isObj(p) && isStr(p.id) && isStr(p.text) && PLAN_STATUSES.has(p.status))
	)
		return "task.plan items need id, text and status (todo, next, in_progress, done)"
	for (const k of ["stage_history", "ac_rounds", "refs", "notes", "changes", "user_notes", "execution_log"]) {
		if (!Array.isArray(c[k])) return `${k} must be a list`
	}
	if (!c.stage_history.every((h: any) => isObj(h) && isStr(h.at))) return "stage_history items need an `at` time"
	if (
		!c.notes.every((n: any) => isObj(n) && isStr(n.id) && isStr(n.text) && Array.isArray(n.tags) && Array.isArray(n.comments))
	)
		return "notes items need id, text, tags and comments"
	if (!c.refs.every((r: any) => isObj(r) && isStr(r.id) && isStr(r.path) && isNum(r.start_line) && isNum(r.end_line)))
		return "refs items need id, path, start_line and end_line"
	if (!isObj(c.exit_criteria) || !Object.values(c.exit_criteria).every((v) => typeof v === "boolean"))
		return "exit_criteria must map names to true/false"
	const uc = c.update_cycle
	if (!isObj(uc) || !isNum(uc.processed_until) || !isNum(uc.turn_counter) || typeof uc.pending_force !== "boolean")
		return "update_cycle needs processed_until and turn_counter (numbers) and pending_force (true/false)"
	if (!isObj(c.repair) || !isObj(c.migration)) return "repair and migration must be objects"
	const m = c.metrics
	if (!isObj(m) || !isObj(m.by_type) || !isObj(m.by_stage) || !Array.isArray(m.check_runs))
		return "metrics needs by_type, by_stage and check_runs"
	return undefined
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
	 * Load a task's context. Never changes the file: a corrupt file, an unknown schema version or a broken
	 * structure throws ContextCorruptError; `recover` is the explicit way to start fresh.
	 */
	async load(taskId: string): Promise<TaskContext> {
		const file = this.file(taskId)
		const raw = await fs.readFile(file, "utf8")
		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch (error) {
			throw new ContextCorruptError("corrupt", file, `not valid JSON (${error instanceof Error ? error.message : error})`)
		}
		if (isObj(parsed) && parsed.schema_version !== SCHEMA_VERSION) {
			throw new ContextCorruptError(
				"schema",
				file,
				`schema_version ${parsed.schema_version} (this build reads ${SCHEMA_VERSION})`,
			)
		}
		const problem = contextProblem(parsed)
		if (problem) throw new ContextCorruptError("invalid", file, problem)
		return parsed as TaskContext
	}

	/**
	 * Keep an unusable task_context.json aside (never overwritten) and start fresh memory from the task's
	 * meta.json. Returns the current context unchanged if the file has become readable meanwhile.
	 */
	recover(taskId: string): Promise<TaskContext> {
		return this.exclusive(taskId, async () => {
			let problem: ContextCorruptError
			try {
				return await this.load(taskId)
			} catch (error) {
				if (!(error instanceof ContextCorruptError)) throw error
				problem = error
			}
			let version: unknown
			try {
				version = JSON.parse(await fs.readFile(this.file(taskId), "utf8")).schema_version
			} catch {
				// not JSON
			}
			const asideName =
				problem.kind === "schema"
					? `task_context.v${version}.${Date.now()}.json`
					: `task_context.corrupt.${Date.now()}.json`
			await fs.rename(this.file(taskId), this.file(taskId, asideName))
			let meta: TaskMeta
			try {
				meta = JSON.parse(await fs.readFile(this.file(taskId, META_FILE), "utf8"))
			} catch {
				meta = { task_id: taskId, cline_task_id: "", mode: "developer", profile: "improved" }
			}
			const ctx = this.fresh(meta, new Date().toISOString())
			await writeAtomic(this.file(taskId), JSON.stringify(ctx, null, 2))
			await appendAudit(this.cwd, taskId, problem.kind === "schema" ? "context_schema_mismatch" : "context_quarantined", {
				moved_to: asideName,
				reason: problem.reason,
			})
			return ctx
		})
	}

	/** The task for a Cline task id: from index.json, else from the tasks' meta.json (and the index is repaired). */
	async findByClineTask(clineTaskId: string): Promise<TaskContext | undefined> {
		let taskId = (await this.readIndex()).index?.[clineTaskId]
		if (!taskId) {
			taskId = (await this.scanMetas())[clineTaskId]
			if (taskId) await this.indexTask(clineTaskId, taskId)
		}
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
			ids = await fs.readdir(this.tasksDir())
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

	private tasksDir(): string {
		return path.dirname(taskDir(this.cwd, "x"))
	}

	/** index.json; `index` is undefined when the file exists but is not a JSON object. */
	private async readIndex(): Promise<{ index?: Record<string, string> }> {
		let raw: string
		try {
			raw = await fs.readFile(indexFile(this.cwd), "utf8")
		} catch {
			return { index: {} }
		}
		try {
			const parsed = JSON.parse(raw)
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { index: parsed }
		} catch {
			// corrupt
		}
		return {}
	}

	/** cline_task_id → task_id from every task's meta.json; the newest task wins a duplicate. */
	private async scanMetas(): Promise<Record<string, string>> {
		const out: Record<string, string> = {}
		let ids: string[]
		try {
			ids = (await fs.readdir(this.tasksDir())).sort()
		} catch {
			return out
		}
		for (const id of ids) {
			try {
				const meta = JSON.parse(await fs.readFile(this.file(id, META_FILE), "utf8")) as TaskMeta
				if (typeof meta.cline_task_id === "string" && meta.cline_task_id && meta.task_id === id)
					out[meta.cline_task_id] = id
			} catch {
				// not a task directory
			}
		}
		return out
	}

	private async indexTask(clineTaskId: string, taskId: string): Promise<void> {
		await this.exclusive(INDEX_KEY, async () => {
			let { index } = await this.readIndex()
			if (!index) {
				await fs.rename(indexFile(this.cwd), `${indexFile(this.cwd)}.corrupt.${Date.now()}`).catch(() => undefined)
				index = await this.scanMetas()
			}
			index[clineTaskId] = taskId
			await writeAtomic(indexFile(this.cwd), JSON.stringify(index, null, 2))
		})
	}

	/** Run `fn` after every earlier operation on `key` in this process, holding the cross-process lock file. */
	private exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.chains.get(key) ?? Promise.resolve()
		const run = prev.then(async () => {
			const release = await this.acquireLock(key === INDEX_KEY ? `${indexFile(this.cwd)}.lock` : this.file(key, LOCK_FILE))
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

	private async acquireLock(lock: string): Promise<() => Promise<void>> {
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
