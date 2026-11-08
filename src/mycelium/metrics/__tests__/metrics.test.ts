import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import type { LlmResult } from "../../llm/LlmCaller"
import type { CheckRun } from "../../store/schema"
import { TaskContextStore } from "../../store/TaskContextStore"
import { aggregateWorkspace, renderSummaryHtml } from "../aggregate"
import { addCheckRun, addToolTime, allCallsView, finishTask, profileView, recordCall } from "../metrics"

const res = (input: number, output: number, ms: number, cost?: number): LlmResult => ({
	text: "",
	usage: { input, output, cacheRead: 0, cacheWrite: 0, costUsd: cost },
	durationMs: ms,
})
const check = (code: number): CheckRun => ({
	started_at: "2026-11-08T10:00:00Z",
	duration_ms: 1000,
	exit_code: code,
	status: code === 0 ? "passed" : "failed",
	log_path: "/w/.mycelium/check_runs/a.log",
	source: "extension",
	command: "bash check_all.sh",
})

describe("metrics", () => {
	let cwd: string
	let store: TaskContextStore
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-metrics-"))
		store = new TaskContextStore(cwd)
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	it("counted=false lands in uncounted_in_profile_view and not in profileView", async () => {
		let ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		ctx = recordCall(ctx, { type: "agent", stage: "clarification", result: res(100, 10, 500, 0.01), counted: true })
		ctx = recordCall(ctx, { type: "migration", stage: "clarification", result: res(50, 5, 200, 0.005), counted: false })
		profileView(ctx.metrics).count.should.equal(1)
		profileView(ctx.metrics).tokens_in.should.equal(100)
		allCallsView(ctx.metrics).count.should.equal(2)
		allCallsView(ctx.metrics).model_ms.should.equal(700)
		ctx.metrics.uncounted_in_profile_view.migration.count.should.equal(1)
	})

	it("by_stage attributes calls to the stage at call time", async () => {
		let ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		ctx = recordCall(ctx, { type: "agent", stage: "clarification", result: res(1, 1, 1), counted: true })
		ctx = recordCall(ctx, { type: "agent", stage: "development", result: res(2, 2, 2), counted: true })
		ctx = recordCall(ctx, { type: "update_cycle", stage: "development", result: res(3, 3, 3), counted: true })
		ctx.metrics.by_stage.clarification.count.should.equal(1)
		ctx.metrics.by_stage.development.count.should.equal(2)
		ctx.metrics.by_type.agent.count.should.equal(2)
	})

	it("aggregate sums tasks and reports both views", async () => {
		for (const counted of [true, false]) {
			const c = await store.create({ clineTaskId: `c${counted}`, mode: "developer", profile: "tao" })
			await store.update(c.task_id, (x) => {
				let y = recordCall(x, { type: "agent", stage: "development", result: res(10, 1, 100, 0.1), counted: true })
				y = recordCall(y, { type: "repair", stage: "development", result: res(5, 1, 50, 0.05), counted })
				y = addToolTime(y, 30)
				y = addCheckRun(y, check(counted ? 0 : 1))
				return finishTask(y, new Date(Date.parse(y.metrics.started_at) + 60000).toISOString())
			})
		}
		const s = await aggregateWorkspace(cwd)
		s.tasks.length.should.equal(2)
		s.totals.all_calls.count.should.equal(4)
		s.totals.profile_view.count.should.equal(3)
		s.totals.wall_ms.should.equal(120000)
		s.totals.tool_ms.should.equal(60)
		s.check_runs.total.should.equal(2)
		s.check_runs.passed.should.equal(1)
	})

	it("summary HTML lists check runs with real exit codes", async () => {
		const c = await store.create({ clineTaskId: "c", mode: "developer", profile: "improved" })
		await store.update(c.task_id, (x) => addCheckRun(addCheckRun(x, check(0)), check(2)))
		const html = renderSummaryHtml(await aggregateWorkspace(cwd))
		html.should.containEql("<table")
		html.should.containEql(">2<")
		html.should.containEql("improved")
		html.should.not.containEql("<script")
	})
})
