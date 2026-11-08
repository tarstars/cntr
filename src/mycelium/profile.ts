import fs from "node:fs/promises"
import { profileFile } from "./paths"

export type ProfileId = "tao" | "improved"

/**
 * Every behaviour that differs between the `tao` and `improved` profiles is a field here.
 * Code reads these fields and never branches on the profile id.
 */
export interface Profile {
	id: ProfileId
	updateCycle: {
		/** tao: count user-role API messages (each tool result counts); improved: assistant replies or history tokens. */
		trigger: "user_role_messages" | "exchanges_or_tokens"
		batchSize: number
		tokenThreshold: number
		includeAssistantText: boolean
		/** Max turns fed to the extractor. */
		windowTurns: number
		/** tao re-reads the transcript from turn 0; improved reads only unprocessed turns. */
		fromTurnZero: boolean
	}
	history: { afterCycle: "truncate" | "keep"; keepMessages: number; windowMaxTokens: number }
	notes: { dropPathMentions: boolean; resolveDeletes: boolean }
	kernel: {
		feedBudgeted: boolean
		snippetSelection: "oldest" | "recent"
		cacheBetweenCycles: boolean
		planInKernel: boolean
		maxSnippets: number
		maxSnippetLines: number
		hotBudgetTokens: number
	}
	stages: {
		allowSkip: boolean
		gate: "no_false" | "all_true"
		checkAllVerifiedByExtension: boolean
		evidenceAlwaysValidated: boolean
		confirmFlagsEffective: boolean
		leaveAuditAsksOwner: boolean
	}
	commands: { classifyAllSegments: boolean; interpretersSafe: boolean; autoApproveAllRunsBlacklisted: boolean }
	files: { largeRewriteLines: number; truncationGuard: boolean; truncationRatio: number }
	aux: { countRepairOnlyWhenApplied: boolean; countMigration: boolean; announce: boolean }
}

/** Behaves like TAO·CODER 3.1.2 by design (see docs/tao-behaviour.md). */
export const TAO_PROFILE: Profile = Object.freeze({
	id: "tao",
	updateCycle: {
		trigger: "user_role_messages",
		batchSize: 5,
		tokenThreshold: Number.POSITIVE_INFINITY,
		includeAssistantText: false,
		windowTurns: 30,
		fromTurnZero: true,
	},
	history: { afterCycle: "truncate", keepMessages: 20, windowMaxTokens: 50000 },
	notes: { dropPathMentions: true, resolveDeletes: true },
	kernel: {
		feedBudgeted: false,
		snippetSelection: "oldest",
		cacheBetweenCycles: true,
		planInKernel: false,
		maxSnippets: 25,
		maxSnippetLines: 150,
		hotBudgetTokens: 50000,
	},
	stages: {
		allowSkip: true,
		gate: "no_false",
		checkAllVerifiedByExtension: false,
		evidenceAlwaysValidated: false,
		confirmFlagsEffective: false,
		leaveAuditAsksOwner: false,
	},
	commands: { classifyAllSegments: false, interpretersSafe: true, autoApproveAllRunsBlacklisted: true },
	files: { largeRewriteLines: 300, truncationGuard: false, truncationRatio: 0.5 },
	aux: { countRepairOnlyWhenApplied: true, countMigration: false, announce: false },
} as Profile)

/** TAO's ideas with the weaknesses found in the analysis fixed. */
export const IMPROVED_PROFILE: Profile = Object.freeze({
	id: "improved",
	updateCycle: {
		trigger: "exchanges_or_tokens",
		batchSize: 4,
		tokenThreshold: 30000,
		includeAssistantText: true,
		windowTurns: 30,
		fromTurnZero: false,
	},
	history: { afterCycle: "keep", keepMessages: 20, windowMaxTokens: 50000 },
	notes: { dropPathMentions: false, resolveDeletes: false },
	kernel: {
		feedBudgeted: true,
		snippetSelection: "recent",
		cacheBetweenCycles: false,
		planInKernel: true,
		maxSnippets: 25,
		maxSnippetLines: 150,
		hotBudgetTokens: 50000,
	},
	stages: {
		allowSkip: false,
		gate: "all_true",
		checkAllVerifiedByExtension: true,
		evidenceAlwaysValidated: true,
		confirmFlagsEffective: true,
		leaveAuditAsksOwner: true,
	},
	commands: { classifyAllSegments: true, interpretersSafe: false, autoApproveAllRunsBlacklisted: false },
	files: { largeRewriteLines: 300, truncationGuard: true, truncationRatio: 0.5 },
	aux: { countRepairOnlyWhenApplied: false, countMigration: true, announce: true },
} as Profile)

export const DEFAULT_PROFILE_ID: ProfileId = "improved"

export function getProfile(id: ProfileId): Profile {
	return id === "tao" ? TAO_PROFILE : IMPROVED_PROFILE
}

const isProfileId = (v: unknown): v is ProfileId => v === "tao" || v === "improved"

export interface WorkspaceSettings {
	profile: ProfileId
	defaultMode?: string
	/** Set when profile.json exists but could not be used; the caller shows it to the user. */
	warning?: string
}

/** Reads `.mycelium/profile.json` ({ "profile": "tao" | "improved", "defaultMode"?: string }). */
export async function readWorkspaceSettings(cwd: string): Promise<WorkspaceSettings> {
	let raw: string
	try {
		raw = await fs.readFile(profileFile(cwd), "utf8")
	} catch {
		return { profile: DEFAULT_PROFILE_ID }
	}
	try {
		const parsed = JSON.parse(raw)
		const defaultMode = typeof parsed?.defaultMode === "string" ? parsed.defaultMode : undefined
		if (!isProfileId(parsed?.profile)) {
			return {
				profile: DEFAULT_PROFILE_ID,
				defaultMode,
				warning: `.mycelium/profile.json has an unknown profile ${JSON.stringify(parsed?.profile)}; using "${DEFAULT_PROFILE_ID}".`,
			}
		}
		return { profile: parsed.profile, defaultMode }
	} catch (error) {
		return {
			profile: DEFAULT_PROFILE_ID,
			warning: `.mycelium/profile.json is not valid JSON (${error instanceof Error ? error.message : error}); using "${DEFAULT_PROFILE_ID}".`,
		}
	}
}

export async function resolveProfile(cwd: string, taskOverride?: ProfileId): Promise<Profile> {
	if (taskOverride) {
		return getProfile(taskOverride)
	}
	return getProfile((await readWorkspaceSettings(cwd)).profile)
}
