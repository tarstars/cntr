import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import type { LlmCaller } from "../../llm/LlmCaller"
import { handoffsDir } from "../../paths"
import { IMPROVED_PROFILE, TAO_PROFILE } from "../../profile"
import type { TaskContext } from "../../store/schema"
import { TaskContextStore } from "../../store/TaskContextStore"
import { runMigrationIfNeeded } from "../migration"
import { detectPlanProblems, runRepairIfDue } from "../repairPlanner"

const caller = (text: string, calls: string[] = []): LlmCaller => ({
	async call(_s, u) {
		calls.push(u)
		return { text, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, durationMs: 1 }
	},
})

describe("repair planner", () => {
	let cwd: string
	let store: TaskContextStore
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-repair-"))
		store = new TaskContextStore(cwd)
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	const devCtx = async (patch: (c: TaskContext) => void) => {
		const c = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		return store.update(c.task_id, (x) => {
			x.stage = "development"
			x.task.spec = "s"
			x.task.acceptance_criteria = ["a"]
			x.task.constraints = ["k"]
			x.task.plan = [{ id: "p1", text: "do", status: "in_progress" }]
			patch(x)
		})
	}

	it("detects each plan problem", async () => {
		;(await devCtx(() => {})).should.have.property("task")
		detectPlanProblems(await devCtx(() => {})).should.eql([])
		detectPlanProblems(
			await devCtx((x) => {
				x.task.plan = []
			}),
		).should.containEql("empty_plan")
		detectPlanProblems(
			await devCtx((x) => {
				x.task.plan[0].status = "done"
			}),
		).should.containEql("all_done")
		detectPlanProblems(
			await devCtx((x) => {
				x.task.plan[0].status = "todo"
			}),
		).should.containEql("no_in_progress")
		detectPlanProblems(
			await devCtx((x) => {
				x.task.plan.push({ id: "p2", text: "b", status: "in_progress" })
			}),
		).should.containEql("multiple_in_progress")
		detectPlanProblems(
			await devCtx((x) => {
				x.task.spec = ""
			}),
		).should.containEql("empty_spec")
		detectPlanProblems(
			await devCtx((x) => {
				x.task.acceptance_criteria = []
			}),
		).should.containEql("empty_acceptance")
		detectPlanProblems(
			await devCtx((x) => {
				x.task.constraints = []
			}),
		).should.containEql("empty_constraints")
	})

	it("does not flag empty spec fields during clarification, where they are being written", async () => {
		const c = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		detectPlanProblems(c).should.not.containEql("empty_spec")
	})

	it("repair waits 2 turns", async () => {
		const c = await devCtx((x) => {
			x.task.plan = []
		})
		const calls: string[] = []
		const fix = JSON.stringify({ add_plan_items: [{ text: "write code", status: "in_progress" }] })
		;(
			await runRepairIfDue({ store, taskId: c.task_id, caller: caller(fix, calls), profile: TAO_PROFILE, turn: 10 })
		).ran.should.be.false()
		;(
			await runRepairIfDue({ store, taskId: c.task_id, caller: caller(fix, calls), profile: TAO_PROFILE, turn: 11 })
		).ran.should.be.false()
		calls.length.should.equal(0)
		const r = await runRepairIfDue({ store, taskId: c.task_id, caller: caller(fix, calls), profile: TAO_PROFILE, turn: 12 })
		r.ran.should.be.true()
		r.applied.should.be.true()
	})

	it("repair applies plan/spec changes from JSON", async () => {
		const c = await devCtx((x) => {
			x.task.plan = []
			x.task.spec = ""
		})
		const fix = JSON.stringify({
			add_plan_items: [{ text: "write code", status: "in_progress" }],
			spec: "Build the page",
			acceptance_criteria: ["ignored: not empty"],
		})
		await runRepairIfDue({ store, taskId: c.task_id, caller: caller(fix), profile: TAO_PROFILE, turn: 1 })
		await runRepairIfDue({ store, taskId: c.task_id, caller: caller(fix), profile: TAO_PROFILE, turn: 3 })
		const after = await store.load(c.task_id)
		after.task.plan.map((p) => p.text).should.eql(["write code"])
		after.task.spec.should.equal("Build the page")
		after.task.acceptance_criteria.should.eql(["a"])
		;(after.repair.pending_since_turn === undefined).should.be.true()
	})
})

