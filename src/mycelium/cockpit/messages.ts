import fs from "node:fs/promises"
import path from "node:path"
import { STAGES } from "../modes/pipelines"
import { taskDir } from "../paths"
import { getProfile } from "../profile"
import { appendAudit } from "../store/audit"
import type { PlanItem, TaskContext } from "../store/schema"
import type { TaskContextStore } from "../store/TaskContextStore"

/** Messages the Cockpit webview sends. */
export type CockpitMessage =
	| { type: "load" }
	| { type: "editSpec"; spec: string }
	| { type: "editAcceptance"; items: string[] }
	| { type: "editConstraints"; items: string[] }
	| { type: "editPlan"; items: { text: string; status?: string }[] }
	| { type: "toggleExitCriterion"; key: string; value: boolean }
	| { type: "snapshot" }
	| { type: "rollback"; snapshotId: string }

export interface CockpitState {
	ctx?: TaskContext
	tasks: { task_id: string; mode: string; stage: string; status: string; updated_at: string; spec: string }[]
	snapshots: string[]
	error?: string
}

const STATUSES = new Set(["todo", "next", "in_progress", "done"])

async function listSnapshots(store: TaskContextStore, taskId: string): Promise<string[]> {
	try {
		return (await fs.readdir(path.join(taskDir(store.cwd, taskId), "snapshots")))
			.filter((f) => f.endsWith(".json"))
			.map((f) => f.slice(0, -5))
			.sort()
			.reverse()
	} catch {
		return []
	}
}

/** Apply one Cockpit action for `taskId` and return what the panel should show next. */
export async function handleCockpitMessage(store: TaskContextStore, taskId: string, msg: CockpitMessage): Promise<CockpitState> {
	let error: string | undefined
	try {
		switch (msg.type) {
			case "load":
				break
			case "editSpec":
				await store.update(taskId, (c) => {
					c.task.spec = msg.spec
				})
				break
			case "editAcceptance":
				await store.update(taskId, (c) => {
					c.task.acceptance_criteria = msg.items.map(String).filter((s) => s.trim())
				})
				break
			case "editConstraints":
				await store.update(taskId, (c) => {
					c.task.constraints = msg.items.map(String).filter((s) => s.trim())
				})
				break
			case "editPlan":
				await store.update(taskId, (c) => {
					c.task.plan = msg.items.map((it, i) => ({
						id: `owner_${i + 1}`,
						text: String(it.text),
						status: (STATUSES.has(it.status ?? "") ? it.status : "todo") as PlanItem["status"],
					}))
				})
				break
			case "toggleExitCriterion": {
				const ctx = await store.load(taskId)
				if (msg.key === "check_all_passed" && getProfile(ctx.profile).stages.checkAllVerifiedByExtension) {
					error =
						"check_all_passed is set by Mycelium when it runs check_all.sh during a stage change; it cannot be ticked by hand in this profile."
					break
				}
				if (!(msg.key in STAGES[ctx.stage].exitCriteria)) {
					error = `'${msg.key}' is not an exit criterion of stage '${ctx.stage}'.`
					break
				}
				await store.update(taskId, (c) => {
					c.exit_criteria[msg.key] = msg.value
				})
				await appendAudit(store.cwd, taskId, "owner_set_exit_criterion", { key: msg.key, value: msg.value })
				break
			}
			case "snapshot":
				await store.snapshot(taskId, "cockpit")
				break
			case "rollback":
				await store.rollback(taskId, msg.snapshotId)
				break
		}
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
	}
	const all = await store.listTasks()
	return {
		ctx: all.find((t) => t.task_id === taskId),
		tasks: all
			.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
			.map((t) => ({
				task_id: t.task_id,
				mode: t.mode,
				stage: t.stage,
				status: t.status,
				updated_at: t.updated_at,
				spec: t.task.spec,
			})),
		snapshots: await listSnapshots(store, taskId),
		error,
	}
}
