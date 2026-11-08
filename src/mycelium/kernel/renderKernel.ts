import { latestAcStatuses } from "../gate/stageGate"
import { MODE_PREAMBLE } from "../modes/contracts"
import { STAGES } from "../modes/pipelines"
import type { Profile } from "../profile"
import { KERNEL_ALGORITHM, KERNEL_HEADER, KERNEL_LEGEND } from "../prompts/kernelText"
import type { TaskContext } from "../store/schema"
import type { Snippet } from "./snippets"

/** Token estimate: ~4 ASCII characters per token, ~2 for other scripts (Cyrillic, CJK, …). */
export function estimateTokens(text: string): number {
	let nonAscii = 0
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) > 127) nonAscii++
	}
	return Math.ceil((text.length - nonAscii) / 4 + nonAscii / 2)
}

export interface KernelInputs {
	readmeAi?: string
	recentTasks: string[]
	snippets: Snippet[]
	systemInfo: string
}

interface FeedItem {
	turn: number
	text: string
}

function feedItems(ctx: TaskContext, snippets: Snippet[]): FeedItem[] {
	const byRef = new Map(snippets.map((s) => [s.ref.id, s]))
	const items: FeedItem[] = []
	for (const r of ctx.refs) {
		const s = byRef.get(r.id)
		const flag = s?.broken ? " [BROKEN]" : r.stale || (s && !s.hashMatches) ? " [STALE]" : ""
		const code = s && !s.broken ? `\n${s.text}` : ""
		items.push({
			turn: r.at_turn,
			text: `[ref ${r.id}]${flag} ${r.path}:${r.start_line}-${r.end_line} — ${r.why}${r.resolved ? " (resolved)" : ""}${code}`,
		})
	}
	for (const n of ctx.notes) {
		if (n.hidden) continue
		const comments = n.comments.map((c) => `\n  ↳ ${c.text}`).join("")
		items.push({
			turn: n.at_turn,
			text: `[note ${n.id} ${n.tags.map((t) => `#${t}`).join(" ")}]${n.resolved ? " (resolved)" : ""} ${n.text}${comments}`,
		})
	}
	for (const c of ctx.changes) {
		items.push({ turn: c.at_turn, text: `[change ${c.id}] ${c.summary}${c.diff_path ? ` (diff: ${c.diff_path})` : ""}` })
	}
	return items.sort((a, b) => b.turn - a.turn)
}

function taskSection(ctx: TaskContext): string {
	const verdicts = latestAcStatuses(ctx)
	const acs = ctx.task.acceptance_criteria.map((a, i) => {
		const v = verdicts.get(i)
		return `  ${i}. ${a}${v ? ` — [${v.status}]${v.comment ? ` ${v.comment}` : ""}` : " — [pending]"}`
	})
	return [
		"## Task",
		`Spec: ${ctx.task.spec || "(empty — write it with myc_update_task_spec)"}`,
		"Acceptance criteria:",
		...(acs.length ? acs : ["  (none yet)"]),
		`Constraints: ${ctx.task.constraints.length ? ctx.task.constraints.join("; ") : "(none yet)"}`,
	].join("\n")
}

/**
 * Render the memory kernel. tao: the feed is outside the budget and the sections after it are cut,
 * last first, once the budget is spent. improved: every section counts; the feed gets what is left
 * and loses its oldest items first.
 */
export function renderKernel(ctx: TaskContext, inputs: KernelInputs, profile: Profile): string {
	const budget = profile.kernel.hotBudgetTokens * 4
	const stage = STAGES[ctx.stage]
	const criteria = Object.entries(stage.exitCriteria).map(
		([k, meaning]) => `- [${ctx.exit_criteria[k] ? "x" : " "}] ${k}: ${meaning}`,
	)
	const later: string[] = [
		`## Stage\nMode: ${ctx.mode} · Stage: ${ctx.stage}\n${MODE_PREAMBLE[ctx.mode]}`,
		taskSection(ctx),
		...(profile.kernel.planInKernel
			? [`## Plan\n${ctx.task.plan.map((p) => `- [${p.status}] ${p.id}: ${p.text}`).join("\n") || "(empty)"}`]
			: []),
		`## System\n${inputs.systemInfo}`,
		...(inputs.readmeAi ? [`## Project bible (README_AI.md)\n${inputs.readmeAi}`] : []),
		...(inputs.recentTasks.length ? [`## Recent finished tasks\n${inputs.recentTasks.join("\n\n")}`] : []),
		`## Algorithm\n${KERNEL_ALGORITHM}`,
		`## Stage contract (${ctx.stage})\n${stage.contract}`,
		`## Exit criteria (${ctx.stage})\n${criteria.join("\n")}`,
		`## Legend\n${KERNEL_LEGEND}`,
	]
	const items = feedItems(ctx, inputs.snippets).map((i) => i.text)
	const feedHeading = "## Memory feed (newest first)"

	if (!profile.kernel.feedBudgeted) {
		let out = [KERNEL_HEADER, feedHeading, ...items].join("\n\n")
		for (const section of later) {
			if (out.length + 2 + section.length > budget) break
			out += `\n\n${section}`
		}
		return out
	}

	const fixedLength = [KERNEL_HEADER, feedHeading, ...later].join("\n\n").length
	let room = budget - fixedLength
	const kept: string[] = []
	for (const item of items) {
		if (item.length + 2 > room) break
		kept.push(item)
		room -= item.length + 2
	}
	const dropped = items.length - kept.length
	const feed = dropped ? [...kept, `(${dropped} older items not shown)`] : kept
	return [KERNEL_HEADER, feedHeading, ...feed, ...later].join("\n\n")
}
