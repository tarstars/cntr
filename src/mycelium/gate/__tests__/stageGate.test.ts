import { describe, it } from "mocha"
import "should"
import type { ModeId, StageId } from "../../modes/pipelines"
import { IMPROVED_PROFILE, TAO_PROFILE } from "../../profile"
import type { CheckRun, TaskContext } from "../../store/schema"
import { emptyMetrics } from "../../store/schema"
import { autoPlanFor, criteriaFor } from "../../store/TaskContextStore"
import { applyTransition, type GateDeps, type TransitionRequest, validateTransition } from "../stageGate"

function ctxAt(mode: ModeId, stage: StageId, patch: Partial<TaskContext> = {}): TaskContext {
	const at = new Date().toISOString()
	return {
		schema_version: 1,
		task_id: "t_1",
		cline_task_id: "c_1",
		profile: "tao",
		mode,
		stage,
		status: "active",
		created_at: at,
		updated_at: at,
		stage_history: [],
		exit_criteria: criteriaFor(stage),
		task: { spec: "s", acceptance_criteria: ["works"], constraints: [], plan: autoPlanFor(stage) },
		ac_rounds: [],
		refs: [
			{
				id: "r1",
				path: "a.ts",
				start_line: 1,
				end_line: 2,
				sha256: "x",
				why: "y",
				at_turn: 0,
				stale: false,
				resolved: false,
			},
		],
		notes: [],
		changes: [],
		user_notes: [],
		execution_log: [],
		update_cycle: { processed_until: 0, turn_counter: 0, pending_force: false },
		repair: {},
		migration: {},
		metrics: emptyMetrics(at),
		...patch,
	}
}
const allTrue = (stage: StageId) => Object.fromEntries(Object.keys(criteriaFor(stage)).map((k) => [k, true]))
const run = (status: CheckRun["status"]): CheckRun => ({
	started_at: "now",
	duration_ms: 1,
	exit_code: status === "passed" ? 0 : 1,
	status,
	log_path: "/w/.mycelium/check_runs/x.log",
	source: "extension",
	command: "bash check_all.sh",
})
function deps(opts: { owner?: boolean; check?: CheckRun["status"] } = {}) {
	const calls = { ask: [] as string[], check: 0 }
	const d: GateDeps = {
		askOwner: async (q) => {
			calls.ask.push(q)
			return opts.owner ?? true
		},
		runCheckAll: async () => {
			calls.check++
			return run(opts.check ?? "passed")
		},
	}
	return { d, calls }
}
const req = (to: StageId | undefined, extra: Partial<TransitionRequest> = {}): TransitionRequest => ({
	to,
	reason: "done",
	evidence: { refs: ["r1"] },
	...extra,
})
const passAc = { ac_rounds: [{ at: "t", items: [{ index: 0, status: "pass" as const, comment: "ok" }] }] }

