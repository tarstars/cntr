import { PIPELINES, STAGES, type StageId } from "../modes/pipelines"
import type { Profile } from "../profile"
import type { AcStatus, CheckRun, TaskContext } from "../store/schema"
import { autoPlanFor, criteriaFor } from "../store/TaskContextStore"

export type Evidence = { refs?: string[]; notes?: string[]; changes?: string[] } | string[]

export interface TransitionRequest {
	/** Omitted: the next stage of the pipeline. */
	to?: StageId
	reason: string
	evidence: Evidence
	/** Required (improved) to move to an earlier stage. */
	back?: boolean
}

export interface GateDeps {
	runCheckAll(): Promise<CheckRun>
	askOwner(question: string): Promise<boolean>
}

export type GateResult = { ok: true; to: StageId; checkRun?: CheckRun } | { ok: false; error: string }

/** Stages a verdict on every acceptance criterion is required to leave (docs/tao-behaviour.md §6). */
const VERDICT_STAGES: ReadonlySet<StageId> = new Set(["audit", "debug_validation"])

const fail = (error: string): GateResult => ({ ok: false, error })

export function evidenceIds(evidence: Evidence): string[] {
	return Array.isArray(evidence) ? evidence : [...(evidence.refs ?? []), ...(evidence.notes ?? []), ...(evidence.changes ?? [])]
}

/** Latest status (and comment) per acceptance-criterion index; later rounds win. */
export function latestAcStatuses(ctx: TaskContext): Map<number, { status: AcStatus; comment?: string }> {
	const latest = new Map<number, { status: AcStatus; comment?: string }>()
	for (const round of ctx.ac_rounds) {
		for (const item of round.items) {
			latest.set(item.index, { status: item.status, comment: item.comment })
		}
	}
	return latest
}

function nextStage(ctx: TaskContext): StageId | undefined {
	if (ctx.stage === "rework") {
		return "audit"
	}
	const pipeline = PIPELINES[ctx.mode]
	return pipeline[pipeline.indexOf(ctx.stage) + 1]
}

function missingEvidence(ctx: TaskContext, evidence: Evidence, profile: Profile): string[] {
	if (Array.isArray(evidence) && !profile.stages.evidenceAlwaysValidated) {
		return []
	}
	const known = new Set([...ctx.refs.map((r) => r.id), ...ctx.notes.map((n) => n.id), ...ctx.changes.map((c) => c.id)])
	return evidenceIds(evidence).filter((id) => !known.has(id))
}

/**
 * Decide whether the task may move to `req.to`. Checks, in order: mode and target validity, reason and
 * evidence, ordering (improved: no silent skipping), check_all (improved: run by the extension), exit
 * criteria, acceptance-criteria verdicts, and (improved) the owner's approval to leave audit.
 */
