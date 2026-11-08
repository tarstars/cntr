import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import type { ToolResponse } from "@core/task"
import type { IToolHandler } from "@core/task/tools/ToolExecutorCoordinator"
import type { TaskConfig } from "@core/task/tools/types/TaskConfig"
import { ClineDefaultTool } from "@/shared/tools"
import { applyTransition, type Evidence, validateTransition } from "../gate/stageGate"
import { anchorHash } from "../kernel/snippets"
import { addCheckRun } from "../metrics/metrics"
import { STAGES, type StageId } from "../modes/pipelines"
import { handoffsDir } from "../paths"
import type { MyceliumHooks } from "../runtime/types"
import { appendAudit } from "../store/audit"
import type { AcStatus, NoteTag, PlanItem } from "../store/schema"

type Params = Partial<Record<string, string>>
const NOTE_TAGS = new Set<NoteTag>(["hypothesis", "decision", "negative_knowledge", "info", "user_message"])
const PLAN_STATUSES = new Set(["todo", "next", "in_progress", "done"])
const AC_STATUSES = new Set<AcStatus>(["pass", "fail", "skip", "pending"])
const newId = (prefix: string) => `${prefix}_${randomBytes(4).toString("hex")}`

class ToolInputError extends Error {}

function json<T>(raw: string | undefined, what: string): T {
	try {
		return JSON.parse(raw ?? "")
	} catch {
		throw new ToolInputError(`${what} must be valid JSON.`)
	}
}
const required = (params: Params, name: string): string => {
	const v = params[name]?.trim()
	if (!v) throw new ToolInputError(`Missing required parameter '${name}'.`)
	return v
}
const list = (raw: string | undefined, what: string): string[] => {
	const v = json<unknown>(raw, what)
	if (!Array.isArray(v)) throw new ToolInputError(`${what} must be a JSON array.`)
	return v.map(String)
}

type Run = (hooks: MyceliumHooks, params: Params) => Promise<string>