describe("stage gate", () => {
	for (const p of [TAO_PROFILE, IMPROVED_PROFILE]) {
		it(`requires reason and evidence (${p.id})`, async () => {
			const ctx = ctxAt("developer", "clarification", { exit_criteria: allTrue("clarification") })
			;(await validateTransition(ctx, req("data_collection", { reason: " " }), p, deps().d)).ok.should.be.false()
			;(
				await validateTransition(ctx, req("data_collection", { evidence: undefined as never }), p, deps().d)
			).ok.should.be.false()
		})

		it(`leaving audit requires a verdict with a comment for every AC (${p.id})`, async () => {
			const ctx = ctxAt("developer", "audit", { exit_criteria: allTrue("audit") })
			const r = await validateTransition(ctx, req("report"), p, deps().d)
			r.ok.should.be.false()
			;(r as { error: string }).error.should.match(/acceptance criteri/i)
		})

		it(`entering report requires every AC = pass (${p.id})`, async () => {
			const failing = { ac_rounds: [{ at: "t", items: [{ index: 0, status: "fail" as const, comment: "broken" }] }] }
			const ctx = ctxAt("developer", "audit", { exit_criteria: allTrue("audit"), ...failing })
			;(await validateTransition(ctx, req("report"), p, deps().d)).ok.should.be.false()
			const ok = ctxAt("developer", "audit", { exit_criteria: allTrue("audit"), ...passAc })
			;(await validateTransition(ok, req("report"), p, deps().d)).ok.should.be.true()
		})

		it(`rework is a valid target only from audit in developer mode (${p.id})`, async () => {
			const dev = ctxAt("developer", "development", { exit_criteria: allTrue("development") })
			;(await validateTransition(dev, req("rework"), p, deps().d)).ok.should.be.false()
			const audit = ctxAt("developer", "audit", {
				...passAc,
				exit_criteria: {
					...criteriaFor("audit"),
					audit_completed: true,
					rework_plan_recorded_if_needed: true,
					ac_statuses_updated: true,
				},
			})
			;(await validateTransition(audit, req("rework"), p, deps().d)).ok.should.be.true()
		})

		it(`free mode rejects transitions (${p.id})`, async () => {
			;(await validateTransition(ctxAt("free", "execution"), req("execution"), p, deps().d)).ok.should.be.false()
		})
	}

	it("tao: allows skipping to any pipeline stage", async () => {
		const ctx = ctxAt("developer", "clarification", { exit_criteria: allTrue("clarification") })
		;(await validateTransition(ctx, req("development"), TAO_PROFILE, deps().d)).ok.should.be.true()
	})

	it("improved: skipping forward asks the owner and fails if refused", async () => {
		const ctx = ctxAt("developer", "clarification", { exit_criteria: allTrue("clarification") })
		const refused = deps({ owner: false })
		;(await validateTransition(ctx, req("development"), IMPROVED_PROFILE, refused.d)).ok.should.be.false()
		refused.calls.ask.length.should.equal(1)
		;(await validateTransition(ctx, req("development"), IMPROVED_PROFILE, deps({ owner: true }).d)).ok.should.be.true()
	})

	it("improved: back requires back=true and a reason", async () => {
		const ctx = ctxAt("developer", "development", { exit_criteria: allTrue("development") })
		;(await validateTransition(ctx, req("clarification"), IMPROVED_PROFILE, deps().d)).ok.should.be.false()
		;(await validateTransition(ctx, req("clarification", { back: true }), IMPROVED_PROFILE, deps().d)).ok.should.be.true()
	})

	it("tao: blocks only on criteria explicitly false; missing keys pass", async () => {
		const missing = ctxAt("developer", "clarification", { exit_criteria: {} })
		;(await validateTransition(missing, req("data_collection"), TAO_PROFILE, deps().d)).ok.should.be.true()
		const oneFalse = ctxAt("developer", "clarification", {
			exit_criteria: { ...allTrue("clarification"), scope_confirmed: false },
		})
		const r = await validateTransition(oneFalse, req("data_collection"), TAO_PROFILE, deps().d)
		r.ok.should.be.false()
		;(r as { error: string }).error.should.containEql("scope_confirmed")
	})

	it("improved: every criterion must be true", async () => {
		const missing = ctxAt("developer", "clarification", { exit_criteria: {} })
		;(await validateTransition(missing, req("data_collection"), IMPROVED_PROFILE, deps().d)).ok.should.be.false()
	})

	it("tao: array evidence is not validated; object evidence ids must exist", async () => {
		const ctx = ctxAt("developer", "clarification", { exit_criteria: allTrue("clarification") })
		;(
			await validateTransition(ctx, req("data_collection", { evidence: ["nope"] }), TAO_PROFILE, deps().d)
		).ok.should.be.true()
		;(
			await validateTransition(ctx, req("data_collection", { evidence: { refs: ["nope"] } }), TAO_PROFILE, deps().d)
		).ok.should.be.false()
	})

	it("improved: unknown ids fail in both forms", async () => {
		const ctx = ctxAt("developer", "clarification", { exit_criteria: allTrue("clarification") })
		;(
			await validateTransition(ctx, req("data_collection", { evidence: ["nope"] }), IMPROVED_PROFILE, deps().d)
		).ok.should.be.false()
		;(
			await validateTransition(ctx, req("data_collection", { evidence: ["r1"] }), IMPROVED_PROFILE, deps().d)
		).ok.should.be.true()
	})

	it("improved: check_all_passed is set by running check_all, and a failed run blocks with the log path in the error", async () => {
		const crit = { ...allTrue("development"), check_all_passed: false }
		const ok = deps({ check: "passed" })
		const r = await validateTransition(
			ctxAt("developer", "development", { exit_criteria: crit }),
			req("audit"),
			IMPROVED_PROFILE,
			ok.d,
		)
		r.ok.should.be.true()
		ok.calls.check.should.equal(1)
		;(r as { checkRun?: CheckRun }).checkRun!.status.should.equal("passed")
		const bad = await validateTransition(
			ctxAt("developer", "development", { exit_criteria: crit }),
			req("audit"),
			IMPROVED_PROFILE,
			deps({ check: "failed" }).d,
		)
		bad.ok.should.be.false()
		;(bad as { error: string }).error.should.containEql("/w/.mycelium/check_runs/x.log")
	})

	it("tao: runCheckAll is never called", async () => {
		const d = deps()
		await validateTransition(
			ctxAt("developer", "development", { exit_criteria: allTrue("development") }),
			req("audit"),
			TAO_PROFILE,
			d.d,
		)
		d.calls.check.should.equal(0)
	})

	it("improved: leaving audit asks the owner; tao never asks", async () => {
		const ctx = ctxAt("developer", "audit", { exit_criteria: allTrue("audit"), ...passAc })
		const imp = deps({ owner: false })
		;(await validateTransition(ctx, req("report"), IMPROVED_PROFILE, imp.d)).ok.should.be.false()
		imp.calls.ask.length.should.be.above(0)
		const tao = deps({ owner: false })
		;(await validateTransition(ctx, req("report"), TAO_PROFILE, tao.d)).ok.should.be.true()
		tao.calls.ask.length.should.equal(0)
	})

	it("applyTransition resets target criteria and records history", () => {
		const ctx = ctxAt("developer", "clarification", { exit_criteria: allTrue("clarification") })
		const next = applyTransition(ctx, "data_collection", req("data_collection"), "agent")
		next.stage.should.equal("data_collection")
		Object.values(next.exit_criteria)
			.every((v) => v === false)
			.should.be.true()
		next.task.plan.map((p) => p.id)[0].should.equal("auto_data_collection_1")
		next.stage_history.should.have.length(1)
		next.stage_history[0].should.containDeep({
			from: "clarification",
			to: "data_collection",
			reason: "done",
			evidence_ids: ["r1"],
			actor: "agent",
		})
		ctx.stage.should.equal("clarification")
	})
})
