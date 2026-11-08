import { describe, it } from "mocha"
import "should"
import type { ApiHandler } from "@/core/api"
import { MainApiSlot } from "../mainApiSlot"

const handler = (id: string) =>
	({
		getModel: () => ({ id, info: {} }),
		async *createMessage() {},
	}) as unknown as ApiHandler

describe("main API slot", () => {
	it("an Eliza override survives Cline replacing its handler (Act switch, settings change)", () => {
		const slot = new MainApiSlot()
		slot.setCline(handler("cline-plan"))
		slot.override(handler("anthropic/claude-sonnet-4.6"), "openai")
		slot.setCline(handler("cline-act"))
		slot.current.getModel().id.should.equal("anthropic/claude-sonnet-4.6")
		slot.cline.getModel().id.should.equal("cline-act")
	})

	it("without an override the current handler is Cline's latest", () => {
		const slot = new MainApiSlot()
		slot.setCline(handler("a"))
		slot.setCline(handler("b"))
		slot.current.getModel().id.should.equal("b")
	})

	it("reports the override's provider id while it is active, Cline's otherwise", () => {
		const slot = new MainApiSlot()
		slot.setCline(handler("x"))
		slot.providerId("anthropic").should.equal("anthropic")
		slot.override(handler("m"), "openai")
		slot.providerId("anthropic").should.equal("openai")
	})
})
