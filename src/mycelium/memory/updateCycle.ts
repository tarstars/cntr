import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { ClineStorageMessage } from "@/shared/messages/content"
import { estimateTokens } from "../kernel/renderKernel"
import { anchorHash } from "../kernel/snippets"
import type { LlmCaller, LlmResult } from "../llm/LlmCaller"
import type { Profile } from "../profile"
import { EXTRACTOR_SYSTEM_PROMPT } from "../prompts/extractorPrompt"
import { appendAudit } from "../store/audit"
import type { NoteTag, PlanItem, TaskContext } from "../store/schema"
import type { TaskContextStore } from "../store/TaskContextStore"

export type ExtractorDelta = {
	add_refs: { path: string; start_line: number; end_line: number; why: string; sha256?: string }[]
	add_notes: { text: string; tags: NoteTag[] }[]
	add_comments: { note_id: string; text: string }[]
	plan_status: { id: string; status: PlanItem["status"] }[]
	resolve: { kind: "ref" | "note"; id: string }[]
}

const MAX_INPUT_CHARS = 60_000
const NOTE_TAGS: ReadonlySet<NoteTag> = new Set(["hypothesis", "decision", "negative_knowledge", "info", "user_message"])
const PLAN_STATUSES: ReadonlySet<string> = new Set(["todo", "next", "in_progress", "done"])
const PATH_MENTION = /[/\\][\w.-]+\.\w{1,6}/

type Block = { type: string; text?: string; name?: string; input?: unknown; content?: unknown; thinking?: string }
const blocksOf = (m: ClineStorageMessage): Block[] =>
	Array.isArray(m.content) ? (m.content as Block[]) : [{ type: "text", text: String(m.content) }]
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
const newId = (p: string) => `${p}_${randomBytes(4).toString("hex")}`

/** Whether an update-cycle is due before the next request. */
export function shouldRunUpdateCycle(history: ClineStorageMessage[], ctx: TaskContext, profile: Profile): boolean {
	const cursor = ctx.update_cycle.processed_until
	if (ctx.update_cycle.pending_force) return true
	if (cursor > history.length) return history.length > 0
	const fresh = history.slice(cursor)
	const { batchSize, tokenThreshold, trigger } = profile.updateCycle
	if (trigger === "user_role_messages") {
		return fresh.filter((m) => m.role === "user").length >= batchSize
	}
	const replies = fresh.filter((m) => m.role === "assistant").length
	return replies >= batchSize || estimateTokens(JSON.stringify(fresh.map((m) => m.content))) >= tokenThreshold
}

function windowOf(history: ClineStorageMessage[], ctx: TaskContext, profile: Profile): ClineStorageMessage[] {
	const { windowTurns, fromTurnZero } = profile.updateCycle
	if (fromTurnZero) {
		let users = 0
		const out: ClineStorageMessage[] = []
		for (const m of history) {
			if (m.role === "user" && ++users > windowTurns) break
			out.push(m)
		}
		return out
	}
	const fresh = history.slice(Math.min(ctx.update_cycle.processed_until, history.length))
	let users = 0
	let start = fresh.length
	while (start > 0 && !(fresh[start - 1].role === "user" && users + 1 > windowTurns)) {
		if (fresh[start - 1].role === "user") users++
		start--
	}
	return fresh.slice(start)
}

function formatMessage(m: ClineStorageMessage, includeAssistantText: boolean): string {
	const parts: string[] = []
	for (const b of blocksOf(m)) {
		if (m.role === "user") {
			if (b.type === "text") parts.push(`[user] ${clip(b.text ?? "", 2000)}`)
			if (b.type === "tool_result") {
				const c = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "")
				parts.push(`[result] ${clip(c, 3000)}`)
			}
		} else {
			if (b.type === "tool_use") parts.push(`[tool] ${b.name} ${clip(JSON.stringify(b.input ?? {}), 800)}`)
			if (includeAssistantText && b.type === "text" && b.text?.trim()) parts.push(`[agent] ${clip(b.text, 2000)}`)
			if (includeAssistantText && b.type === "thinking" && b.thinking)
				parts.push(`[agent thinks] ${clip(b.thinking, 1500)}`)
		}
	}
	return parts.join("\n")
}

/** BASELINE (current memory) + RAW_TAIL (formatted transcript window), capped at 60 000 chars. */
export function buildExtractorInput(history: ClineStorageMessage[], ctx: TaskContext, profile: Profile): string {
	const baseline = {
		task: ctx.task,
		refs: ctx.refs.map(({ id, path, start_line, end_line, why, resolved }) => ({
			id,
			path,
			start_line,
			end_line,
			why,
			resolved,
		})),
		notes: ctx.notes.map(({ id, text, tags, resolved, comments }) => ({
			id,
			text,
			tags,
			resolved,
			comments: comments.map((c) => c.text),
		})),
		changes: ctx.changes.map(({ id, summary }) => ({ id, summary })),
	}
	const tail = windowOf(history, ctx, profile)
		.map((m) => formatMessage(m, profile.updateCycle.includeAssistantText))
		.filter(Boolean)
		.join("\n")
	const head = `Now: ${new Date().toISOString()}\nBASELINE:\n${JSON.stringify(baseline)}\nRAW_TAIL:\n`
	const room = Math.max(0, MAX_INPUT_CHARS - head.length)
	return head + (tail.length > room ? tail.slice(tail.length - room) : tail)
}