const RUNS: Record<string, Run> = {
	async myc_set_stage(h, params) {
		const evidence = json<Evidence>(params.evidence, "evidence")
		const req = {
			to: params.to_stage as StageId | undefined,
			reason: params.reason ?? "",
			evidence,
			back: params.back === "true",
		}
		const ctx = await h.store.load(h.taskId)
		const verdict = await validateTransition(ctx, req, h.profile, h.gateDeps())
		if (!verdict.ok) throw new ToolInputError(verdict.error)
		const next = await h.store.update(h.taskId, (c) => {
			const withRun = verdict.checkRun ? addCheckRun(c, verdict.checkRun) : c
			return applyTransition(withRun, verdict.to, req, "agent")
		})
		await appendAudit(h.cwd, h.taskId, "stage_transition", { from: ctx.stage, to: verdict.to, reason: req.reason })
		h.invalidateKernel()
		return `Stage transition: ${ctx.stage} → ${next.stage}\nReason: ${req.reason}\nNow: ${STAGES[next.stage].contract.split("\n")[0]}`
	},

	async myc_update_task_spec(h, params) {
		await h.store.update(h.taskId, (c) => {
			if (params.spec !== undefined) c.task.spec = params.spec
			if (params.acceptance_criteria !== undefined)
				c.task.acceptance_criteria = list(params.acceptance_criteria, "acceptance_criteria")
			if (params.constraints !== undefined) c.task.constraints = list(params.constraints, "constraints")
		})
		h.invalidateKernel()
		return "Task spec updated."
	},

	async myc_add_code_ref(h, params) {
		const file = required(params, "path")
		const start = Number(required(params, "start_line"))
		const end = Number(required(params, "end_line"))
		if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start)
			throw new ToolInputError("start_line and end_line must be line numbers with start_line ≤ end_line.")
		const lines = (
			await fs.readFile(path.resolve(h.cwd, file), "utf8").catch(() => {
				throw new ToolInputError(`Cannot read ${file}.`)
			})
		).split(/\r?\n/)
		const sha256 = anchorHash(lines.slice(start - 1, end))
		let id = ""
		await h.store.update(h.taskId, (c) => {
			const existing = c.refs.find((r) => r.path === file && r.start_line === start && r.end_line === end)
			if (existing) {
				Object.assign(existing, {
					why: params.why ?? existing.why,
					sha256,
					at_turn: c.update_cycle.turn_counter,
					stale: false,
				})
				id = existing.id
			} else {
				id = newId("r")
				c.refs.push({
					id,
					path: file,
					start_line: start,
					end_line: end,
					sha256,
					why: params.why ?? "",
					at_turn: c.update_cycle.turn_counter,
					stale: false,
					resolved: false,
				})
			}
		})
		return `Code reference ${id} recorded.`
	},

	async myc_add_note(h, params) {
		const text = required(params, "text")
		const tags = (params.tags ?? "").split(/[,\s]+/).filter((t): t is NoteTag => NOTE_TAGS.has(t as NoteTag))
		const id = newId("n")
		await h.store.update(h.taskId, (c) => {
			c.notes.push({
				id,
				text,
				tags: tags.length ? tags : ["info"],
				at_turn: c.update_cycle.turn_counter,
				hidden: false,
				resolved: false,
				comments: [],
			})
		})
		return `Note ${id} recorded.`
	},

	async myc_add_note_comment(h, params) {
		const noteId = required(params, "note_id")
		const text = required(params, "text")
		await h.store.update(h.taskId, (c) => {
			const note = c.notes.find((n) => n.id === noteId)
			if (!note) throw new ToolInputError(`No note with id ${noteId}.`)
			note.comments.push({ text, at: new Date().toISOString() })
			note.at_turn = c.update_cycle.turn_counter
		})
		return `Comment added to ${noteId}.`
	},

	async myc_update_plan(h, params) {
		await h.store.update(h.taskId, (c) => {
			if (params.items !== undefined) {
				const items = json<{ text: string; status?: string }[]>(params.items, "items")
				if (!Array.isArray(items) || items.length > 50)
					throw new ToolInputError("items must be a JSON array of at most 50 items.")
				c.task.plan = items.map((it, i) => ({
					id: `p_${i + 1}_${randomBytes(2).toString("hex")}`,
					text: String(it.text),
					status: (PLAN_STATUSES.has(it.status ?? "") ? it.status : "todo") as PlanItem["status"],
				}))
			} else {
				const item = c.task.plan.find((x) => x.id === required(params, "item_id"))
				if (!item) throw new ToolInputError(`No plan item ${params.item_id}.`)
				const status = required(params, "status")
				if (!PLAN_STATUSES.has(status)) throw new ToolInputError("status must be todo, next, in_progress or done.")
				item.status = status as PlanItem["status"]
			}
		})
		return "Plan updated."
	},

	async myc_update_exit_criteria(h, params) {
		const criteria = json<Record<string, unknown>>(params.criteria, "criteria")
		const refused: string[] = []
		const unknown: string[] = []
		await h.store.update(h.taskId, (c) => {
			const known = STAGES[c.stage].exitCriteria
			for (const [key, value] of Object.entries(criteria)) {
				if (!(key in known)) {
					unknown.push(key)
				} else if (key === "check_all_passed" && h.profile.stages.checkAllVerifiedByExtension) {
					refused.push(key)
				} else {
					c.exit_criteria[key] = value === true
				}
			}
		})
		h.invalidateKernel()
		const notes = [
			refused.length
				? "check_all_passed is set by Mycelium itself: it runs check_all.sh during myc_set_stage and records the result."
				: "",
			unknown.length ? `Not criteria of this stage (ignored): ${unknown.join(", ")}.` : "",
		].filter(Boolean)
		return ["Exit criteria updated.", ...notes].join("\n")
	},

	async myc_update_acceptance_criteria(h, params) {
		const raw = json<{ index: number; status: string; comment?: string }[]>(params.statuses, "statuses")
		if (!Array.isArray(raw)) throw new ToolInputError("statuses must be a JSON array.")
		const items = raw
			.filter((s) => Number.isInteger(s?.index) && AC_STATUSES.has(s?.status as AcStatus))
			.map((s) => ({ index: s.index, status: s.status as AcStatus, comment: s.comment }))
		await h.store.update(h.taskId, (c) => {
			c.ac_rounds.push({ at: new Date().toISOString(), items })
		})
		h.invalidateKernel()
		return `Recorded ${items.length} verdict(s).`
	},

	async myc_create_handoff(h, params) {
		const summary = required(params, "summary")
		const ctx = await h.store.load(h.taskId)
		const visible = ctx.notes.filter((n) => !n.hidden)
		const bundle = {
			task_id: ctx.task_id,
			mode: ctx.mode,
			created_at: new Date().toISOString(),
			summary,
			spec: ctx.task.spec,
			acceptance_criteria: ctx.task.acceptance_criteria,
			constraints: ctx.task.constraints,
			refs: ctx.refs.filter((r) => !r.resolved).slice(-20),
			decisions: visible.filter((n) => n.tags.includes("decision")).map((n) => ({ id: n.id, text: n.text })),
			notes: visible.map((n) => ({
				id: n.id,
				text: n.text,
				tags: n.tags,
				comments: n.comments.slice(-5).map((c) => c.text),
			})),
		}
		await fs.mkdir(handoffsDir(h.cwd), { recursive: true })
		const file = path.join(handoffsDir(h.cwd), `${ctx.task_id}.json`)
		await fs.writeFile(file, JSON.stringify(bundle, null, 2))
		await appendAudit(h.cwd, h.taskId, "handoff_created", { file })
		return `Handoff written to ${path.relative(h.cwd, file)}. Start a Developer task for the first roadmap phase; it will pick this up.`
	},
}

