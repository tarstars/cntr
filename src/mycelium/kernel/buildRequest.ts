import type { ClineStorageMessage } from "@/shared/messages/content"
import type { Profile } from "../profile"
import { estimateTokens } from "./renderKernel"

type Block = { type: string; id?: string; tool_use_id?: string; text?: string; content?: unknown }

const blocks = (m: ClineStorageMessage): Block[] =>
	Array.isArray(m.content) ? (m.content as Block[]) : [{ type: "text", text: String(m.content) }]

const sizeOf = (m: ClineStorageMessage) => estimateTokens(JSON.stringify(m.content))

/**
 * Replace tool_result blocks whose tool_use is not in the kept messages by plain text, so providers
 * that validate tool pairing accept the request; drop messages left empty.
 */
function repairPairs(messages: ClineStorageMessage[]): ClineStorageMessage[] {
	const seen = new Set<string>()
	const out: ClineStorageMessage[] = []
	for (const m of messages) {
		const fixed = blocks(m).map((b) => {
			if (b.type === "tool_use" && b.id) seen.add(b.id)
			if (b.type === "tool_result" && b.tool_use_id && !seen.has(b.tool_use_id)) {
				const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "")
				return { type: "text", text: `[result of an earlier tool call]\n${text}` }
			}
			return b
		})
		if (fixed.length) out.push({ ...m, content: fixed as ClineStorageMessage["content"] })
	}
	return out
}

/** Merge neighbours with the same role so roles strictly alternate. */
function alternate(messages: ClineStorageMessage[]): ClineStorageMessage[] {
	const out: ClineStorageMessage[] = []
	for (const m of messages) {
		const prev = out[out.length - 1]
		if (prev && prev.role === m.role) {
			out[out.length - 1] = { ...prev, content: [...blocks(prev), ...blocks(m)] as ClineStorageMessage["content"] }
		} else {
			out.push(m)
		}
	}
	return out
}

/** The newest messages that fit in `maxTokens`, starting at a user message. */
function window(history: ClineStorageMessage[], maxTokens: number): ClineStorageMessage[] {
	let used = 0
	let start = history.length
	while (start > 0 && used + sizeOf(history[start - 1]) <= maxTokens) {
		used += sizeOf(history[start - 1])
		start--
	}
	while (start < history.length && history[start].role !== "user") start++
	return history.slice(start)
}

/**
 * Messages for one model request: the kernel (merged into the first user message when the history
 * starts with one), the newest history that fits in `windowMaxTokens`, and the tail (tao only).
 */
export function buildRequestMessages(args: {
	history: ClineStorageMessage[]
	kernel: string
	tail?: string
	profile: Profile
}): ClineStorageMessage[] {
	const kernelMsg: ClineStorageMessage = { role: "user", content: [{ type: "text", text: args.kernel }] }
	const recent = repairPairs(window(args.history, args.profile.history.windowMaxTokens))
	const messages = [kernelMsg, ...recent]
	if (args.tail) messages.push({ role: "user", content: [{ type: "text", text: args.tail }] })
	return alternate(messages)
}

/** Stored history after an applied update-cycle: tao keeps the last N messages from a user turn; improved keeps all. */
export function historyAfterCycle(history: ClineStorageMessage[], profile: Profile): ClineStorageMessage[] {
	if (profile.history.afterCycle === "keep") return history
	let start = Math.max(0, history.length - profile.history.keepMessages)
	while (start < history.length && history[start].role !== "user") start++
	return repairPairs(history.slice(start))
}
