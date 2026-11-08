import type { ApiHandler } from "@/core/api"

export interface LlmUsage {
	input: number
	output: number
	cacheRead: number
	cacheWrite: number
	costUsd?: number
}

export interface LlmResult {
	text: string
	usage: LlmUsage
	durationMs: number
}

/** One-shot model call used by Mycelium's auxiliary calls (update-cycle, repair, migration). */
export interface LlmCaller {
	call(system: string, user: string): Promise<LlmResult>
}

/** Adapt a Cline ApiHandler: stream one request, concatenate text, sum usage chunks (as Cline does). */
export function apiHandlerCaller(api: Pick<ApiHandler, "createMessage">): LlmCaller {
	return {
		async call(system, user) {
			const started = Date.now()
			const usage: LlmUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
			let text = ""
			for await (const chunk of api.createMessage(system, [{ role: "user", content: [{ type: "text", text: user }] }])) {
				if (chunk.type === "text") {
					text += chunk.text
				} else if (chunk.type === "usage") {
					usage.input += chunk.inputTokens ?? 0
					usage.output += chunk.outputTokens ?? 0
					usage.cacheRead += chunk.cacheReadTokens ?? 0
					usage.cacheWrite += chunk.cacheWriteTokens ?? 0
					if (chunk.totalCost !== undefined) usage.costUsd = (usage.costUsd ?? 0) + chunk.totalCost
				}
			}
			return { text, usage, durationMs: Date.now() - started }
		},
	}
}