/** Read the JSON object from a fenced ```json block or the outermost {…}. */
export function parseExtractorOutput(text: string): ExtractorDelta | { error: string } {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
	const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
	let raw: Record<string, unknown>
	try {
		raw = JSON.parse(candidate)
	} catch (error) {
		return { error: `extractor output is not JSON: ${error instanceof Error ? error.message : error}` }
	}
	const arr = <T>(v: unknown, ok: (x: any) => boolean): T[] => (Array.isArray(v) ? (v.filter(ok) as T[]) : [])
	return {
		add_refs: arr(
			raw.add_refs,
			(r) => typeof r?.path === "string" && Number.isInteger(r?.start_line) && Number.isInteger(r?.end_line),
		),
		add_notes: arr<{ text: string; tags: NoteTag[] }>(raw.add_notes, (n) => typeof n?.text === "string").map((n) => ({
			text: n.text,
			tags: (Array.isArray(n.tags) ? n.tags : []).filter((t: NoteTag) => NOTE_TAGS.has(t)),
		})),
		add_comments: arr(raw.add_comments, (c) => typeof c?.note_id === "string" && typeof c?.text === "string"),
		plan_status: arr(raw.plan_status, (p) => typeof p?.id === "string" && PLAN_STATUSES.has(p?.status)),
		resolve: arr(raw.resolve, (r) => (r?.kind === "ref" || r?.kind === "note") && typeof r?.id === "string"),
	}
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()

/** Pure merge of an extractor delta into the context. */
export function applyExtractorDelta(ctx: TaskContext, delta: ExtractorDelta, profile: Profile, turn: number): TaskContext {
	const next: TaskContext = structuredClone(ctx)
	for (const r of delta.add_refs) {
		const existing = next.refs.find((x) => x.path === r.path && x.start_line === r.start_line && x.end_line === r.end_line)
		if (existing) {
			existing.why = r.why || existing.why
			existing.at_turn = turn
			if (r.sha256) existing.sha256 = r.sha256
			existing.stale = false
		} else {
			next.refs.push({
				id: newId("r"),
				path: r.path,
				start_line: r.start_line,
				end_line: r.end_line,
				sha256: r.sha256 ?? "",
				why: r.why ?? "",
				at_turn: turn,
				stale: false,
				resolved: false,
			})
		}
	}
	for (const n of delta.add_notes) {
		if (profile.notes.dropPathMentions && PATH_MENTION.test(n.text)) continue
		const existing = next.notes.find((x) => norm(x.text) === norm(n.text))
		if (existing) {
			existing.at_turn = turn
		} else {
			next.notes.push({
				id: newId("n"),
				text: n.text,
				tags: n.tags.length ? n.tags : ["info"],
				at_turn: turn,
				hidden: false,
				resolved: false,
				comments: [],
			})
		}
	}
	for (const c of delta.add_comments) {
		const note = next.notes.find((x) => x.id === c.note_id)
		if (note) {
			note.comments.push({ text: c.text, at: new Date().toISOString() })
			note.at_turn = turn
		}
	}
	for (const p of delta.plan_status) {
		const item = next.task.plan.find((x) => x.id === p.id)
		if (item) item.status = p.status
	}
	for (const r of delta.resolve) {
		if (r.kind === "ref") {
			const ref = next.refs.find((x) => x.id === r.id)
			if (ref) ref.resolved = true
		} else if (profile.notes.resolveDeletes) {
			next.notes = next.notes.filter((x) => x.id !== r.id)
		} else {
			const note = next.notes.find((x) => x.id === r.id)
			if (note) note.resolved = true
		}
	}
	return next
}

async function anchorRefs(cwd: string, delta: ExtractorDelta): Promise<void> {
	for (const r of delta.add_refs) {
		try {
			const lines = (await fs.readFile(path.resolve(cwd, r.path), "utf8")).split(/\r?\n/)
			r.sha256 = anchorHash(lines.slice(Math.max(0, r.start_line - 1), r.end_line))
		} catch {
			// unreadable: keep the ref without an anchor
		}
	}
}

/** Extract → (on success) snapshot → merge → advance the cursor to the end of `history`. */
export async function runUpdateCycle(deps: {
	store: TaskContextStore
	taskId: string
	history: ClineStorageMessage[]
	caller: LlmCaller
	profile: Profile
	cwd: string
}): Promise<{ ran: boolean; applied: boolean; result?: LlmResult; error?: string }> {
	const { store, taskId, history, caller, profile, cwd } = deps
	const ctx = await store.load(taskId)
	let result: LlmResult
	try {
		result = await caller.call(EXTRACTOR_SYSTEM_PROMPT, buildExtractorInput(history, ctx, profile))
	} catch (error) {
		return { ran: true, applied: false, error: `update-cycle call failed: ${error instanceof Error ? error.message : error}` }
	}
	const parsed = parseExtractorOutput(result.text)
	if ("error" in parsed) {
		return { ran: true, applied: false, result, error: parsed.error }
	}
	await anchorRefs(cwd, parsed)
	await store.snapshot(taskId, "update_cycle")
	await store.update(taskId, (c) => {
		const merged = applyExtractorDelta(c, parsed, profile, c.update_cycle.turn_counter)
		merged.update_cycle.processed_until = history.length
		merged.update_cycle.pending_force = false
		return merged
	})
	await appendAudit(cwd, taskId, "update_cycle_applied", {
		refs: parsed.add_refs.length,
		notes: parsed.add_notes.length,
		comments: parsed.add_comments.length,
		plan: parsed.plan_status.length,
		resolved: parsed.resolve.length,
	})
	return { ran: true, applied: true, result }
}
