import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { TaskContextStore } from "../../store/TaskContextStore"
import { handleCockpitMessage } from "../messages"

describe("cockpit messages", () => {
	let cwd: string
	let store: TaskContextStore
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-cockpit-"))
		store = new TaskContextStore(cwd)
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	it("cockpit edits persist to the store and return the new state", async () => {
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		const s1 = await handleCockpitMessage(store, ctx.task_id, { type: "editSpec", spec: "Build the species page" })
		s1.ctx!.task.spec.should.equal("Build the species page")
		await handleCockpitMessage(store, ctx.task_id, { type: "editAcceptance", items: ["renders", "has photos"] })
		await handleCockpitMessage(store, ctx.task_id, { type: "editConstraints", items: ["Astro"] })
		await handleCockpitMessage(store, ctx.task_id, {
			type: "editPlan",
			items: [{ text: "write page", status: "in_progress" }],
		})
		const s2 = await handleCockpitMessage(store, ctx.task_id, {
			type: "toggleExitCriterion",
			key: "scope_confirmed",
			value: true,
		})
		const saved = await store.load(ctx.task_id)
		saved.task.acceptance_criteria.should.eql(["renders", "has photos"])
		saved.task.constraints.should.eql(["Astro"])
		saved.task.plan[0].text.should.equal("write page")
		saved.exit_criteria.scope_confirmed.should.be.true()
		s2.ctx!.exit_criteria.scope_confirmed.should.be.true()
	})

	it("improved cockpit refuses to toggle check_all_passed", async () => {
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "improved" })
		await store.update(ctx.task_id, (c) => {
			c.stage = "development"
			c.exit_criteria = { check_all_passed: false }
		})
		const s = await handleCockpitMessage(store, ctx.task_id, {
			type: "toggleExitCriterion",
			key: "check_all_passed",
			value: true,
		})
		s.error!.should.match(/check_all/)
		;(await store.load(ctx.task_id)).exit_criteria.check_all_passed.should.be.false()
	})

	it("rollback restores a snapshot", async () => {
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		await handleCockpitMessage(store, ctx.task_id, { type: "editSpec", spec: "v1" })
		const snap = await handleCockpitMessage(store, ctx.task_id, { type: "snapshot" })
		snap.snapshots.length.should.equal(1)
		await handleCockpitMessage(store, ctx.task_id, { type: "editSpec", spec: "v2" })
		const back = await handleCockpitMessage(store, ctx.task_id, { type: "rollback", snapshotId: snap.snapshots[0] })
		back.ctx!.task.spec.should.equal("v1")
	})

	it("load returns the task list for the picker, newest first", async () => {
		const a = await store.create({ clineTaskId: "a", mode: "developer", profile: "tao" })
		await new Promise((r) => setTimeout(r, 1100))
		const b = await store.create({ clineTaskId: "b", mode: "architect", profile: "tao" })
		const s = await handleCockpitMessage(store, a.task_id, { type: "load" })
		s.tasks.map((t) => t.task_id).should.eql([b.task_id, a.task_id])
		s.ctx!.task_id.should.equal(a.task_id)
	})
})
