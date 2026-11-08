import { readWorkspaceSettings } from "../profile"
import type { Bucket, CallType, CheckRun, StageHistoryEntry } from "../store/schema"
import { CALL_TYPES, emptyBucket } from "../store/schema"
import { TaskContextStore } from "../store/TaskContextStore"
import { allCallsView, profileView, sumBuckets } from "./metrics"

export interface TaskSummary {
	task_id: string
	mode: string
	profile: string
	status: string
	stage: string
	spec: string
	stage_history: StageHistoryEntry[]
	profile_view: Bucket
	all_calls: Bucket
	wall_ms: number
	tool_ms: number
	check_runs: CheckRun[]
}

export interface WorkspaceSummary {
	workspace: string
	workspace_profile: string
	generated_at: string
	tasks: TaskSummary[]
	totals: {
		profile_view: Bucket
		all_calls: Bucket
		by_type: Record<CallType, Bucket>
		by_stage: Record<string, Bucket>
		wall_ms: number
		tool_ms: number
	}
	check_runs: { total: number; passed: number; failed: number; other: number }
}

export async function aggregateWorkspace(cwd: string): Promise<WorkspaceSummary> {
	const tasks = (await new TaskContextStore(cwd).listTasks()).sort((a, b) => a.created_at.localeCompare(b.created_at))
	const byType = Object.fromEntries(CALL_TYPES.map((t) => [t, sumBuckets(tasks.map((x) => x.metrics.by_type[t]))])) as Record<
		CallType,
		Bucket
	>
	const byStage: Record<string, Bucket> = {}
	for (const t of tasks) {
		for (const [stage, b] of Object.entries(t.metrics.by_stage)) {
			byStage[stage] = sumBuckets([byStage[stage] ?? emptyBucket(), b])
		}
	}
	const runs = tasks.flatMap((t) => t.metrics.check_runs)
	return {
		workspace: cwd,
		workspace_profile: (await readWorkspaceSettings(cwd)).profile,
		generated_at: new Date().toISOString(),
		tasks: tasks.map((t) => ({
			task_id: t.task_id,
			mode: t.mode,
			profile: t.profile,
			status: t.status,
			stage: t.stage,
			spec: t.task.spec,
			stage_history: t.stage_history,
			profile_view: profileView(t.metrics),
			all_calls: allCallsView(t.metrics),
			wall_ms: t.metrics.wall_ms,
			tool_ms: t.metrics.tool_ms,
			check_runs: t.metrics.check_runs,
		})),
		totals: {
			profile_view: sumBuckets(tasks.map((t) => profileView(t.metrics))),
			all_calls: sumBuckets(tasks.map((t) => allCallsView(t.metrics))),
			by_type: byType,
			by_stage: byStage,
			wall_ms: tasks.reduce((a, t) => a + t.metrics.wall_ms, 0),
			tool_ms: tasks.reduce((a, t) => a + t.metrics.tool_ms, 0),
		},
		check_runs: {
			total: runs.length,
			passed: runs.filter((r) => r.status === "passed").length,
			failed: runs.filter((r) => r.status === "failed").length,
			other: runs.filter((r) => r.status !== "passed" && r.status !== "failed").length,
		},
	}
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ENTITIES[c])
const hours = (ms: number) => `${(ms / 3_600_000).toFixed(2)} h`
const BUCKET_HEAD =
	"<tr><th></th><th>calls</th><th>tokens in</th><th>tokens out</th><th>cache read</th><th>cost</th><th>model time</th></tr>"
const bucketRow = (label: string, b: Bucket) =>
	`<tr><th>${esc(label)}</th><td>${b.count}</td><td>${b.tokens_in}</td><td>${b.tokens_out}</td><td>${b.cache_read}</td><td>$${b.cost_usd.toFixed(4)}</td><td>${hours(b.model_ms)}</td></tr>`

/** A single static HTML page (no scripts, no external assets) summarising a workspace. */
export function renderSummaryHtml(s: WorkspaceSummary): string {
	const taskRows = s.tasks
		.map(
			(t) =>
				`<tr><td>${esc(t.task_id)}</td><td>${esc(t.mode)}</td><td>${esc(t.profile)}</td><td>${esc(t.status)}</td><td>${esc(t.stage)}</td><td>${t.all_calls.count}</td><td>${hours(t.all_calls.model_ms)}</td><td>${hours(t.wall_ms)}</td><td>${esc(t.spec.slice(0, 120))}</td></tr>`,
		)
		.join("\n")
	const runRows = s.tasks
		.flatMap((t) =>
			t.check_runs.map(
				(r) =>
					`<tr><td>${esc(t.task_id)}</td><td>${esc(r.started_at)}</td><td>${esc(r.source)}</td><td>${esc(r.status)}</td><td>${r.exit_code ?? "–"}</td><td>${esc(r.log_path ?? "")}</td></tr>`,
			),
		)
		.join("\n")
	const typeRows = Object.entries(s.totals.by_type)
		.map(([k, b]) => bucketRow(k, b))
		.join("")
	const stageRows = Object.entries(s.totals.by_stage)
		.map(([k, b]) => bucketRow(k, b))
		.join("")
	return `<!doctype html><html><head><meta charset="utf-8"><title>Mycelium summary</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#1b2329}table{border-collapse:collapse;margin:8px 0 24px}th,td{border-bottom:1px solid #ccd;padding:4px 10px;text-align:left}td{font-variant-numeric:tabular-nums}</style></head><body>
<h1>Mycelium summary</h1>
<p>Workspace <code>${esc(s.workspace)}</code> · profile <b>${esc(s.workspace_profile)}</b> · ${s.tasks.length} tasks · generated ${esc(s.generated_at)}</p>
<h2>Totals</h2><table>${BUCKET_HEAD}${bucketRow("as the profile reports", s.totals.profile_view)}${bucketRow("all model calls", s.totals.all_calls)}</table>
<p>Wall time ${hours(s.totals.wall_ms)} · tool time ${hours(s.totals.tool_ms)} · check runs ${s.check_runs.passed}/${s.check_runs.total} passed</p>
<h2>By call type</h2><table>${BUCKET_HEAD}${typeRows}</table>
<h2>By stage</h2><table>${BUCKET_HEAD}${stageRows}</table>
<h2>Tasks</h2><table><tr><th>task</th><th>mode</th><th>profile</th><th>status</th><th>stage</th><th>calls</th><th>model time</th><th>wall time</th><th>spec</th></tr>${taskRows}</table>
<h2>check_all.sh runs</h2><table><tr><th>task</th><th>started</th><th>source</th><th>status</th><th>exit code</th><th>log</th></tr>${runRows}</table>
</body></html>
`
}
