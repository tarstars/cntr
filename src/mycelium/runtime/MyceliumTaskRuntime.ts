import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ClineStorageMessage } from "@/shared/messages/content"
import { isCheckAllCommand, recordObservedRun, runCheckAll } from "../gate/checkAll"
import type { GateDeps } from "../gate/stageGate"
import { buildRequestMessages, historyAfterCycle } from "../kernel/buildRequest"
import { KernelCache } from "../kernel/KernelCache"
import { renderKernel } from "../kernel/renderKernel"
import { readSnippet, selectSnippetRefs } from "../kernel/snippets"
import type { LlmCaller, LlmResult, LlmUsage } from "../llm/LlmCaller"
import { runMigrationIfNeeded } from "../memory/migration"
import { runRepairIfDue } from "../memory/repairPlanner"
import { runUpdateCycle, shouldRunUpdateCycle } from "../memory/updateCycle"
import { addCheckRun, addToolTime, finishTask, recordCall } from "../metrics/metrics"
import { type ModeId, MYCELIUM_TOOLS, PIPELINES, type StageId } from "../modes/pipelines"
import { evaluateToolPolicy, type ToolPolicyResult } from "../modes/toolPolicy"
import { myceliumDir, nextTaskFile } from "../paths"
import { getProfile, type Profile, type ProfileId, readWorkspaceSettings } from "../profile"
import type { CallType, TaskContext } from "../store/schema"
import { TaskContextStore } from "../store/TaskContextStore"
import type { MyceliumHooks } from "./types"

const MODES = Object.keys(PIPELINES) as ModeId[]
const isMode = (v: unknown): v is ModeId => MODES.includes(v as ModeId)
const BIBLE_MAX_LINES = 400
const BIBLE_MAX_CHARS = 8000

/** One cache for the whole extension host; slots are per task. */
const kernelCache = new KernelCache()

const exists = (p: string) =>
	fs.access(p).then(
		() => true,
		() => false,
	)

async function readBible(cwd: string): Promise<string | undefined> {
	for (const rel of ["README_AI.md", path.join("docs", "README_AI.md")]) {
		try {
			const text = await fs.readFile(path.join(cwd, rel), "utf8")
			return text.split(/\r?\n/).slice(0, BIBLE_MAX_LINES).join("\n").slice(0, BIBLE_MAX_CHARS)
		} catch {
			// try next
		}
	}
	return undefined
}

function userTexts(history: ClineStorageMessage[], n: number): string[] {
	const texts: string[] = []
	for (const m of history) {
		if (m.role !== "user") continue
		const blocks = (Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content) }]) as Array<{
			type: string
			text?: string
		}>
		for (const b of blocks) if (b.type === "text" && b.text) texts.push(b.text)
	}
	return texts.slice(-n)
}

/**
 * Per-task facade between Cline's task loop and the Mycelium modules. Created by `attach` on the
 * first request of a task; `undefined` (stock Cline behaviour) when the workspace has no `.mycelium/`.
 */
export class MyceliumTaskRuntime implements MyceliumHooks {
	readonly store: TaskContextStore
	private ctx: TaskContext

	private constructor(
		readonly cwd: string,
		readonly profile: Profile,
		initial: TaskContext,
		private readonly caller: LlmCaller,
		private readonly askOwner: (question: string) => Promise<boolean>,
		private readonly startupNotices: string[],
	) {
		this.store = new TaskContextStore(cwd)
		this.ctx = initial
	}

	get taskId(): string {
		return this.ctx.task_id
	}

