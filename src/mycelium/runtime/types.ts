import type { GateDeps } from "../gate/stageGate"
import type { ToolPolicyResult } from "../modes/toolPolicy"
import type { Profile } from "../profile"
import type { TaskContextStore } from "../store/TaskContextStore"

/**
 * What Cline's tool executor and the myc_* handlers need from the current task's Mycelium runtime.
 * MyceliumTaskRuntime implements it; tests use plain objects.
 */
export interface MyceliumHooks {
	cwd: string
	taskId: string
	profile: Profile
	store: TaskContextStore
	gateDeps(): GateDeps
	checkToolCall(name: string): ToolPolicyResult
	onCommandFinished(command: string, exitCode: number | undefined, output: string): Promise<void>
	onToolFinished(ms: number): Promise<void>
	/** Memory changed in a way the cached kernel must reflect. */
	invalidateKernel(): void
	/** attempt_completion succeeded: close the task's metrics and mark it done. */
	onTaskCompleted(): Promise<void>
}
