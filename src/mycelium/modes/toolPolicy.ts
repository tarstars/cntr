import type { Profile } from "../profile"
import { HIDDEN_TOOLS, type ModeId, PIPELINES, STAGES, type StageId } from "./pipelines"

export interface ToolPolicyResult {
	decision: "allow" | "deny" | "confirm"
	/** Set for "deny": tells the model where the tool is available. */
	message?: string
	/** Stages of this mode that allow the tool. */
	allowedIn: StageId[]
}

const stagesOf = (mode: ModeId): StageId[] => (mode === "developer" ? [...PIPELINES.developer, "rework"] : [...PIPELINES[mode]])

function allows(stage: StageId, tool: string): boolean {
	const { allow } = STAGES[stage]
	if (allow.has("*")) {
		return tool !== "myc_set_stage"
	}
	return allow.has(tool)
}

/**
 * Whether `tool` may run in `stage`. Pure lookup over STAGES; "confirm" is returned only when the
 * profile makes the stage's "needs confirmation" flags effective (improved), otherwise "allow" (tao).
 */
export function evaluateToolPolicy(mode: ModeId, stage: StageId, tool: string, profile: Profile): ToolPolicyResult {
	const allowedIn = stagesOf(mode).filter((s) => !HIDDEN_TOOLS.has(tool) && allows(s, tool))
	if (HIDDEN_TOOLS.has(tool) || !allows(stage, tool)) {
		const where = allowedIn.length
			? `It is available in: ${allowedIn.join(", ")}. Use myc_set_stage to move to the right stage instead.`
			: "It is not available in this mode."
		return { decision: "deny", message: `Tool '${tool}' is blocked in stage '${stage}'. ${where}`, allowedIn }
	}
	if (profile.stages.confirmFlagsEffective && STAGES[stage].requireConfirm.has(tool)) {
		return { decision: "confirm", allowedIn }
	}
	return { decision: "allow", allowedIn }
}