describe("knowledge migration", () => {
	let cwd: string
	let store: TaskContextStore
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-migr-"))
		store = new TaskContextStore(cwd)
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	async function chain() {
		const prev = await store.create({ clineTaskId: "c1", mode: "architect", profile: "tao" })
		await store.update(prev.task_id, (x) => {
			x.refs.push({
				id: "r1",
				path: "ARCHITECTURE.md",
				start_line: 1,
				end_line: 9,
				sha256: "h",
				why: "stack",
				at_turn: 3,
				stale: false,
				resolved: false,
			})
			x.notes.push({
				id: "n1",
				text: "Astro static site",
				tags: ["decision"],
				at_turn: 4,
				hidden: false,
				resolved: false,
				comments: [],
			})
		})
		const next = await store.create({ clineTaskId: "c2", mode: "developer", profile: "tao", previousTaskId: prev.task_id })
		return { prev, next }
	}

	it("copies selected refs and notes and marks ingested_at; runs once", async () => {
		const { next } = await chain()
		const reply = JSON.stringify({
			add_refs: [{ path: "ARCHITECTURE.md", start_line: 1, end_line: 9, why: "stack for phase 1" }],
			add_notes: [{ text: "Astro static site", tags: ["decision"] }],
			task_summary: "architecture agreed",
		})
		const calls: string[] = []
		const r = await runMigrationIfNeeded({
			store,
			taskId: next.task_id,
			caller: caller(reply, calls),
			profile: TAO_PROFILE,
			lastUserMessages: ["Выполняем Этап 1"],
		})
		r.ran.should.be.true()
		calls[0].should.containEql("Выполняем Этап 1")
		const after = await store.load(next.task_id)
		after.refs.map((x) => x.path).should.eql(["ARCHITECTURE.md"])
		after.notes.map((x) => x.text).should.eql(["Astro static site"])
		after.migration.ingested_at!.should.be.a.String()
		;(
			await runMigrationIfNeeded({
				store,
				taskId: next.task_id,
				caller: caller(reply, calls),
				profile: TAO_PROFILE,
				lastUserMessages: [],
			})
		).ran.should.be.false()
		calls.length.should.equal(1)
	})

	it("uses the newest unconsumed handoff file when there is no previous task", async () => {
		const t = await store.create({ clineTaskId: "c3", mode: "developer", profile: "tao" })
		await fs.mkdir(handoffsDir(cwd), { recursive: true })
		await fs.writeFile(
			path.join(handoffsDir(cwd), "t_arch.json"),
			JSON.stringify({
				task_id: "t_arch",
				spec: "site",
				refs: [],
				notes: [{ id: "n9", text: "use Tailwind", tags: ["decision"] }],
			}),
		)
		const calls: string[] = []
		await runMigrationIfNeeded({
			store,
			taskId: t.task_id,
			caller: caller('{"add_notes":[{"text":"use Tailwind","tags":["decision"]}]}', calls),
			profile: TAO_PROFILE,
			lastUserMessages: [],
		})
		calls[0].should.containEql("use Tailwind")
		JSON.parse(await fs.readFile(path.join(handoffsDir(cwd), "t_arch.json"), "utf8")).consumed_by.should.equal(t.task_id)
	})

	it("malformed migration JSON still marks ingested, but in improved it also returns error for the UI", async () => {
		const a = await chain()
		const tao = await runMigrationIfNeeded({
			store,
			taskId: a.next.task_id,
			caller: caller("nope"),
			profile: TAO_PROFILE,
			lastUserMessages: [],
		})
		;(tao.error === undefined).should.be.true()
		;(await store.load(a.next.task_id)).migration.ingested_at!.should.be.a.String()
		const b = await chain()
		const imp = await runMigrationIfNeeded({
			store,
			taskId: b.next.task_id,
			caller: caller("nope"),
			profile: IMPROVED_PROFILE,
			lastUserMessages: [],
		})
		imp.error!.should.be.a.String()
	})
})
