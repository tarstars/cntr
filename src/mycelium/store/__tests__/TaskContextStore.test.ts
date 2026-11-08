import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import should from "should"
import { STAGES } from "../../modes/pipelines"
import { indexFile, taskDir } from "../../paths"
import { ContextCorruptError, TaskContextStore } from "../TaskContextStore"

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

	it("load reports a corrupt file without touching it; recover() keeps it aside and starts fresh", async () => {
		const ctx = await store.create({ clineTaskId: "c1", mode: "debug", profile: "improved" })
		await fs.writeFile(ctxFile(ctx.task_id), "{")
		const err = await store.load(ctx.task_id).then(
			() => undefined,
			(e) => e,
		)
		err.should.be.instanceOf(ContextCorruptError)
		err.message.should.containEql("task_context.json")
		;(await fs.readFile(ctxFile(ctx.task_id), "utf8")).should.equal("{")
		const fresh = await store.recover(ctx.task_id)
		fresh.mode.should.equal("debug")
		fresh.cline_task_id.should.equal("c1")
		const files = await fs.readdir(taskDir(cwd, ctx.task_id))
		const aside = files.find((f) => /^task_context\.corrupt\.\d+\.json$/.test(f))!
		;(await fs.readFile(path.join(taskDir(cwd, ctx.task_id), aside), "utf8")).should.equal("{")
		;(await fs.readFile(path.join(taskDir(cwd, ctx.task_id), "audit.jsonl"), "utf8")).should.containEql("context_quarantined")
		;(await store.load(ctx.task_id)).mode.should.equal("debug")
	})

	it("refuses an unknown schema_version without overwriting it", async () => {
		const ctx = await store.create({ clineTaskId: "c1", mode: "developer", profile: "tao" })
		const future = { ...ctx, schema_version: 2, task: { ...ctx.task, spec: "future" } }
		await fs.writeFile(ctxFile(ctx.task_id), JSON.stringify(future))
		const err = await store.load(ctx.task_id).then(
			() => undefined,
			(e) => e,
		)
		err.should.be.instanceOf(ContextCorruptError)
		err.kind.should.equal("schema")
		JSON.parse(await fs.readFile(ctxFile(ctx.task_id), "utf8")).task.spec.should.equal("future")
		const fresh = await store.recover(ctx.task_id)
		fresh.schema_version.should.equal(1)
		const kept = (await fs.readdir(taskDir(cwd, ctx.task_id))).find((f) => /^task_context\.v2\.\d+\.json$/.test(f))!
		JSON.parse(await fs.readFile(path.join(taskDir(cwd, ctx.task_id), kept), "utf8")).task.spec.should.equal("future")
	})

	it("a hand-edit that parses but breaks the structure is reported, not loaded", async () => {
		const ctx = await store.create({ clineTaskId: "c1", mode: "developer", profile: "improved" })
		const breakages: [string, (c: any) => void][] = [
			["notes", (c) => (c.notes = "none")],
			["stage", (c) => (c.stage = "shipping")],
			["task", (c) => delete c.task],
			["plan", (c) => (c.task.plan = [{ text: "x" }])],
			["update_cycle", (c) => (c.update_cycle.turn_counter = "7")],
		]
		for (const [field, breakIt] of breakages) {
			const broken = structuredClone(ctx) as any
			breakIt(broken)
			await fs.writeFile(ctxFile(ctx.task_id), JSON.stringify(broken))
			const err = await store.load(ctx.task_id).then(
				() => undefined,
				(e) => e,
			)
			should(err).be.instanceOf(ContextCorruptError, field)
			err.message.should.containEql(field)
		}
	})

	it("update never overwrites a broken file", async () => {
		const ctx = await store.create({ clineTaskId: "c1", mode: "developer", profile: "improved" })
		await fs.writeFile(ctxFile(ctx.task_id), '{"half": ')
		await store
			.update(ctx.task_id, (c) => {
				c.task.spec = "new"
			})
			.should.be.rejectedWith(ContextCorruptError)
		;(await fs.readFile(ctxFile(ctx.task_id), "utf8")).should.equal('{"half": ')
	})

	it("listTasks skips a broken task and leaves its file alone", async () => {
		const good = await store.create({ clineTaskId: "c1", mode: "developer", profile: "improved" })
		const bad = await store.create({ clineTaskId: "c2", mode: "developer", profile: "improved" })
		await fs.writeFile(ctxFile(bad.task_id), "{")
		;(await store.listTasks()).map((t) => t.task_id).should.eql([good.task_id])
		;(await fs.readFile(ctxFile(bad.task_id), "utf8")).should.equal("{")
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

describe("TaskContextStore — index (review fixes)", () => {
	let cwd: string
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-index-"))
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	it("two windows creating tasks at the same time keep every index entry", async () => {
		const a = new TaskContextStore(cwd)
		const b = new TaskContextStore(cwd)
		const ids = Array.from({ length: 12 }, (_, i) => `cline_${i}`)
		await Promise.all(ids.map((id, i) => (i % 2 ? a : b).create({ clineTaskId: id, mode: "developer", profile: "improved" })))
		const index = JSON.parse(await fs.readFile(indexFile(cwd), "utf8"))
		Object.keys(index)
			.sort()
			.should.eql([...ids].sort())
	})

	it("a corrupt index is rebuilt from the tasks' meta.json, not wiped", async () => {
		const store = new TaskContextStore(cwd)
		const first = await store.create({ clineTaskId: "old", mode: "architect", profile: "tao" })
		await fs.writeFile(indexFile(cwd), "{ not json")
		await store.create({ clineTaskId: "new", mode: "developer", profile: "improved" })
		const found = await store.findByClineTask("old")
		found!.task_id.should.equal(first.task_id)
		JSON.parse(await fs.readFile(indexFile(cwd), "utf8")).should.have.keys("old", "new")
	})

	it("findByClineTask finds a task missing from the index through meta.json", async () => {
		const store = new TaskContextStore(cwd)
		const ctx = await store.create({ clineTaskId: "c9", mode: "debug", profile: "improved" })
		await fs.rm(indexFile(cwd))
		const found = await new TaskContextStore(cwd).findByClineTask("c9")
		found!.task_id.should.equal(ctx.task_id)
	})
})
