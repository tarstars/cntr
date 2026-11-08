// Headless end-to-end scenario: one Developer task driven through every stage with the real runtime,
// store, gate and myc_* handlers (no VS Code, no model; tool calls are scripted).
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import type { ToolUse } from "@core/assistant-message"
import type { TaskConfig } from "@core/task/tools/types/TaskConfig"
import type { ClineStorageMessage } from "@/shared/messages/content"
import type { LlmCaller } from "../llm/LlmCaller"
import { STAGES } from "../modes/pipelines"
import { myceliumDir, nextTaskFile, profileFile } from "../paths"
import { MyceliumTaskRuntime } from "../runtime/MyceliumTaskRuntime"
import { TaskContextStore } from "../store/TaskContextStore"
import { createMyceliumHandlers } from "../tools/handlers"

const aux: LlmCaller = {
	async call() {
		return {
			text: '{"add_notes":[{"text":"page uses a static list","tags":["info"]}]}',
			usage: { input: 50, output: 10, cacheRead: 0, cacheWrite: 0 },
			durationMs: 4,
		}
	},
}

for (const profile of ["tao", "improved"] as const) {
	describe(`scenario: one Developer task end to end (${profile})`, () => {
		let cwd: string
		beforeEach(async () => {
			cwd = await fs.mkdtemp(path.join(os.tmpdir(), `myc-scenario-${profile}-`))
			await fs.mkdir(myceliumDir(cwd), { recursive: true })
			await fs.writeFile(profileFile(cwd), JSON.stringify({ profile }))
			await fs.writeFile(nextTaskFile(cwd), JSON.stringify({ mode: "developer" }))
			await fs.writeFile(path.join(cwd, "check_all.sh"), "#!/usr/bin/env bash\necho all checks green\n")
			await fs.writeFile(path.join(cwd, "index.html"), "<h1>Хищные грибы</h1>\n<ul></ul>\n")
		})
		afterEach(async () => {
			await fs.rm(cwd, { recursive: true, force: true })
		})

		it("goes clarification → data_collection → development → audit → report and records metrics", async () => {
			const asked: string[] = []
			const rt = (await MyceliumTaskRuntime.attach({
				cwd,
				clineTaskId: "cline-1",
				isResume: false,
				caller: aux,
				askOwner: async (q) => {
					asked.push(q)
					return true
				},
			}))!
			const config = { getMycelium: () => rt } as unknown as TaskConfig
			const handlers = Object.fromEntries(createMyceliumHandlers().map((h) => [h.name, h]))
			const history: ClineStorageMessage[] = [
				{ role: "user", content: [{ type: "text", text: "Выполняем Этап 1: species list" }] },
			]
			let n = 0
			const call = async (name: string, params: Record<string, string>) => {
				const req = await rt.beforeRequest(history)
				req.messages[0].role.should.equal("user")
				await rt.afterAgentCall({
					usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, costUsd: 0.001 },
					durationMs: 800,
				})
				const out = (await handlers[name].execute(config, {
					type: "tool_use",
					name,
					params,
					partial: false,
				} as unknown as ToolUse)) as string
				const id = `t${n++}`
				history.push(
					{ role: "assistant", content: [{ type: "tool_use", id, name, input: params }] },
					{ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: out }] },
				)
				return out
			}
			const tickAll = async () => {
				const store = new TaskContextStore(cwd)
				const stage = (await store.load(rt.taskId)).stage
				const keys = Object.keys(STAGES[stage].exitCriteria).filter(
					(k) => !(profile === "improved" && k === "check_all_passed"),
				)
				return call("myc_update_exit_criteria", {
					criteria: JSON.stringify(Object.fromEntries(keys.map((k) => [k, true]))),
				})
			}
			const next = async (to: string) => {
				const out = await call("myc_set_stage", { to_stage: to, reason: `${to} next`, evidence: "[]" })
				out.should.containEql(`→ ${to}`)
			}

			await call("myc_update_task_spec", {
				spec: "List carnivorous fungi species",
				acceptance_criteria: '["list renders"]',
				constraints: '["static HTML"]',
			})
			await tickAll()
			await next("data_collection")
			await call("myc_add_code_ref", { path: "index.html", start_line: "1", end_line: "2", why: "page skeleton" })
			await tickAll()
			await next("development")
			await tickAll()
			await next("audit")
			await call("myc_update_acceptance_criteria", {
				statuses: '[{"index":0,"status":"pass","comment":"opened the page"}]',
			})
			await tickAll()
			await next("report")

			const ctx = await new TaskContextStore(cwd).load(rt.taskId)
			ctx.stage.should.equal("report")
			ctx.stage_history.map((h) => h.to).should.eql(["data_collection", "development", "audit", "report"])
			ctx.metrics.by_type.agent.count.should.equal(n)
			ctx.metrics.by_type.update_cycle.count.should.be.above(0)
			ctx.refs[0].path.should.equal("index.html")
			if (profile === "improved") {
				ctx.metrics.check_runs.map((r) => r.status).should.eql(["passed", "passed"])
				asked.length.should.equal(1) // leaving audit
			} else {
				ctx.metrics.check_runs.length.should.equal(0)
				asked.length.should.equal(0)
			}
			await rt.onTaskCompleted()
			;(await new TaskContextStore(cwd).load(rt.taskId)).status.should.equal("done")
		})
	})
}
