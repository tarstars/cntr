import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import "should"
import { getClineHomePath } from "@/core/storage/disk"

describe("Mycelium isolation", () => {
	let saved: string | undefined

	beforeEach(() => {
		saved = process.env.MYCELIUM_DIR
		delete process.env.MYCELIUM_DIR
	})

	afterEach(() => {
		if (saved === undefined) {
			delete process.env.MYCELIUM_DIR
		} else {
			process.env.MYCELIUM_DIR = saved
		}
	})

	it("home path defaults to ~/.mycelium", () => {
		getClineHomePath().should.equal(path.join(os.homedir(), ".mycelium"))
	})

	it("home path honours MYCELIUM_DIR", () => {
		process.env.MYCELIUM_DIR = "/tmp/x"
		getClineHomePath().should.equal("/tmp/x")
	})

	it("package identity is Mycelium", () => {
		const pkg = require("../../../package.json")
		pkg.name.should.equal("mycelium-coder")
		pkg.publisher.should.equal("local")
		pkg.displayName.should.equal("Mycelium")
		const commands: Array<{ command: string }> = pkg.contributes.commands
		commands.filter((c) => c.command.startsWith("cline.")).should.be.empty()
		JSON.stringify(pkg.contributes).should.not.containEql("claude-dev")
	})
})
