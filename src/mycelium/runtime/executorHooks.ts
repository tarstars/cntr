// Decisions Cline's executor and handlers ask Mycelium for. Pure functions; the Cline-side glue in
// ToolExecutor, ExecuteCommandToolHandler and WriteToFileToolHandler only applies the answers.
import { type CommandRules, classifyCommand, decideCommand } from "../safety/commandSafety"
import type { MyceliumHooks } from "./types"

export interface StageCheckOutcome {
	blocked: boolean
	message?: string
	/** improved: the stage flags this tool "needs confirmation", so auto-approval must not apply. */
	forceApproval: boolean
	/** The model has hit a blocked tool 5 times in a row: escalate to Cline's mistake limit. */
	hitMistakeLimit: boolean
}

const WARN_AFTER = 3
const LIMIT_AFTER = 5

/** Stage re-check at execution time; `streaks` counts consecutive blocked calls per tool name. */
export function stageCheck(hooks: MyceliumHooks | undefined, toolName: string, streaks: Map<string, number>): StageCheckOutcome {
	if (!hooks) return { blocked: false, forceApproval: false, hitMistakeLimit: false }
	const verdict = hooks.checkToolCall(toolName)
	if (verdict.decision === "deny") {
		const streak = (streaks.get(toolName) ?? 0) + 1
		streaks.set(toolName, streak)
		const again =
			streak >= WARN_AFTER ? ` STILL blocked after ${streak} attempts — do not call ${toolName} again in this stage.` : ""
		return {
			blocked: true,
			message: `${verdict.message}${again}`,
			forceApproval: false,
			hitMistakeLimit: streak >= LIMIT_AFTER,
		}
	}
	streaks.delete(toolName)
	return {
		blocked: false,
		forceApproval: verdict.decision === "confirm" && !toolName.startsWith("myc_"),
		hitMistakeLimit: false,
	}
}

/** Whether a shell command may run without asking; `undefined` means "no Mycelium: use Cline's own rule". */
export function commandDecision(
	hooks: MyceliumHooks | undefined,
	command: string,
	auto: { safe: boolean; all: boolean },
	rules: CommandRules,
): "run" | "ask" | undefined {
	if (!hooks) return undefined
	return decideCommand(classifyCommand(command, rules, hooks.profile), command, auto, hooks.profile)
}

/** Exit code printed in command output, when the terminal shows one. */
export function exitCodeFromOutput(output: string): number | undefined {
	const m = output.match(/exit(?:ed)?(?: with)? code[:\s]+(\d+)/i)
	return m ? Number(m[1]) : undefined
}

export type WriteDecision = { kind: "ok" } | { kind: "ask" } | { kind: "deny"; message: string }

const lineCount = (s: string) => s.split(/\r?\n/).length

/**
 * Rewriting an existing file: over `largeRewriteLines` lines asks the owner unless auto-approve-all;
 * improved also refuses a rewrite that keeps less than `truncationRatio` of the original.
 */
export function writeDecision(
	hooks: MyceliumHooks | undefined,
	file: { existing: string | undefined; next: string; autoAll: boolean },
): WriteDecision {
	if (!hooks || file.existing === undefined) return { kind: "ok" }
	const { largeRewriteLines, truncationGuard, truncationRatio } = hooks.profile.files
	if (truncationGuard && file.next.length < file.existing.length * truncationRatio) {
		return {
			kind: "deny",
			message: `Refused: the new content is less than ${Math.round(truncationRatio * 100)}% of the existing file, which usually means part of it was lost. Change the file with replace_in_file, or write the complete content.`,
		}
	}
	if (Math.max(lineCount(file.existing), lineCount(file.next)) > largeRewriteLines && !file.autoAll) {
		return { kind: "ask" }
	}
	return { kind: "ok" }
}
