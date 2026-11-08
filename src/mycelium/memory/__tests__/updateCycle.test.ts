import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import type { ClineStorageMessage } from "@/shared/messages/content"
import type { LlmCaller } from "../../llm/LlmCaller"
import { taskDir } from "../../paths"
import { IMPROVED_PROFILE, TAO_PROFILE } from "../../profile"
import { TaskContextStore } from "../../store/TaskContextStore"
import {
	applyExtractorDelta,
	buildExtractorInput,
	type ExtractorDelta,
	parseExtractorOutput,
	runUpdateCycle,
	shouldRunUpdateCycle,
} from "../updateCycle"

const user = (text: string): ClineStorageMessage => ({ role: "user", content: [{ type: "text", text }] })
const assistant = (text: string, id: string): ClineStorageMessage => ({
	role: "assistant",
	content: [
		{ type: "text", text },
		{ type: "tool_use", id, name: "read_file", input: { path: "src/a.ts" } },
	],
})
const result = (id: string): ClineStorageMessage => ({
	role: "user",
	content: [{ type: "tool_result", tool_use_id: id, content: "file body" }],
})
function conversation(toolCalls: number): ClineStorageMessage[] {
	const h: ClineStorageMessage[] = [user("build the page")]
	for (let i = 0; i < toolCalls; i++) h.push(assistant(`I will read file ${i} SECRET_REASONING`, `t${i}`), result(`t${i}`))
	return h
}
const emptyDelta = (): ExtractorDelta => ({ add_refs: [], add_notes: [], add_comments: [], plan_status: [], resolve: [] })
const fakeCaller = (text: string, calls: string[] = []): LlmCaller => ({
	async call(_system, userText) {
		calls.push(userText)
		return { text, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, durationMs: 3 }
	},
})