class MyceliumToolHandler implements IToolHandler {
	constructor(
		readonly name: ClineDefaultTool,
		private readonly run: Run,
	) {}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const hooks = config.getMycelium?.()
		if (!hooks) {
			return formatResponse.toolError(
				"Mycelium memory is not active for this task (start the task with “Mycelium: New Task…”).",
			)
		}
		try {
			return await this.run(hooks, block.params as Params)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			return formatResponse.toolError(message)
		}
	}
}

const BY_NAME: Record<string, ClineDefaultTool> = {
	myc_set_stage: ClineDefaultTool.MYC_SET_STAGE,
	myc_update_task_spec: ClineDefaultTool.MYC_UPDATE_TASK_SPEC,
	myc_add_code_ref: ClineDefaultTool.MYC_ADD_CODE_REF,
	myc_add_note: ClineDefaultTool.MYC_ADD_NOTE,
	myc_add_note_comment: ClineDefaultTool.MYC_ADD_NOTE_COMMENT,
	myc_update_plan: ClineDefaultTool.MYC_UPDATE_PLAN,
	myc_update_exit_criteria: ClineDefaultTool.MYC_UPDATE_EXIT_CRITERIA,
	myc_update_acceptance_criteria: ClineDefaultTool.MYC_UPDATE_ACCEPTANCE_CRITERIA,
	myc_create_handoff: ClineDefaultTool.MYC_CREATE_HANDOFF,
}

export function createMyceliumHandlers(): IToolHandler[] {
	return Object.entries(RUNS).map(([name, run]) => new MyceliumToolHandler(BY_NAME[name], run))
}

type MyceliumTool =
	| ClineDefaultTool.MYC_SET_STAGE
	| ClineDefaultTool.MYC_UPDATE_TASK_SPEC
	| ClineDefaultTool.MYC_ADD_CODE_REF
	| ClineDefaultTool.MYC_ADD_NOTE
	| ClineDefaultTool.MYC_ADD_NOTE_COMMENT
	| ClineDefaultTool.MYC_UPDATE_PLAN
	| ClineDefaultTool.MYC_UPDATE_EXIT_CRITERIA
	| ClineDefaultTool.MYC_UPDATE_ACCEPTANCE_CRITERIA
	| ClineDefaultTool.MYC_CREATE_HANDOFF

/** Factories for ToolExecutorCoordinator's handler map (one entry per myc_* tool). */
export const MYCELIUM_HANDLER_FACTORIES = Object.fromEntries(
	Object.entries(BY_NAME).map(([name, id]) => [id, () => new MyceliumToolHandler(id, RUNS[name])]),
) as unknown as Record<MyceliumTool, () => IToolHandler>
