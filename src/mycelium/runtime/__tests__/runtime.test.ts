import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import should from "should"
import type { ClineStorageMessage } from "@/shared/messages/content"
import type { LlmCaller } from "../../llm/LlmCaller"
import { myceliumDir, nextTaskFile, profileFile, taskDir } from "../../paths"
import { EXTRACTOR_SYSTEM_PROMPT } from "../../prompts/extractorPrompt"
import { ContextCorruptError, TaskContextStore } from "../../store/TaskContextStore"
import { MyceliumTaskRuntime, prepareRequestOrFallback } from "../MyceliumTaskRuntime"

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

	it("a resumed task with no context leaves next_task.json for the next new task", async () => {
		await useProfile("improved")
		await fs.writeFile(nextTaskFile(cwd), JSON.stringify({ mode: "architect" }))
		const resumed = (await MyceliumTaskRuntime.attach({
			cwd,
			clineTaskId: "old",
			isResume: true,
			caller: okCaller(),
			askOwner: async () => true,
		}))!
		resumed.mode().should.equal("developer")
		;(await fs.stat(nextTaskFile(cwd))).isFile().should.be.true()
		const fresh = (await attach("new"))!
		fresh.mode().should.equal("architect")
		await fs.stat(nextTaskFile(cwd)).should.be.rejected()
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

describe("MyceliumTaskRuntime — context overflow", () => {
	let cwd: string
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-rt-shrink-"))
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	for (const profile of ["tao", "improved"] as const) {
		it(`shrinkBudgets makes the next request smaller (${profile})`, async () => {
			await fs.mkdir(myceliumDir(cwd), { recursive: true })
			await fs.writeFile(profileFile(cwd), JSON.stringify({ profile }))
			const rt = (await MyceliumTaskRuntime.attach({
				cwd,
				clineTaskId: "c",
				isResume: false,
				caller: okCaller("{}"),
				askOwner: async () => true,
			}))!
			await new TaskContextStore(cwd).update(rt.taskId, (c) => {
				for (let i = 0; i < 400; i++)
					c.notes.push({
						id: `n${i}`,
						text: `finding ${i} `.repeat(30),
						tags: ["info"],
						at_turn: i,
						hidden: false,
						resolved: false,
						comments: [],
					})
			})
			const long = [
				user("go"),
				...Array.from({ length: 60 }, (_, i) => [
					{
						role: "assistant" as const,
						content: [{ type: "tool_use" as const, id: `t${i}`, name: "read_file", input: { path: "a.ts" } }],
					},
					{
						role: "user" as const,
						content: [{ type: "tool_result" as const, tool_use_id: `t${i}`, content: "line\n".repeat(2000) }],
					},
				]).flat(),
			] as ClineStorageMessage[]
			const before = JSON.stringify((await rt.beforeRequest(long)).messages).length
			rt.shrinkBudgets()
			const after = JSON.stringify((await rt.beforeRequest(long)).messages).length
			after.should.be.below(before * 0.75)
		})
	}
})

describe("MyceliumTaskRuntime — update-cycle backoff", () => {
	let cwd: string
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-rt-backoff-"))
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	for (const [profile, expected] of [
		["improved", 3],
		["tao", 8],
	] as const) {
		it(`a down auxiliary model is called ${expected} times in 8 requests (${profile})`, async () => {
			await fs.mkdir(myceliumDir(cwd), { recursive: true })
			await fs.writeFile(profileFile(cwd), JSON.stringify({ profile }))
			let extractorCalls = 0
			const caller: LlmCaller = {
				async call(system) {
					if (system === EXTRACTOR_SYSTEM_PROMPT) extractorCalls++
					throw new Error("provider down")
				},
			}
			const rt = (await MyceliumTaskRuntime.attach({
				cwd,
				clineTaskId: "c",
				isResume: false,
				caller,
				askOwner: async () => true,
			}))!
			for (let i = 0; i < 8; i++) await rt.beforeRequest(conversation(5))
			extractorCalls.should.equal(expected)
		})
	}
})

describe("MyceliumTaskRuntime — broken memory file", () => {
	let cwd: string
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-rt-corrupt-"))
		await fs.mkdir(myceliumDir(cwd), { recursive: true })
		await fs.writeFile(profileFile(cwd), JSON.stringify({ profile: "improved" }))
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})
	const ctxFile = (taskId: string) => path.join(taskDir(cwd, taskId), "task_context.json")
	const attachWith = (askOwner: (q: string) => Promise<boolean>, isResume = true) =>
		MyceliumTaskRuntime.attach({ cwd, clineTaskId: "c", isResume, caller: okCaller("{}"), askOwner })

	it("on resume, asks the owner; approve keeps the broken file aside and starts fresh memory", async () => {
		const first = (await attachWith(async () => true, false))!
		await fs.writeFile(ctxFile(first.taskId), "{")
		const questions: string[] = []
		const rt = (await attachWith(async (q) => {
			questions.push(q)
			return true
		}))!
		questions.length.should.equal(1)
		questions[0].should.containEql("task_context.json")
		rt.taskId.should.equal(first.taskId)
		const r = await rt.beforeRequest(conversation(1))
		r.notices.join("\n").should.match(/memory .*reset/i)
		;(await fs.readdir(taskDir(cwd, first.taskId))).some((f) => f.startsWith("task_context.corrupt.")).should.be.true()
	})

	it("on resume, owner declines: attach fails with ContextCorruptError and the file is untouched", async () => {
		const first = (await attachWith(async () => true, false))!
		await fs.writeFile(ctxFile(first.taskId), "{")
		await attachWith(async () => false).should.be.rejectedWith(ContextCorruptError)
		;(await fs.readFile(ctxFile(first.taskId), "utf8")).should.equal("{")
	})

	it("broken mid-task: asks once; declined → each request fails with ContextCorruptError, file untouched; fixed → works again", async () => {
		let asked = 0
		const rt = (await attachWith(async () => {
			asked++
			return false
		}, false))!
		const good = await fs.readFile(ctxFile(rt.taskId), "utf8")
		await fs.writeFile(ctxFile(rt.taskId), "{")
		await rt.beforeRequest(conversation(1)).should.be.rejectedWith(ContextCorruptError)
		await rt.beforeRequest(conversation(1)).should.be.rejectedWith(ContextCorruptError)
		asked.should.equal(1)
		;(await fs.readFile(ctxFile(rt.taskId), "utf8")).should.equal("{")
		await fs.writeFile(ctxFile(rt.taskId), good)
		;(await rt.beforeRequest(conversation(1))).messages.length.should.be.above(0)
	})

	it("prepareRequestOrFallback reports the problem and returns undefined so the request runs as plain Cline", async () => {
		const reported: string[] = []
		const failing = {
			beforeRequest: async () => {
				throw new ContextCorruptError("corrupt", "/w/.mycelium/tasks/t/task_context.json", "Unexpected end of JSON input")
			},
		}
		const r = await prepareRequestOrFallback(failing, [], async (m) => {
			reported.push(m)
		})
		should(r).be.undefined()
		reported.length.should.equal(1)
		reported[0].should.containEql("task_context.json")
		reported[0].should.match(/without Mycelium/)
	})
})
