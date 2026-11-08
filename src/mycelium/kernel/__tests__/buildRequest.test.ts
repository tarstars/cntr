import { describe, it } from "mocha"
import "should"
import type { ClineStorageMessage } from "@/shared/messages/content"
import { IMPROVED_PROFILE, type Profile, TAO_PROFILE } from "../../profile"
import { buildRequestMessages, historyAfterCycle } from "../buildRequest"

const user = (text: string): ClineStorageMessage => ({ role: "user", content: [{ type: "text", text }] })
const assistantTool = (id: string): ClineStorageMessage => ({
	role: "assistant",
	content: [{ type: "tool_use", id, name: "read_file", input: { path: "a.ts" } }],
})
const toolResult = (id: string, text = "ok"): ClineStorageMessage => ({
	role: "user",
	content: [{ type: "tool_result", tool_use_id: id, content: text }],
})
const turns = (n: number): ClineStorageMessage[] => {
	const out: ClineStorageMessage[] = [user("start the task")]
	for (let i = 0; i < n; i++) out.push(assistantTool(`t${i}`), toolResult(`t${i}`, `result ${i} `.repeat(40)))
	return out
}
const roles = (m: ClineStorageMessage[]) => m.map((x) => x.role)
const withWindow = (p: Profile, tokens: number): Profile => ({ ...p, history: { ...p.history, windowMaxTokens: tokens } })

function assertPairs(messages: ClineStorageMessage[]) {
	const seen = new Set<string>()
	for (const m of messages) {
		if (!Array.isArray(m.content)) continue
		for (const b of m.content as Array<{ type: string; id?: string; tool_use_id?: string }>) {
			if (b.type === "tool_use") seen.add(b.id!)
			if (b.type === "tool_result") seen.has(b.tool_use_id!).should.be.true()
		}
	}
}

describe("request builder", () => {
	for (const p of [TAO_PROFILE, IMPROVED_PROFILE]) {
		it(`never emits two consecutive messages with the same role (${p.id})`, () => {
			const msgs = buildRequestMessages({ history: turns(6), kernel: "KERNEL", tail: "TAIL", profile: p })
			const r = roles(msgs)
			r[0].should.equal("user")
			for (let i = 1; i < r.length; i++) r[i].should.not.equal(r[i - 1])
			JSON.stringify(msgs[0]).should.containEql("KERNEL")
		})
	}

	it("window drops from the front until under windowMaxTokens and never splits a tool_use from its tool_result", () => {
		const history = turns(40)
		const msgs = buildRequestMessages({ history, kernel: "K", profile: withWindow(IMPROVED_PROFILE, 3000) })
		msgs.length.should.be.below(history.length)
		JSON.stringify(msgs).length.should.be.below(3000 * 4 + 2000)
		assertPairs(msgs)
		JSON.stringify(msgs[msgs.length - 1]).should.containEql("result 39")
	})

	it("tao tail carries the plan; improved has no tail", () => {
		const tao = buildRequestMessages({ history: turns(2), kernel: "K", tail: "PLAN: step 1", profile: TAO_PROFILE })
		JSON.stringify(tao[tao.length - 1]).should.containEql("PLAN: step 1")
		const imp = buildRequestMessages({ history: turns(2), kernel: "K", profile: IMPROVED_PROFILE })
		JSON.stringify(imp).should.not.containEql("PLAN")
	})

	it("tao truncates to 20 starting at a user turn, improved keeps everything", () => {
		const history = turns(30)
		const cut = historyAfterCycle(history, TAO_PROFILE)
		cut.length.should.be.belowOrEqual(20)
		cut[0].role.should.equal("user")
		assertPairs(cut)
		historyAfterCycle(history, IMPROVED_PROFILE).should.equal(history)
	})

	it("an empty history yields just the kernel", () => {
		const msgs = buildRequestMessages({ history: [], kernel: "K", profile: TAO_PROFILE })
		msgs.length.should.equal(1)
		msgs[0].role.should.equal("user")
	})
})

describe("request builder — review fixes", () => {
	it("keeps the newest message even when it alone exceeds the window (truncated)", () => {
		const huge = "x".repeat(400_000)
		const history: ClineStorageMessage[] = [user("start"), assistantTool("t1"), toolResult("t1", huge)]
		const msgs = buildRequestMessages({ history, kernel: "K", profile: withWindow(IMPROVED_PROFILE, 3000) })
		const last = JSON.stringify(msgs[msgs.length - 1])
		last.should.containEql("truncated")
		last.length.should.be.below(3000 * 4 + 2000)
		last.should.containEql("xxxxxxxx") // the newest tool result is present (merged after the kernel)
	})
})
