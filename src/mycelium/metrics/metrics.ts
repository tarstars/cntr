import type { LlmResult } from "../llm/LlmCaller"
import {
	type Bucket,
	CALL_TYPES,
	type CallType,
	type CheckRun,
	emptyBucket,
	type TaskContext,
	type TaskMetrics,
} from "../store/schema"

function add(b: Bucket, r: LlmResult): void {
	b.count += 1
	b.tokens_in += r.usage.input
	b.tokens_out += r.usage.output
	b.cache_read += r.usage.cacheRead
	b.cache_write += r.usage.cacheWrite
	b.cost_usd += r.usage.costUsd ?? 0
	b.model_ms += r.durationMs
}

export function sumBuckets(buckets: Bucket[]): Bucket {
	const out = emptyBucket()
	for (const b of buckets) {
		for (const k of Object.keys(out) as (keyof Bucket)[]) out[k] += b[k]
	}
	return out
}

/**
 * Record one model call. Every call is counted in by_type and by_stage; `counted: false` additionally
 * files it under uncounted_in_profile_view (calls the profile's own accounting leaves out).
 */
export function recordCall(
	ctx: TaskContext,
	call: { type: CallType; stage: string; result: LlmResult; counted: boolean },
): TaskContext {
	const next = structuredClone(ctx)
	const m = next.metrics
	add(m.by_type[call.type], call.result)
	m.by_stage[call.stage] ??= emptyBucket()
	add(m.by_stage[call.stage], call.result)
	if (!call.counted) add(m.uncounted_in_profile_view[call.type], call.result)
	return next
}

export function addToolTime(ctx: TaskContext, ms: number): TaskContext {
	const next = structuredClone(ctx)
	next.metrics.tool_ms += Math.max(0, ms)
	return next
}

export function addCheckRun(ctx: TaskContext, run: CheckRun): TaskContext {
	const next = structuredClone(ctx)
	next.metrics.check_runs.push(run)
	return next
}

/** Close the task: wall time = end − start. */
export function finishTask(ctx: TaskContext, at: string): TaskContext {
	const next = structuredClone(ctx)
	next.metrics.ended_at = at
	next.metrics.wall_ms = Math.max(0, Date.parse(at) - Date.parse(next.metrics.started_at))
	return next
}

/** Every model call the task made. */
export const allCallsView = (m: TaskMetrics): Bucket => sumBuckets(CALL_TYPES.map((t) => m.by_type[t]))

/** What the profile's own accounting reports (all calls minus the uncounted ones). */
export function profileView(m: TaskMetrics): Bucket {
	const all = allCallsView(m)
	const un = sumBuckets(CALL_TYPES.map((t) => m.uncounted_in_profile_view[t]))
	for (const k of Object.keys(all) as (keyof Bucket)[]) all[k] -= un[k]
	return all
}