	static async attach(args: {
		cwd: string
		clineTaskId: string
		isResume: boolean
		caller: LlmCaller
		askOwner: (question: string) => Promise<boolean>
	}): Promise<MyceliumTaskRuntime | undefined> {
		const { cwd, clineTaskId } = args
		const hasPending = await exists(nextTaskFile(cwd))
		if (!hasPending && !(await exists(myceliumDir(cwd)))) return undefined

		const store = new TaskContextStore(cwd)
		const settings = await readWorkspaceSettings(cwd)
		const notices = settings.warning ? [settings.warning] : []
		let ctx = await store.findByClineTask(clineTaskId)
		if (!ctx) {
			let pending: { mode?: unknown; profile?: unknown } = {}
			if (hasPending) {
				try {
					pending = JSON.parse(await fs.readFile(nextTaskFile(cwd), "utf8"))
				} catch {
					notices.push(".mycelium/next_task.json was not valid JSON; using the workspace defaults.")
				}
				await fs.rm(nextTaskFile(cwd), { force: true })
			}
			const mode = isMode(pending.mode) ? pending.mode : isMode(settings.defaultMode) ? settings.defaultMode : "developer"
			const profileId: ProfileId =
				pending.profile === "tao" || pending.profile === "improved" ? pending.profile : settings.profile
			ctx = await store.create({ clineTaskId, mode, profile: profileId })
		}
		return new MyceliumTaskRuntime(cwd, getProfile(ctx.profile), ctx, args.caller, args.askOwner, notices)
	}

	mode(): ModeId {
		return this.ctx.mode
	}

	stage(): StageId {
		return this.ctx.stage
	}

	checkToolCall(name: string): ToolPolicyResult {
		return evaluateToolPolicy(this.ctx.mode, this.ctx.stage, name, this.profile)
	}

	/** Predicate for the system prompt's tool list (current stage). */
	toolFilter(): (toolId: string) => boolean {
		const { mode, stage } = this.ctx
		return (toolId) => evaluateToolPolicy(mode, stage, toolId, this.profile).decision !== "deny"
	}

	/** myc_* tools to add to the prompt variant's tool list for the current stage. */
	myceliumToolIds(): string[] {
		const allow = this.toolFilter()
		return MYCELIUM_TOOLS.filter((t) => allow(t))
	}

	gateDeps(): GateDeps {
		return { runCheckAll: () => runCheckAll(this.cwd), askOwner: this.askOwner }
	}

	invalidateKernel(): void {
		kernelCache.invalidate(this.taskId)
	}

	private announce(notices: string[], text: string): void {
		if (this.profile.aux.announce) notices.push(text)
	}

	private async record(type: CallType, result: LlmResult | undefined, counted: boolean): Promise<void> {
		if (!result) return
		this.ctx = await this.store.update(this.taskId, (c) => recordCall(c, { type, stage: c.stage, result, counted }))
	}

	/**
	 * Everything that happens before an agent request: turn counter, knowledge migration, update-cycle
	 * (and tao's history truncation), repair planner, then the kernel and the messages to send.
	 */
	async beforeRequest(history: ClineStorageMessage[]): Promise<{
		messages: ClineStorageMessage[]
		replaceStoredHistory?: ClineStorageMessage[]
		notices: string[]
	}> {
		const notices = this.startupNotices.splice(0)
		this.ctx = await this.store.update(this.taskId, (c) => {
			c.update_cycle.turn_counter += 1
		})

		const migration = await runMigrationIfNeeded({
			store: this.store,
			taskId: this.taskId,
			caller: this.caller,
			profile: this.profile,
			lastUserMessages: userTexts(history, 2),
		})
		if (migration.ran) {
			await this.record("migration", migration.result, this.profile.aux.countMigration)
			this.announce(
				notices,
				migration.error ? `Knowledge migration failed: ${migration.error}` : "Knowledge migrated from the previous task.",
			)
			this.invalidateKernel()
		}

		let working = history
		let replaceStoredHistory: ClineStorageMessage[] | undefined
		this.ctx = await this.store.load(this.taskId)
		if (shouldRunUpdateCycle(history, this.ctx, this.profile)) {
			const uc = await runUpdateCycle({
				store: this.store,
				taskId: this.taskId,
				history,
				caller: this.caller,
				profile: this.profile,
				cwd: this.cwd,
			})
			await this.record("update_cycle", uc.result, true)
			if (uc.applied) {
				this.invalidateKernel()
				const kept = historyAfterCycle(history, this.profile)
				if (kept !== history) {
					replaceStoredHistory = kept
					working = kept
					this.ctx = await this.store.update(this.taskId, (c) => {
						c.update_cycle.processed_until = kept.length
					})
				}
				this.announce(notices, "Update-cycle: memory updated from the latest tool results.")
			} else {
				this.announce(notices, `Update-cycle failed: ${uc.error ?? "unknown error"}`)
			}
		}

		const repair = await runRepairIfDue({
			store: this.store,
			taskId: this.taskId,
			caller: this.caller,
			profile: this.profile,
			turn: this.ctx.update_cycle.turn_counter,
		})
		if (repair.ran) {
			await this.record("repair", repair.result, repair.applied || !this.profile.aux.countRepairOnlyWhenApplied)
			if (repair.applied) this.invalidateKernel()
			this.announce(
				notices,
				repair.applied ? "Repair planner fixed the plan." : `Repair planner: ${repair.error ?? "no change"}`,
			)
		}

		this.ctx = await this.store.load(this.taskId)
		const kernel = await this.kernel()
		const tail = this.profile.kernel.planInKernel ? undefined : this.tail()
		return {
			messages: buildRequestMessages({ history: working, kernel, tail, profile: this.profile }),
			replaceStoredHistory,
			notices,
		}
	}

