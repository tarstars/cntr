import { randomBytes } from "node:crypto"
import type { LlmCaller, LlmResult } from "../llm/LlmCaller"
import type { Profile } from "../profile"
import { REPAIR_SYSTEM_PROMPT } from "../prompts/repairPrompt"
import { appendAudit } from "../store/audit"
import type { PlanItem, TaskContext } from "../store/schema"
import type { TaskContextStore } from "../store/TaskContextStore"

export type PlanProblem =
	| "empty_plan"
	| "all_done"
	| "no_in_progress"
	| "multiple_in_progress"
	| "empty_spec"
	| "empty_acceptance"
	| "empty_constraints"

/** Stages where the spec, criteria and constraints are still being written. */
const WRITING_SPEC_STAGES = new Set(["clarification", "architecture_discussion"])
const STATUSES = new Set(["todo", "next", "in_progress", "done"])

export function detectPlanProblems(ctx: TaskContext): PlanProblem[] {
	const out: PlanProblem[] = []
	const plan = ctx.task.plan
	const inProgress = plan.filter((p) => p.status === "in_progress").length
	if (plan.length === 0) out.push("empty_plan")
	else if (plan.every((p) => p.status === "done")) out.push("all_done")
	else if (inProgress === 0) out.push("no_in_progress")
	if (inProgress > 1) out.push("multiple_in_progress")
	if (!WRITING_SPEC_STAGES.has(ctx.stage)) {
		if (!ctx.task.spec.trim()) out.push("empty_spec")
		if (ctx.task.acceptance_criteria.length === 0) out.push("empty_acceptance")
		if (ctx.task.constraints.length === 0) out.push("empty_constraints")
	}
	return out
}

interface RepairReply {
	add_plan_items?: { text: string; status?: string }[]
	update_plan_items?: { id: string; status: string }[]
	spec?: string
	acceptance_criteria?: string[]
	constraints?: string[]
}

function parseReply(text: string): RepairReply | undefined {
	try {
		const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
		return JSON.parse(fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))
	} catch {
		return undefined
	}
}

/**
 * Run the repair planner when a plan problem has persisted for 2 turns. The first detection only
 * records `pending_since_turn`; a later turn without problems clears it.
 */
export async function runRepairIfDue(deps: {
	store: TaskContextStore
	taskId: string
	caller: LlmCaller
	profile: Profile
	turn: number
}): Promise<{ ran: boolean; applied: boolean; result?: LlmResult; error?: string }> {
	const { store, taskId, caller, turn } = deps
	const ctx = await store.load(taskId)
	const problems = detectPlanProblems(ctx)
	const pendingSince = ctx.repair.pending_since_turn
	if (problems.length === 0 || pendingSince === undefined) {
		if (problems.length === 0 && pendingSince !== undefined)
			await store.update(taskId, (c) => {
				c.repair = {}
			})
		if (problems.length > 0)
			await store.update(taskId, (c) => {
				c.repair.pending_since_turn = turn
			})
		return { ran: false, applied: false }
	}
	if (turn - pendingSince < 2) return { ran: false, applied: false }

	const input = JSON.stringify({
		problems,
		stage: ctx.stage,
		spec: ctx.task.spec,
		acceptance_criteria: ctx.task.acceptance_criteria,
		constraints: ctx.task.constraints,
		plan: ctx.task.plan,
	})
	let result: LlmResult
	try {
		result = await caller.call(REPAIR_SYSTEM_PROMPT, input)
	} catch (error) {
		await store.update(taskId, (c) => {
			c.repair.pending_since_turn = turn
		})
		return { ran: true, applied: false, error: `repair call failed: ${error instanceof Error ? error.message : error}` }
	}
	const reply = parseReply(result.text)
	if (!reply) {
		await store.update(taskId, (c) => {
			c.repair.pending_since_turn = turn
		})
		return { ran: true, applied: false, result, error: "repair planner reply is not JSON" }
	}
	let changed = false
	await store.update(taskId, (c) => {
		for (const item of reply.add_plan_items ?? []) {
			if (typeof item?.text !== "string") continue
			const status = (STATUSES.has(item.status ?? "") ? item.status : "todo") as PlanItem["status"]
			c.task.plan.push({ id: `rp_${randomBytes(3).toString("hex")}`, text: item.text, status })
			changed = true
		}
		for (const u of reply.update_plan_items ?? []) {
			const p = c.task.plan.find((x) => x.id === u?.id)
			if (p && STATUSES.has(u.status)) {
				p.status = u.status as PlanItem["status"]
				changed = true
			}
		}
		if (!c.task.spec.trim() && typeof reply.spec === "string" && reply.spec.trim()) {
			c.task.spec = reply.spec
			changed = true
		}
		if (
			c.task.acceptance_criteria.length === 0 &&
			Array.isArray(reply.acceptance_criteria) &&
			reply.acceptance_criteria.length
		) {
			c.task.acceptance_criteria = reply.acceptance_criteria.filter((x) => typeof x === "string")
			changed = true
		}
		if (c.task.constraints.length === 0 && Array.isArray(reply.constraints) && reply.constraints.length) {
			c.task.constraints = reply.constraints.filter((x) => typeof x === "string")
			changed = true
		}
		c.repair = {}
	})
	await appendAudit(store.cwd, taskId, "repair_planner_applied", { problems, changed })
	return { ran: true, applied: changed, result }
}
