import { expect } from "chai"
import { before, describe, it } from "mocha"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { ClineToolSet } from "../registry/ClineToolSet"
import { PromptRegistry } from "../registry/PromptRegistry"
import type { PromptVariant, SystemPromptContext } from "../types"
import { mockProviderInfo } from "./integration.test"

const baseContext: SystemPromptContext = {
	cwd: "/test/project",
	ide: "TestIde",
	supportsBrowserUse: true,
	providerInfo: mockProviderInfo,
	isTesting: true,
}
const variant = {
	family: ModelFamily.GENERIC,
	tools: [ClineDefaultTool.FILE_READ, ClineDefaultTool.FILE_NEW],
	labels: {},
} as unknown as PromptVariant
const ids = (context: SystemPromptContext) => ClineToolSet.getEnabledToolSpecs(variant, context).map((t) => t.id as string)

describe("Mycelium tool filtering in ClineToolSet", () => {
	before(() => {
		PromptRegistry.getInstance()
	})

	it("offers the variant's tools when no Mycelium filter is set", () => {
		expect(ids(baseContext)).to.include.members(["read_file", "write_to_file"])
	})

	it("hides tools the stage filter rejects", () => {
		const out = ids({ ...baseContext, toolFilter: (id) => id !== "write_to_file" })
		expect(out).to.include("read_file")
		expect(out).to.not.include("write_to_file")
	})

	it("adds extra myc_* tool ids", () => {
		expect(ids({ ...baseContext, extraToolIds: ["myc_set_stage", "myc_add_note"] })).to.include.members([
			"myc_set_stage",
			"myc_add_note",
		])
	})
})