	private async kernel(): Promise<string> {
		const c = this.ctx
		const key = createHash("sha256")
			.update(
				JSON.stringify([
					c.stage,
					c.mode,
					c.task.spec,
					c.task.acceptance_criteria,
					c.task.constraints,
					c.exit_criteria,
					c.ac_rounds.length,
				]),
			)
			.digest("hex")
		if (this.profile.kernel.cacheBetweenCycles) {
			const cached = kernelCache.get(this.taskId, key)
			if (cached) return cached
		}
		const refs = selectSnippetRefs(c.refs, this.profile)
		const snippets = await Promise.all(refs.map((r) => readSnippet(this.cwd, r, this.profile.kernel.maxSnippetLines)))
		const others = (await this.store.listTasks()).filter((t) => t.task_id !== c.task_id && t.status === "done")
		const recentTasks = others
			.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
			.slice(0, 5)
			.map((t) => `${t.task_id} (${t.mode}): ${t.task.spec}`.slice(0, 3000))
		const text = renderKernel(
			c,
			{
				readmeAi: await readBible(this.cwd),
				recentTasks,
				snippets,
				systemInfo: `OS: ${os.platform()} · shell: ${process.env.SHELL ?? "unknown"} · workspace: ${this.cwd}`,
			},
			this.profile,
		)
		kernelCache.set(this.taskId, key, text)
		return text
	}

	/** tao: the plan travels in a tail message after the history. */
	private tail(): string {
		const plan = this.ctx.task.plan.map((p) => `- [${p.status}] ${p.id}: ${p.text}`).join("\n")
		return `[Mycelium] Current plan (${this.ctx.stage}):\n${plan || "(empty)"}`
	}

	async afterAgentCall(call: { usage: LlmUsage; durationMs: number }): Promise<void> {
		await this.record("agent", { text: "", usage: call.usage, durationMs: call.durationMs }, true)
	}

	async onCommandFinished(command: string, exitCode: number | undefined, output: string): Promise<void> {
		if (!isCheckAllCommand(command)) return
		const run = await recordObservedRun(this.cwd, command, exitCode, output)
		this.ctx = await this.store.update(this.taskId, (c) => addCheckRun(c, run))
	}

	async onToolFinished(ms: number): Promise<void> {
		this.ctx = await this.store.update(this.taskId, (c) => addToolTime(c, ms))
	}

	async onTaskCompleted(): Promise<void> {
		this.ctx = await this.store.update(this.taskId, (c) => {
			const done = finishTask(c, new Date().toISOString())
			done.status = "done"
			return done
		})
	}
}
