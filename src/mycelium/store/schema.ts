import type { ModeId, StageId } from "../modes/pipelines"
import type { ProfileId } from "../profile"

export const SCHEMA_VERSION = 1

export interface CodeRef {
	id: string
	path: string
	start_line: number
	end_line: number
	/** sha256 of the referenced lines when the ref was recorded (hash anchor). */
	sha256: string
	why: string
	at_turn: number
	stale: boolean
	resolved: boolean
}

export type NoteTag = "hypothesis" | "decision" | "negative_knowledge" | "info" | "user_message"

export interface Note {
	id: string
	text: string
	tags: NoteTag[]
	at_turn: number
	hidden: boolean
	resolved: boolean
	comments: { text: string; at: string }[]
}

export interface PlanItem {
	id: string
	text: string
	status: "todo" | "next" | "in_progress" | "done"
}

export interface StageHistoryEntry {
	from: StageId
	to: StageId
	at: string
	reason: string
	evidence_ids: string[]
	actor: "agent" | "owner" | "extension"
}

export type AcStatus = "pass" | "fail" | "skip" | "pending"

export interface AcRound {
	at: string
	items: { index: number; status: AcStatus; comment?: string }[]
}

export interface CheckRun {
	started_at: string
	duration_ms: number
	exit_code: number | null
	status: "passed" | "failed" | "missing" | "timeout"
	log_path?: string
	source: "extension" | "agent_command"
	command: string
}

export type CallType = "agent" | "update_cycle" | "repair" | "handover" | "migration"
export const CALL_TYPES: readonly CallType[] = ["agent", "update_cycle", "repair", "handover", "migration"]

export interface Bucket {
	count: number
	tokens_in: number
	tokens_out: number
	cache_read: number
	cache_write: number
	cost_usd: number
	model_ms: number
}

export interface TaskMetrics {
	by_type: Record<CallType, Bucket>
	by_stage: Record<string, Bucket>
	/** Calls the profile's own accounting does not count (tao: unapplied repairs, migration). */
	uncounted_in_profile_view: Record<CallType, Bucket>
	wall_ms: number
	tool_ms: number
	check_runs: CheckRun[]
	started_at: string
	ended_at?: string
}

export interface TaskContext {
	schema_version: typeof SCHEMA_VERSION
	task_id: string
	cline_task_id: string
	previous_task_id?: string
	profile: ProfileId
	mode: ModeId
	stage: StageId
	status: "active" | "done"
	created_at: string
	updated_at: string
	stage_history: StageHistoryEntry[]
	exit_criteria: Record<string, boolean>
	task: { spec: string; acceptance_criteria: string[]; constraints: string[]; plan: PlanItem[] }
	ac_rounds: AcRound[]
	refs: CodeRef[]
	notes: Note[]
	changes: { id: string; summary: string; diff_path?: string; at_turn: number }[]
	user_notes: string[]
	execution_log: { at: string; kind: string; detail: string }[]
	update_cycle: { processed_until: number; turn_counter: number; pending_force: boolean }
	repair: { pending_since_turn?: number }
	migration: { ingested_at?: string }
	metrics: TaskMetrics
}

export const emptyBucket = (): Bucket => ({
	count: 0,
	tokens_in: 0,
	tokens_out: 0,
	cache_read: 0,
	cache_write: 0,
	cost_usd: 0,
	model_ms: 0,
})

const bucketsByType = (): Record<CallType, Bucket> =>
	Object.fromEntries(CALL_TYPES.map((t) => [t, emptyBucket()])) as Record<CallType, Bucket>

export const emptyMetrics = (at: string): TaskMetrics => ({
	by_type: bucketsByType(),
	by_stage: {},
	uncounted_in_profile_view: bucketsByType(),
	wall_ms: 0,
	tool_ms: 0,
	check_runs: [],
	started_at: at,
})