export async function validateTransition(
	ctx: TaskContext,
	req: TransitionRequest,
	profile: Profile,
	deps: GateDeps,
): Promise<GateResult> {
	if (ctx.mode === "free") {
		return fail("Stage changes are not available in Free mode.")
	}
	const pipeline = PIPELINES[ctx.mode]
	const to = req.to ?? nextStage(ctx)
	if (!to) {
		return fail(`Already at the last stage ('${ctx.stage}'); finish with attempt_completion.`)
	}
	const isRework = to === "rework"
	if (isRework && !(ctx.mode === "developer" && ctx.stage === "audit")) {
		return fail("'rework' can only be entered from 'audit' in developer mode.")
	}
	if (!isRework && !pipeline.includes(to)) {
		return fail(`Invalid to_stage '${to}'. Valid stages for ${ctx.mode} mode: ${pipeline.join(", ")}.`)
	}
	if (to === ctx.stage) {
		return fail(`The task is already in stage '${to}'.`)
	}
	if (!req.reason?.trim()) {
		return fail("A reason is required for a stage change.")
	}
	if (req.evidence === undefined || req.evidence === null) {
		return fail("Evidence is required: ids of code references, notes or changes that show the stage's criteria are met.")
	}
	const missing = missingEvidence(ctx, req.evidence, profile)
	if (missing.length) {
		return fail(`Evidence validation failed: these ids are not in memory: ${missing.join(", ")}.`)
	}

	if (!profile.stages.allowSkip && !isRework) {
		const from = ctx.stage === "rework" ? pipeline.indexOf("audit") : pipeline.indexOf(ctx.stage)
		const target = pipeline.indexOf(to)
		if (target < from && !req.back) {
			return fail(`'${to}' is an earlier stage. To go back, call myc_set_stage again with back=true and a reason.`)
		}
		if (target > from + 1 && !(await deps.askOwner(`Skip from '${ctx.stage}' to '${to}'? Reason: ${req.reason}`))) {
			return fail(`The owner did not approve skipping from '${ctx.stage}' to '${to}'.`)
		}
	}

	const criteria = { ...ctx.exit_criteria }
	const required = STAGES[ctx.stage].exitCriteria
	let checkRun: CheckRun | undefined
	if (profile.stages.checkAllVerifiedByExtension && "check_all_passed" in required && !isRework) {
		checkRun = await deps.runCheckAll()
		if (checkRun.status !== "passed") {
			return fail(
				`check_all.sh did not pass (${checkRun.status}${checkRun.exit_code === null ? "" : `, exit code ${checkRun.exit_code}`}). Log: ${checkRun.log_path ?? "none"}. Fix the failures and try again.`,
			)
		}
		criteria.check_all_passed = true
	}

	const exempt = (key: string) =>
		isRework &&
		(key.endsWith("_reviewed") ||
			key === "check_all_passed" ||
			(!profile.stages.checkAllVerifiedByExtension && key === "ac_statuses_updated"))
	const blocking =
		profile.stages.gate === "no_false"
			? Object.entries(criteria)
					.filter(([k, v]) => v === false && !exempt(k))
					.map(([k]) => k)
			: Object.keys(required).filter((k) => criteria[k] !== true && !exempt(k))
	if (blocking.length) {
		return fail(
			`Cannot transition from '${ctx.stage}' to '${to}': ${blocking.length} exit criteria not satisfied: ${blocking.join(", ")}. Set them with myc_update_exit_criteria once they are true.`,
		)
	}

	const acs = ctx.task.acceptance_criteria
	const statuses = latestAcStatuses(ctx)
	if (VERDICT_STAGES.has(ctx.stage)) {
		const unjudged = acs
			.map((_, i) => i)
			.filter((i) => !statuses.get(i) || statuses.get(i)!.status === "pending" || !statuses.get(i)!.comment?.trim())
		if (unjudged.length) {
			return fail(
				`Every acceptance criterion needs a verdict with a comment before leaving '${ctx.stage}'. Missing: ${unjudged.map((i) => `#${i}`).join(", ")}.`,
			)
		}
	}
	if (to === "report") {
		const notPassing = acs.map((_, i) => i).filter((i) => statuses.get(i)?.status !== "pass")
		if (notPassing.length) {
			return fail(
				`Every acceptance criterion must pass before 'report'. Not passing: ${notPassing.map((i) => `#${i}`).join(", ")}.`,
			)
		}
	}

	if (profile.stages.leaveAuditAsksOwner && ctx.stage === "audit") {
		if (!(await deps.askOwner(`The audit is complete. Move from 'audit' to '${to}'? Reason: ${req.reason}`))) {
			return fail(`The owner did not approve leaving the audit for '${to}'.`)
		}
	}
	return { ok: true, to, checkRun }
}

/** Pure: the context after moving to `to` (history entry, fresh criteria and auto-plan for the target). */
export function applyTransition(
	ctx: TaskContext,
	to: StageId,
	req: TransitionRequest,
	actor: "agent" | "owner" | "extension",
): TaskContext {
	const next: TaskContext = structuredClone(ctx)
	next.stage_history.push({
		from: ctx.stage,
		to,
		at: new Date().toISOString(),
		reason: req.reason,
		evidence_ids: evidenceIds(req.evidence ?? []),
		actor,
	})
	next.stage = to
	next.exit_criteria = criteriaFor(to)
	next.task.plan = autoPlanFor(to)
	return next
}
