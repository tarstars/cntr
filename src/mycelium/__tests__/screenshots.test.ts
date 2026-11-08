import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { saveScreenshot } from "../screenshots"

// 1×1 transparent PNG
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

describe("screenshots", () => {
	let cwd: string
	let artifacts: string
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-shot-"))
		artifacts = await fs.mkdtemp(path.join(os.tmpdir(), "myc-art-"))
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
		await fs.rm(artifacts, { recursive: true, force: true })
	})

	it("saveScreenshot writes a PNG decoded from the data URL to both locations", async () => {
		const files = await saveScreenshot(cwd, "t_1", `data:image/png;base64,${PNG_B64}`, "launch", artifacts)
		files.length.should.equal(2)
		files[0].should.startWith(path.join(cwd, ".mycelium", "screenshots", "t_1"))
		files[1].should.startWith(path.join(artifacts, "screenshots", path.basename(cwd)))
		for (const f of files) {
			const bytes = await fs.readFile(f)
			bytes.subarray(1, 4).toString("ascii").should.equal("PNG")
		}
	})

	it("ignores input that is not an image data URL", async () => {
		;(await saveScreenshot(cwd, "t_1", "not a data url", "x", artifacts)).should.eql([])
	})
})
