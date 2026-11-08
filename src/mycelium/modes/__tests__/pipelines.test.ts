import { describe, it } from "mocha"
import "should"
import { PIPELINES, STAGES } from "../pipelines"

describe("Mycelium pipelines", () => {
	it("every pipeline stage has a non-empty contract, at least 2 exit criteria and an allowlist", () => {
		const stages = [...Object.values(PIPELINES).flat(), "rework" as const]
		for (const id of stages) {
			const s = STAGES[id]
			s.contract.length.should.be.above(40, `contract of ${id}`)
			Object.keys(s.exitCriteria).length.should.be.aboveOrEqual(2, `criteria of ${id}`)
			s.allow.size.should.be.above(0, `allowlist of ${id}`)
			for (const desc of Object.values(s.exitCriteria)) desc.length.should.be.above(5)
		}
	})

	it("development exit criteria include check_all_passed, tests_added, implementation_done", () => {
		Object.keys(STAGES.development.exitCriteria).should.containDeep([
			"check_all_passed",
			"tests_added",
			"implementation_done",
		])
	})

	it("pipelines follow the documented order", () => {
		PIPELINES.developer.should.eql(["clarification", "data_collection", "development", "audit", "report"])
		PIPELINES.free.should.eql(["execution"])
		PIPELINES.architect[0].should.equal("architecture_discussion")
		PIPELINES.architect[PIPELINES.architect.length - 1].should.equal("architecture_doc_readme_ai")
		PIPELINES.debug.should.eql(["debug_setup", "debug_environment", "debug_execution", "debug_fix", "debug_validation"])
	})
})
