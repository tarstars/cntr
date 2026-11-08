import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import type { ClineStorageMessage } from "@/shared/messages/content"
import type { LlmCaller } from "../../llm/LlmCaller"
import { myceliumDir, nextTaskFile, profileFile } from "../../paths"
import { TaskContextStore } from "../../store/TaskContextStore"
import { MyceliumTaskRuntime } from "../MyceliumTaskRuntime"

const user = (text: string): ClineStorageMessage => ({ role: "user", content: [{ type: "text", text }] })
const tool = (i: number): ClineStorageMessage[] => [
	{
		role: "assistant",
		content: [
			{ type: "text", text: `step ${i}` },
			{ type: "tool_use", id: `t${i}`, name: "read_file", input: { path: "a.ts" } },
		],
	},
	{ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "body" }] },
]
const conversation = (n: number) => [user("build it"), ...Array.from({ length: n }, (_, i) => tool(i)).flat()]
const okCaller = (reply = '{"add_notes":[{"text":"found it","tags":["info"]}]}'): LlmCaller => ({
	async call() {
		return { text: reply, usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 }, durationMs: 5 }
	},
})
const failingCaller: LlmCaller = {
	async call() {
		throw new Error("provider down")
	},
}

describe("MyceliumTaskRuntime", () => {
	let cwd: string
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-rt-"))
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})
	const useProfile = async (profile: "tao" | "improved", extra: object = {}) => {
		await fs.mkdir(myceliumDir(cwd), { recursive: true })
		await fs.writeFile(profileFile(cwd), JSON.stringify({ profile, ...extra }))
	}
	const attach = (clineTaskId = "c1", caller: LlmCaller = okCaller()) =>
		MyceliumTaskRuntime.attach({ cwd, clineTaskId, isResume: false, caller, askOwner: async () => true })

	it("attach returns undefined in a workspace without .mycelium", async () => {
		;((await attach()) === undefined).should.be.true()
	})

	it("attach consumes next_task.json and creates a context in that mode", async () => {
		await useProfile("tao")
		await fs.writeFile(nextTaskFile(cwd), JSON.stringify({ mode: "architect", profile: "improved" }))
		const rt = (await attach())!
		rt.mode().should.equal("architect")
		rt.stage().should.equal("architecture_discussion")
		rt.profile.id.should.equal("improved")
		await fs
			.access(nextTaskFile(cwd))
			.then(
				() => "exists",
				() => "gone",
			)
			.should.be.fulfilledWith("gone")
	})

	it("uses defaultMode from profile.json, else developer", async () => {
		await useProfile("tao", { defaultMode: "debug" })
		;(await attach("a"))!.mode().should.equal("debug")
		await useProfile("tao")
		;(await attach("b"))!.mode().should.equal("developer")
	})

	it("resume finds the existing context by cline task id", async () => {
		await useProfile("tao")
		const first = (await attach("same"))!
		const again = (await MyceliumTaskRuntime.attach({
			cwd,
			clineTaskId: "same",
			isResume: true,
			caller: okCaller(),
			askOwner: async () => true,
		}))!
		again.taskId.should.equal(first.taskId)
	})

	it("beforeRequest runs the update-cycle on trigger and returns replaceStoredHistory only for tao", async () => {
		await useProfile("tao")
		const tao = (await attach("t"))!
		const r1 = await tao.beforeRequest(conversation(30))
		r1.replaceStoredHistory!.length.should.be.belowOrEqual(20)
		JSON.stringify(r1.messages[0]).should.containEql("Mycelium Task Context")
		await useProfile("improved")
		const imp = (await attach("i"))!
		const r2 = await imp.beforeRequest(conversation(30))
		;(r2.replaceStoredHistory === undefined).should.be.true()
		;(await new TaskContextStore(cwd).load(imp.taskId)).notes.map((n) => n.text).should.containEql("found it")
	})

	it("beforeRequest notices include update-cycle runs for improved only", async () => {
		await useProfile("improved")
		const imp = (await attach("i"))!
		;(await imp.beforeRequest(conversation(5))).notices.join("\n").should.match(/update-cycle/i)
		await useProfile("tao")
		const tao = (await attach("t"))!
		;(await tao.beforeRequest(conversation(5))).notices.should.eql([])
	})

	it("toolFilter hides write tools in data_collection", async () => {
		await useProfile("tao")
		const rt = (await attach())!
		await new TaskContextStore(cwd).update(rt.taskId, (c) => {
			c.stage = "data_collection"
		})
		await rt.beforeRequest([user("go")])
		const allow = rt.toolFilter()
		allow("write_to_file").should.be.false()
		allow("read_file").should.be.true()
		allow("plan_mode_respond").should.be.false()
		rt.myceliumToolIds().should.containEql("myc_set_stage")
	})

	it("afterAgentCall records an agent call under the current stage", async () => {
		await useProfile("tao")
		const rt = (await attach())!
		await rt.beforeRequest([user("go")])
		await rt.afterAgentCall({
			usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 0, costUsd: 0.02 },
			durationMs: 1500,
		})
		const m = (await new TaskContextStore(cwd).load(rt.taskId)).metrics
		m.by_type.agent.count.should.equal(1)
		m.by_stage.clarification.model_ms.should.equal(1500)
	})

	it("a failing auxiliary model gives a notice in improved, is silent in tao, and never throws", async () => {
		await useProfile("improved")
		const imp = (await attach("i", failingCaller))!
		const r = await imp.beforeRequest(conversation(5))
		r.notices.join("\n").should.match(/provider down/)
		r.messages.length.should.be.above(0)
		await useProfile("tao")
		const tao = (await attach("t", failingCaller))!
		;(await tao.beforeRequest(conversation(5))).notices.should.eql([])
	})
})
