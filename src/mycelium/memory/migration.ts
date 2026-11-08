import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { LlmCaller, LlmResult } from "../llm/LlmCaller"
import { handoffsDir } from "../paths"
import type { Profile } from "../profile"
import { MIGRATION_SYSTEM_PROMPT } from "../prompts/migrationPrompt"
import { appendAudit } from "../store/audit"
import type { NoteTag, TaskContext } from "../store/schema"
import type { TaskContextStore } from "../store/TaskContextStore"

const TAGS = new Set<NoteTag>(["hypothesis", "decision", "negative_knowledge", "info"])

interface Source {
	label: string
	content: unknown
	refs: TaskContext["refs"]
	/** Set when the source is a handoff file that must be marked consumed. */
	handoffFile?: string
}

async function findSource(store: TaskContextStore, ctx: TaskContext): Promise<Source | undefined> {
	if (ctx.previous_task_id) {
		try {
			const prev = await store.load(ctx.previous_task_id)
			return {
				label: `previous task ${prev.task_id} (${prev.mode})`,
				content: {
					spec: prev.task.spec,
					refs: prev.refs,
					notes: prev.notes.filter((n) => !n.hidden).map((n) => ({ text: n.text, tags: n.tags })),
				},
				refs: prev.refs,
			}
		} catch {
			// previous task missing: fall through to handoff files
		}
	}
	let files: string[]
	try {
		files = (await fs.readdir(handoffsDir(store.cwd))).filter((f) => f.endsWith(".json"))
	} catch {
		return undefined
	}
	const candidates: { file: string; mtime: number; data: Record<string, unknown> }[] = []
	for (const f of files) {
		const file = path.join(handoffsDir(store.cwd), f)
		try {
			const data = JSON.parse(await fs.readFile(file, "utf8"))
			if (!data.consumed_by) candidates.push({ file, mtime: (await fs.stat(file)).mtimeMs, data })
		} catch {
			// unreadable handoff: skip
		}
	}
	const newest = candidates.sort((a, b) => b.mtime - a.mtime)[0]
	if (!newest) return undefined
	return {
		label: `handoff ${path.basename(newest.file)}`,
		content: newest.data,
		refs: (newest.data.refs as TaskContext["refs"]) ?? [],
		handoffFile: newest.file,
	}
}

/** Carry knowledge from the previous task (or the newest unconsumed handoff) into a new task, once. */
export async function runMigrationIfNeeded(deps: {
	store: TaskContextStore
	taskId: string
	caller: LlmCaller
	profile: Profile
	lastUserMessages: string[]
}): Promise<{ ran: boolean; result?: LlmResult; error?: string }> {
	const { store, taskId, caller, profile } = deps
	const ctx = await store.load(taskId)
	if (ctx.migration.ingested_at) return { ran: false }
	const source = await findSource(store, ctx)
	const markIngested = () =>
		store.update(taskId, (c) => {
			c.migration.ingested_at = new Date().toISOString()
		})
	if (!source) {
		await markIngested()
		return { ran: false }
	}
	if (source.handoffFile) {
		const data = JSON.parse(await fs.readFile(source.handoffFile, "utf8"))
		await fs.writeFile(source.handoffFile, JSON.stringify({ ...data, consumed_by: taskId }, null, 2))
	}
	const input = `SOURCE: ${source.label}\n${JSON.stringify(source.content)}\nOWNER_REQUEST:\n${deps.lastUserMessages.join("\n---\n")}`
	let result: LlmResult | undefined
	let error: string | undefined
	try {
		result = await caller.call(MIGRATION_SYSTEM_PROMPT, input)
	} catch (e) {
		error = `migration call failed: ${e instanceof Error ? e.message : e}`
	}
	let reply:
		| {
				add_refs?: { path: string; start_line: number; end_line: number; why?: string }[]
				add_notes?: { text: string; tags?: string[] }[]
				task_summary?: string
		  }
		| undefined
	if (result) {
		try {
			const t = result.text
			reply = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1))
		} catch {
			error = "migration reply is not JSON"
		}
	}
	await store.update(taskId, (c) => {
		for (const r of reply?.add_refs ?? []) {
			if (typeof r?.path !== "string") continue
			const known = source.refs.find((x) => x.path === r.path && x.start_line === r.start_line && x.end_line === r.end_line)
			c.refs.push({
				id: `r_${randomBytes(4).toString("hex")}`,
				path: r.path,
				start_line: r.start_line,
				end_line: r.end_line,
				sha256: known?.sha256 ?? "",
				why: r.why ?? known?.why ?? "",
				at_turn: 0,
				stale: false,
				resolved: false,
			})
		}
		for (const n of reply?.add_notes ?? []) {
			if (typeof n?.text !== "string") continue
			const tags = (n.tags ?? []).filter((t): t is NoteTag => TAGS.has(t as NoteTag))
			c.notes.push({
				id: `n_${randomBytes(4).toString("hex")}`,
				text: n.text,
				tags: tags.length ? tags : ["info"],
				at_turn: 0,
				hidden: false,
				resolved: false,
				comments: [],
			})
		}
		c.migration.ingested_at = new Date().toISOString()
	})
	await appendAudit(store.cwd, taskId, "knowledge_migrated", { source: source.label, ok: !error })
	return { ran: true, result, error: profile.aux.announce ? error : undefined }
}
