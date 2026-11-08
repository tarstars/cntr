import { describe, it } from "mocha"
import "should"
import { apiHandlerCaller } from "../LlmCaller"

describe("apiHandlerCaller", () => {
	it("sums usage across chunks and concatenates text", async () => {
		const api = {
			async *createMessage(system: string, messages: unknown[]) {
				system.should.equal("SYS")
				JSON.stringify(messages).should.containEql("USER")
				yield { type: "usage" as const, inputTokens: 100, outputTokens: 0, cacheReadTokens: 50 }
				yield { type: "text" as const, text: "hello " }
				yield { type: "reasoning" as const, reasoning: "thinking" }
				yield { type: "text" as const, text: "world" }
				yield { type: "usage" as const, inputTokens: 0, outputTokens: 20, totalCost: 0.01 }
			},
		}
		const r = await apiHandlerCaller(api as never).call("SYS", "USER")
		r.text.should.equal("hello world")
		r.usage.should.eql({ input: 100, output: 20, cacheRead: 50, cacheWrite: 0, costUsd: 0.01 })
		r.durationMs.should.be.aboveOrEqual(0)
	})
})