describe("update-cycle", () => {
	let cwd: string
	let store: TaskContextStore
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-uc-"))
		store = new TaskContextStore(cwd)
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	it("tao triggers after 5 user-role messages including tool results", async () => {
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		shouldRunUpdateCycle(conversation(3), ctx, TAO_PROFILE).should.be.false() // 1 + 3 user-role messages
		shouldRunUpdateCycle(conversation(4), ctx, TAO_PROFILE).should.be.true() // 5
	})

	it("improved triggers after 4 assistant replies or 30000 history tokens", async () => {
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "improved" })
		shouldRunUpdateCycle(conversation(3), ctx, IMPROVED_PROFILE).should.be.false()
		shouldRunUpdateCycle(conversation(4), ctx, IMPROVED_PROFILE).should.be.true()
		shouldRunUpdateCycle([user("x".repeat(130000))], ctx, IMPROVED_PROFILE).should.be.true()
	})

	it("a pending force always triggers", async () => {
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		ctx.update_cycle.pending_force = true
		shouldRunUpdateCycle([user("x")], ctx, TAO_PROFILE).should.be.true()
	})

	it("tao extractor input omits assistant text, improved includes it", async () => {
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		buildExtractorInput(conversation(2), ctx, TAO_PROFILE).should.not.containEql("SECRET_REASONING")
		buildExtractorInput(conversation(2), ctx, IMPROVED_PROFILE).should.containEql("SECRET_REASONING")
		buildExtractorInput(conversation(2), ctx, TAO_PROFILE).should.containEql("read_file")
	})

	it("tao window starts at turn 0 (max 30), improved only unprocessed", async () => {
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		const h = conversation(40)
		ctx.update_cycle.processed_until = h.length - 4
		const tao = buildExtractorInput(h, ctx, TAO_PROFILE)
		tao.should.containEql("build the page")
		tao.should.not.containEql("file 35")
		const imp = buildExtractorInput(h, ctx, IMPROVED_PROFILE)
		imp.should.not.containEql("build the page")
		imp.should.containEql("file 39")
	})

	it("parses fenced and bare JSON", () => {
		const delta = { ...emptyDelta(), add_notes: [{ text: "uses Astro", tags: ["info"] }] }
		;(
			parseExtractorOutput(`Here:\n\`\`\`json\n${JSON.stringify(delta)}\n\`\`\``) as ExtractorDelta
		).add_notes.length.should.equal(1)
		;(parseExtractorOutput(`noise ${JSON.stringify(delta)} noise`) as ExtractorDelta).add_notes.length.should.equal(1)
		parseExtractorOutput("not json at all").should.have.property("error")
	})

	it("malformed → error, cursor unchanged, no snapshot", async () => {
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		const r = await runUpdateCycle({
			store,
			taskId: ctx.task_id,
			history: conversation(5),
			caller: fakeCaller("oops"),
			profile: TAO_PROFILE,
			cwd,
		})
		r.applied.should.be.false()
		r.error!.should.be.a.String()
		;(await store.load(ctx.task_id)).update_cycle.processed_until.should.equal(0)
		;(await fs.readdir(taskDir(cwd, ctx.task_id))).should.not.containEql("snapshots")
	})

	it("tao drops notes that mention a file path, improved keeps them", async () => {
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		const delta: ExtractorDelta = { ...emptyDelta(), add_notes: [{ text: "config lives in src/config.ts", tags: ["info"] }] }
		applyExtractorDelta(ctx, delta, TAO_PROFILE, 1).notes.length.should.equal(0)
		applyExtractorDelta(ctx, delta, IMPROVED_PROFILE, 1).notes.length.should.equal(1)
	})

	it("tao resolve deletes a note, improved marks it resolved", async () => {
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		const withNote = applyExtractorDelta(
			ctx,
			{ ...emptyDelta(), add_notes: [{ text: "hypothesis A", tags: ["hypothesis"] }] },
			IMPROVED_PROFILE,
			1,
		)
		const id = withNote.notes[0].id
		const resolve = { ...emptyDelta(), resolve: [{ kind: "note" as const, id }] }
		applyExtractorDelta(withNote, resolve, TAO_PROFILE, 2).notes.length.should.equal(0)
		applyExtractorDelta(withNote, resolve, IMPROVED_PROFILE, 2).notes[0].resolved.should.be.true()
	})

	it("refs dedup by path+lines; repeated ref updates why and at_turn", async () => {
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "tao" })
		const a = applyExtractorDelta(
			ctx,
			{ ...emptyDelta(), add_refs: [{ path: "a.ts", start_line: 1, end_line: 5, why: "first" }] },
			TAO_PROFILE,
			1,
		)
		const b = applyExtractorDelta(
			a,
			{ ...emptyDelta(), add_refs: [{ path: "a.ts", start_line: 1, end_line: 5, why: "second" }] },
			TAO_PROFILE,
			7,
		)
		b.refs.length.should.equal(1)
		b.refs[0].why.should.equal("second")
		b.refs[0].at_turn.should.equal(7)
	})

	it("snapshot is taken before merge", async () => {
		await fs.mkdir(path.join(cwd, "src"))
		await fs.writeFile(path.join(cwd, "src/a.ts"), "line1\nline2\n")
		const ctx = await store.create({ clineTaskId: "c", mode: "developer", profile: "improved" })
		const delta = { ...emptyDelta(), add_refs: [{ path: "src/a.ts", start_line: 1, end_line: 2, why: "entry point" }] }
		const r = await runUpdateCycle({
			store,
			taskId: ctx.task_id,
			history: conversation(5),
			caller: fakeCaller(JSON.stringify(delta)),
			profile: IMPROVED_PROFILE,
			cwd,
		})
		r.applied.should.be.true()
		const after = await store.load(ctx.task_id)
		after.refs[0].sha256.length.should.equal(64)
		after.update_cycle.processed_until.should.equal(conversation(5).length)
		const events = (await fs.readFile(path.join(taskDir(cwd, ctx.task_id), "audit.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l).event)
		events.indexOf("snapshot").should.be.below(events.indexOf("update_cycle_applied"))
	})
})
