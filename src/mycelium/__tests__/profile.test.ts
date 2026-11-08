import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { profileFile } from "../paths"
import { getProfile, IMPROVED_PROFILE, readWorkspaceSettings, resolveProfile, TAO_PROFILE } from "../profile"

describe("Mycelium profiles", () => {
	let cwd: string

	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-profile-"))
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})

	async function writeProfileJson(content: string) {
		await fs.mkdir(path.dirname(profileFile(cwd)), { recursive: true })
		await fs.writeFile(profileFile(cwd), content)
	}

	it("defaults to improved without profile.json", async () => {
		;(await resolveProfile(cwd)).id.should.equal("improved")
	})

	it('reads profile.json {"profile":"tao"}', async () => {
		await writeProfileJson('{"profile":"tao","defaultMode":"architect"}')
		;(await resolveProfile(cwd)).id.should.equal("tao")
		;(await readWorkspaceSettings(cwd)).defaultMode!.should.equal("architect")
	})

	it("task override wins", async () => {
		await writeProfileJson('{"profile":"tao"}')
		;(await resolveProfile(cwd, "improved")).id.should.equal("improved")
	})

	it("invalid profile.json falls back to improved and reports a warning", async () => {
		await writeProfileJson('{"profile":"fast"}')
		const settings = await readWorkspaceSettings(cwd)
		settings.profile.should.equal("improved")
		settings.warning!.should.match(/profile\.json/)
		await writeProfileJson("{not json")
		;(await readWorkspaceSettings(cwd)).warning!.should.match(/profile\.json/)
	})

	it("tao and improved differ exactly in the documented fields", () => {
		getProfile("tao").should.equal(TAO_PROFILE)
		TAO_PROFILE.should.eql({
			id: "tao",
			updateCycle: {
				trigger: "user_role_messages",
				batchSize: 5,
				tokenThreshold: Number.POSITIVE_INFINITY,
				includeAssistantText: false,
				windowTurns: 30,
				fromTurnZero: true,
				backoffOnFailure: false,
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
			commands: {
				classifyAllSegments: false,
				interpretersSafe: true,
				autoApproveAllRunsBlacklisted: true,
				strictShell: false,
			},
			files: { largeRewriteLines: 300, truncationGuard: false, truncationRatio: 0.5 },
			aux: { countRepairOnlyWhenApplied: true, countMigration: false, announce: false },
		})
		IMPROVED_PROFILE.should.eql({
			id: "improved",
			updateCycle: {
				trigger: "exchanges_or_tokens",
				batchSize: 4,
				tokenThreshold: 30000,
				includeAssistantText: true,
				windowTurns: 30,
				fromTurnZero: false,
				backoffOnFailure: true,
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
			commands: {
				classifyAllSegments: true,
				interpretersSafe: false,
				autoApproveAllRunsBlacklisted: false,
				strictShell: true,
			},
			files: { largeRewriteLines: 300, truncationGuard: true, truncationRatio: 0.5 },
			aux: { countRepairOnlyWhenApplied: false, countMigration: true, announce: true },
		})
	})
})
