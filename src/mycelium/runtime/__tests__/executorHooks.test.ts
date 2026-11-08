import { describe, it } from "mocha"
import "should"
import type { StageId } from "../../modes/pipelines"
import { evaluateToolPolicy } from "../../modes/toolPolicy"
import { IMPROVED_PROFILE, type Profile, TAO_PROFILE } from "../../profile"
import { commandDecision, exitCodeFromOutput, stageCheck, writeDecision } from "../executorHooks"
import type { MyceliumHooks } from "../types"

const hooks = (profile: Profile, stage: StageId = "data_collection"): MyceliumHooks =>
	({
		profile,
		checkToolCall: (name: string) => evaluateToolPolicy("developer", stage, name, profile),
	}) as unknown as MyceliumHooks
const none = { whitelist: [], blacklist: [], require_approval: [] }

describe("executor hooks", () => {
	it("blocked tool returns an error naming the allowed stages; 3 repeats warn; 5 repeats hit the mistake limit", () => {
		const streaks = new Map<string, number>()
		const first = stageCheck(hooks(TAO_PROFILE), "write_to_file", streaks)
		first.blocked.should.be.true()
		first.message!.should.containEql("development")
		stageCheck(hooks(TAO_PROFILE), "write_to_file", streaks)
		stageCheck(hooks(TAO_PROFILE), "write_to_file", streaks).message!.should.match(/STILL blocked/)
		stageCheck(hooks(TAO_PROFILE), "write_to_file", streaks).hitMistakeLimit.should.be.false()
		stageCheck(hooks(TAO_PROFILE), "write_to_file", streaks).hitMistakeLimit.should.be.true()
		stageCheck(hooks(TAO_PROFILE), "read_file", streaks).blocked.should.be.false()
	})

	it("improved: confirm decision forces an approval; tao: no extra approval; myc tools never forced", () => {
		stageCheck(hooks(IMPROVED_PROFILE, "audit"), "execute_command", new Map()).forceApproval.should.be.true()
		stageCheck(hooks(TAO_PROFILE, "audit"), "execute_command", new Map()).forceApproval.should.be.false()
		stageCheck(hooks(IMPROVED_PROFILE, "audit"), "myc_set_stage", new Map()).forceApproval.should.be.false()
	})

	it("without a Mycelium runtime nothing is blocked or forced", () => {
		const r = stageCheck(undefined, "write_to_file", new Map())
		r.blocked.should.be.false()
		r.forceApproval.should.be.false()
		;(commandDecision(undefined, "sudo x", { safe: true, all: true }, none) === undefined).should.be.true()
		writeDecision(undefined, { existing: "a\n".repeat(400), next: "b", autoAll: false }).should.eql({ kind: "ok" })
	})

	it("asks for a blacklisted command under auto-approve-all in improved, runs it in tao; rm asks in both", () => {
		const all = { safe: true, all: true }
		commandDecision(hooks(IMPROVED_PROFILE), "sudo apt update", all, none)!.should.equal("ask")
		commandDecision(hooks(TAO_PROFILE), "sudo apt update", all, none)!.should.equal("run")
		commandDecision(hooks(TAO_PROFILE), "rm -rf dist", all, none)!.should.equal("ask")
		commandDecision(hooks(IMPROVED_PROFILE), "rm -rf dist", all, none)!.should.equal("ask")
	})

	it("reads an exit code from command output when one is printed", () => {
		exitCodeFromOutput("tests failed\nExit code: 2")!.should.equal(2)
		exitCodeFromOutput("process exited with code 0")!.should.equal(0)
		;(exitCodeFromOutput("all good") === undefined).should.be.true()
	})

	it("write_to_file on an existing 301-line file asks unless auto-approve-all", () => {
		const existing = "x\n".repeat(301)
		writeDecision(hooks(TAO_PROFILE), { existing, next: existing + "y\n", autoAll: false }).kind.should.equal("ask")
		writeDecision(hooks(TAO_PROFILE), { existing, next: existing + "y\n", autoAll: true }).kind.should.equal("ok")
		writeDecision(hooks(TAO_PROFILE), { existing: "small\n", next: "small\nfile\n", autoAll: false }).kind.should.equal("ok")
		writeDecision(hooks(TAO_PROFILE), { existing: undefined, next: "x\n".repeat(500), autoAll: false }).kind.should.equal(
			"ok",
		)
	})

	it("improved denies content under 50% of the original with a clear message; tao allows it", () => {
		const existing = "line of code\n".repeat(100)
		const next = "line of code\n".repeat(30)
		const imp = writeDecision(hooks(IMPROVED_PROFILE), { existing, next, autoAll: true })
		imp.kind.should.equal("deny")
		;(imp as { message: string }).message.should.match(/replace_in_file/)
		writeDecision(hooks(TAO_PROFILE), { existing, next, autoAll: true }).kind.should.equal("ok")
	})
})
