import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { STAGES } from "../../modes/pipelines"
import { taskDir } from "../../paths"
import { TaskContextStore } from "../TaskContextStore"

describe("TaskContextStore", () => {
	let cwd: string
	let store: TaskContextStore

	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-store-"))
		store = new TaskContextStore(cwd)
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	const ctxFile = (taskId: string) => path.join(taskDir(cwd, taskId), "task_context.json")

	it("create seeds stage, exit criteria (all false) and auto-plan from STAGES", async () => {
		const ctx = await store.create({ clineTaskId: "c1", mode: "developer", profile: "tao" })
		ctx.task_id.should.match(/^t_\d{14}_[0-9a-f]{6}$/)
		ctx.stage.should.equal("clarification")
		Object.keys(ctx.exit_criteria).should.eql(Object.keys(STAGES.clarification.exitCriteria))
		Object.values(ctx.exit_criteria)
			.every((v) => v === false)
			.should.be.true()
		ctx.task.plan.map((p) => p.text).should.eql(STAGES.clarification.autoPlan)
		ctx.schema_version.should.equal(1)
	})

	it("update is atomic", async () => {
		const ctx = await store.create({ clineTaskId: "c1", mode: "developer", profile: "tao" })
		await store.update(ctx.task_id, (c) => {
			c.task.spec = "build it"
		})
		const files = await fs.readdir(taskDir(cwd, ctx.task_id))
		files.filter((f) => f.endsWith(".tmp")).should.be.empty()
		JSON.parse(await fs.readFile(ctxFile(ctx.task_id), "utf8")).task.spec.should.equal("build it")
	})

	it("serialises concurrent saves", async () => {
		const ctx = await store.create({ clineTaskId: "c1", mode: "developer", profile: "tao" })
		await Promise.all(
			Array.from({ length: 20 }, () =>
				store.update(ctx.task_id, (c) => {
					c.user_notes.push("x")
				}),
			),
		)
		;(await store.load(ctx.task_id)).user_notes.length.should.equal(20)
	})

	it("quarantines a corrupt file and creates a fresh context", async () => {
		const ctx = await store.create({ clineTaskId: "c1", mode: "debug", profile: "improved" })
		await fs.writeFile(ctxFile(ctx.task_id), "{")
		const fresh = await store.load(ctx.task_id)
		fresh.mode.should.equal("debug")
		fresh.cline_task_id.should.equal("c1")
		const files = await fs.readdir(taskDir(cwd, ctx.task_id))
		files.some((f) => /^task_context\.corrupt\.\d+\.json$/.test(f)).should.be.true()
		;(await fs.readFile(path.join(taskDir(cwd, ctx.task_id), "audit.jsonl"), "utf8")).should.containEql("context_quarantined")
	})

	it("refuses unknown schema_version without overwriting it", async () => {
		const ctx = await store.create({ clineTaskId: "c1", mode: "developer", profile: "tao" })
		const future = { ...ctx, schema_version: 2, task: { ...ctx.task, spec: "future" } }
		await fs.writeFile(ctxFile(ctx.task_id), JSON.stringify(future))
		const fresh = await store.load(ctx.task_id)
		fresh.schema_version.should.equal(1)
		const kept = (await fs.readdir(taskDir(cwd, ctx.task_id))).find((f) => /^task_context\.v2\.\d+\.json$/.test(f))!
		JSON.parse(await fs.readFile(path.join(taskDir(cwd, ctx.task_id), kept), "utf8")).task.spec.should.equal("future")
	})

	it("snapshot and rollback restore the exact content", async () => {
		const ctx = await store.create({ clineTaskId: "c1", mode: "developer", profile: "tao" })
		await store.update(ctx.task_id, (c) => {
			c.task.spec = "v1"
		})
		const snap = await store.snapshot(ctx.task_id, "test")
		const before = await store.load(ctx.task_id)
		await store.update(ctx.task_id, (c) => {
			c.task.spec = "v2"
		})
		;(await store.rollback(ctx.task_id, snap)).should.eql(before)
		;(await store.load(ctx.task_id)).task.spec.should.equal("v1")
	})

	it("findByClineTask uses index.json", async () => {
		const ctx = await store.create({ clineTaskId: "cline-42", mode: "free", profile: "tao" })
		;(await store.findByClineTask("cline-42"))!.task_id.should.equal(ctx.task_id)
		;((await store.findByClineTask("other")) === undefined).should.be.true()
	})

	it("audit appends one JSON line per event", async () => {
		const ctx = await store.create({ clineTaskId: "c1", mode: "developer", profile: "tao" })
		await store.snapshot(ctx.task_id, "one")
		const lines = (await fs.readFile(path.join(taskDir(cwd, ctx.task_id), "audit.jsonl"), "utf8")).trim().split("\n")
		lines.length.should.be.aboveOrEqual(2)
		for (const l of lines) JSON.parse(l).should.have.property("event")
	})

	it("survives Cyrillic text in the spec and paths", async () => {
		const ctx = await store.create({ clineTaskId: "c1", mode: "developer", profile: "tao" })
		await store.update(ctx.task_id, (c) => {
			c.task.spec = "Сайт о хищных грибах Узбекистана"
		})
		;(await store.load(ctx.task_id)).task.spec.should.equal("Сайт о хищных грибах Узбекистана")
	})
})
