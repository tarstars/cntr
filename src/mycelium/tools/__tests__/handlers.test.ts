import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import type { ToolUse } from "@core/assistant-message"
import type { TaskConfig } from "@core/task/tools/types/TaskConfig"
import { anchorHash } from "../../kernel/snippets"
import { evaluateToolPolicy } from "../../modes/toolPolicy"
import { handoffsDir } from "../../paths"
import { IMPROVED_PROFILE, type Profile, TAO_PROFILE } from "../../profile"
import type { MyceliumHooks } from "../../runtime/types"
import { TaskContextStore } from "../../store/TaskContextStore"
import { createMyceliumHandlers } from "../handlers"

describe("myc_* tool handlers", () => {
	let cwd: string
	let store: TaskContextStore
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-tools-"))
		store = new TaskContextStore(cwd)
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	async function setup(profile: Profile, mode: "developer" | "architect" = "developer") {
		const ctx = await store.create({ clineTaskId: "c", mode, profile: profile.id })
		const hooks: MyceliumHooks = {
			cwd,
			taskId: ctx.task_id,
			profile,
			store,
			gateDeps: () => ({
				askOwner: async () => true,
				runCheckAll: async () => ({
					started_at: "",
					duration_ms: 0,
					exit_code: 0,
					status: "passed",
					source: "extension",
					command: "bash check_all.sh",
				}),
			}),
			checkToolCall: (name) => evaluateToolPolicy(mode, ctx.stage, name, profile),
			onCommandFinished: async () => {},
			onToolFinished: async () => {},
			invalidateKernel: () => {},
			onTaskCompleted: async () => {},
		}
		const config = { getMycelium: () => hooks } as unknown as TaskConfig
		const handlers = Object.fromEntries(createMyceliumHandlers().map((h) => [h.name, h]))
		const call = (name: string, params: Record<string, string>) =>
			handlers[name].execute(config, {
				type: "tool_use",
				name,
				params,
				partial: false,
			} as unknown as ToolUse) as Promise<string>
		return { ctx, call }
	}

	it("set_stage success returns 'Stage transition: A → B' and persists history", async () => {
		const { ctx, call } = await setup(TAO_PROFILE)
		await store.update(ctx.task_id, (c) => {
			for (const k of Object.keys(c.exit_criteria)) c.exit_criteria[k] = true
		})
		const out = await call("myc_set_stage", { to_stage: "data_collection", reason: "spec agreed", evidence: "[]" })
		out.should.containEql("Stage transition: clarification → data_collection")
		const after = await store.load(ctx.task_id)
		after.stage.should.equal("data_collection")
		after.stage_history.length.should.equal(1)
	})

	it("set_stage failure returns the gate error verbatim and leaves state unchanged", async () => {
		const { ctx, call } = await setup(TAO_PROFILE)
		const out = await call("myc_set_stage", { to_stage: "data_collection", reason: "go", evidence: "[]" })
		out.should.containEql("exit criteria not satisfied")
		;(await store.load(ctx.task_id)).stage.should.equal("clarification")
	})

	it("improved: update_exit_criteria refuses check_all_passed; tao accepts it", async () => {
		for (const [p, accepted] of [
			[IMPROVED_PROFILE, false],
			[TAO_PROFILE, true],
		] as const) {
			const { ctx, call } = await setup(p)
			await store.update(ctx.task_id, (c) => {
				c.stage = "development"
				c.exit_criteria = { implementation_done: false, check_all_passed: false }
			})
			const out = await call("myc_update_exit_criteria", {
				criteria: '{"check_all_passed": true, "implementation_done": true}',
			})
			const after = await store.load(ctx.task_id)
			after.exit_criteria.check_all_passed.should.equal(accepted)
			after.exit_criteria.implementation_done.should.be.true()
			if (!accepted) out.should.containEql("check_all.sh")
		}
	})

	it("add_code_ref computes the sha256 anchor from the file", async () => {
		const { ctx, call } = await setup(TAO_PROFILE)
		await fs.writeFile(path.join(cwd, "a.ts"), "one\ntwo\nthree\n")
		await call("myc_add_code_ref", { path: "a.ts", start_line: "2", end_line: "3", why: "core logic" })
		const ref = (await store.load(ctx.task_id)).refs[0]
		ref.sha256.should.equal(anchorHash(["two", "three"]))
		ref.why.should.equal("core logic")
	})

	it("update_acceptance_criteria appends a round; latest status per index wins", async () => {
		const { ctx, call } = await setup(TAO_PROFILE)
		await call("myc_update_task_spec", { spec: "page", acceptance_criteria: '["renders", "has photo"]' })
		await call("myc_update_acceptance_criteria", { statuses: '[{"index":0,"status":"fail","comment":"blank"}]' })
		await call("myc_update_acceptance_criteria", { statuses: '[{"index":0,"status":"pass","comment":"fixed"}]' })
		const after = await store.load(ctx.task_id)
		after.task.acceptance_criteria.should.eql(["renders", "has photo"])
		after.ac_rounds.length.should.equal(2)
		after.ac_rounds[1].items[0].status.should.equal("pass")
	})

	it("create_handoff writes .mycelium/handoffs/<task_id>.json with spec, AC, refs, decisions, notes", async () => {
		const { ctx, call } = await setup(TAO_PROFILE, "architect")
		await call("myc_update_task_spec", { spec: "fungi site", acceptance_criteria: '["8 docs"]' })
		await call("myc_add_note", { text: "Astro static site", tags: "decision" })
		await call("myc_add_note", { text: "maybe dark theme", tags: "hypothesis" })
		const out = await call("myc_create_handoff", { summary: "architecture done" })
		out.should.containEql(".mycelium/handoffs")
		const bundle = JSON.parse(await fs.readFile(path.join(handoffsDir(cwd), `${ctx.task_id}.json`), "utf8"))
		bundle.spec.should.equal("fungi site")
		bundle.acceptance_criteria.should.eql(["8 docs"])
		bundle.decisions.map((d: { text: string }) => d.text).should.eql(["Astro static site"])
		bundle.notes.length.should.equal(2)
		bundle.should.have.property("refs")
	})

	it("handlers return a tool error, not throw, when no Mycelium context is attached", async () => {
		const handlers = createMyceliumHandlers()
		for (const h of handlers) {
			const out = (await h.execute(
				{} as TaskConfig,
				{ type: "tool_use", name: h.name, params: {}, partial: false } as unknown as ToolUse,
			)) as string
			out.should.match(/Mycelium/)
		}
	})
})
