import { describe, it } from "mocha"
import "should"
import { IMPROVED_PROFILE, TAO_PROFILE } from "../../profile"
import { MYCELIUM_TOOLS, PIPELINES } from "../pipelines"
import { evaluateToolPolicy } from "../toolPolicy"

const dev = (stage: Parameters<typeof evaluateToolPolicy>[1], tool: string, p = IMPROVED_PROFILE) =>
	evaluateToolPolicy("developer", stage, tool, p).decision

describe("Mycelium tool policy", () => {
	it("developer stage tool table matches the documented table", () => {
		for (const s of ["clarification", "data_collection", "audit", "report"] as const)
			dev(s, "write_to_file").should.equal("deny")
		for (const s of ["development", "rework"] as const) dev(s, "write_to_file").should.equal("allow")
		for (const s of ["development", "rework"] as const) dev(s, "execute_command").should.equal("allow")
		for (const s of ["clarification", "data_collection", "audit"] as const) dev(s, "execute_command").should.equal("confirm")
		dev("report", "execute_command").should.equal("deny")
		dev("report", "attempt_completion").should.equal("allow")
		for (const s of ["clarification", "data_collection", "development", "audit", "rework"] as const)
			dev(s, "attempt_completion").should.equal("deny")
	})

	it("disallowed tool message names the allowing stages", () => {
		const r = evaluateToolPolicy("developer", "data_collection", "write_to_file", IMPROVED_PROFILE)
		r.message!.should.containEql("development")
		r.allowedIn.should.containDeep(["development", "rework"])
	})

	it("tao reports confirm-flagged tools as allow, improved reports them as confirm", () => {
		dev("audit", "execute_command", TAO_PROFILE).should.equal("allow")
		dev("audit", "execute_command", IMPROVED_PROFILE).should.equal("confirm")
	})

	it("free mode allows everything except myc_set_stage", () => {
		for (const tool of ["write_to_file", "execute_command", "attempt_completion", "browser_action", "myc_add_note"])
			evaluateToolPolicy("free", "execution", tool, IMPROVED_PROFILE).decision.should.equal("allow")
		evaluateToolPolicy("free", "execution", "myc_set_stage", IMPROVED_PROFILE).decision.should.equal("deny")
	})

	it("every myc_* tool is allowed in every stage except myc_set_stage in free", () => {
		for (const [mode, stages] of Object.entries(PIPELINES)) {
			for (const stage of stages) {
				for (const tool of MYCELIUM_TOOLS) {
					if (mode === "free" && tool === "myc_set_stage") continue
					evaluateToolPolicy(mode as keyof typeof PIPELINES, stage, tool, TAO_PROFILE).decision.should.not.equal("deny")
				}
			}
		}
	})

	it("Cline plan/act and focus-chain tools are never offered", () => {
		for (const tool of ["plan_mode_respond", "act_mode_respond", "focus_chain"]) {
			dev("development", tool).should.equal("deny")
			evaluateToolPolicy("free", "execution", tool, IMPROVED_PROFILE).decision.should.equal("deny")
		}
	})
})
