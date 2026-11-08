import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import type { ApiHandler } from "@/core/api"
import { modelsFile } from "../../paths"
import { DEFAULT_ELIZA, ELIZA_TOKEN_KEY } from "../eliza"
import { resolveRoutes } from "../routing"

const clineApi = {
	getModel: () => ({ id: "claude-code/sonnet", info: {} }),
	async *createMessage() {
		yield { type: "text", text: "from cline" }
	},
} as unknown as ApiHandler

describe("model routing", () => {
	let cwd: string
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-route-"))
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})
	const writeModels = async (dir: string, content: object) => {
		await fs.mkdir(path.dirname(modelsFile(dir)), { recursive: true })
		await fs.writeFile(modelsFile(dir), JSON.stringify(content))
	}

	it("default routes use the Cline API for both", async () => {
		const r = await resolveRoutes(cwd, clineApi, () => undefined)
		r.main.should.equal(clineApi)
		;(await r.aux.call("s", "u")).text.should.equal("from cline")
		r.mainModelId.should.equal("claude-code/sonnet")
	})

	it("eliza route builds a handler with baseUrl and the auth header taken from the secret, never from settings", async () => {
		await writeModels(cwd, { main: { kind: "eliza", model: "openai/gpt-5.2" } })
		const r = await resolveRoutes(cwd, clineApi, (k) => (k === ELIZA_TOKEN_KEY ? "tok-123" : undefined), {
			eliza: DEFAULT_ELIZA,
		})
		r.main.should.not.equal(clineApi)
		r.main.getModel().id.should.equal("openai/gpt-5.2")
		const options = (r.main as unknown as { options: { openAiBaseUrl: string; openAiHeaders: Record<string, string> } })
			.options
		options.openAiBaseUrl.should.equal("https://gateway.example/v1")
		options.openAiHeaders.Authorization.should.equal("Bearer tok-123")
		;(await fs.readFile(modelsFile(cwd), "utf8")).should.not.containEql("tok-123")
	})

	it('missing token gives a clear error naming the command "Mycelium: Configure Eliza"', async () => {
		await writeModels(cwd, { main: { kind: "eliza", model: "openai/gpt-5.2" } })
		await resolveRoutes(cwd, clineApi, () => undefined, { eliza: DEFAULT_ELIZA }).should.be.rejectedWith(
			/Mycelium: Configure Eliza/,
		)
	})

	it("aux can be routed separately from main", async () => {
		await writeModels(cwd, { main: { kind: "cline" }, aux: { kind: "eliza", model: "anthropic/claude-haiku-4.5" } })
		const r = await resolveRoutes(cwd, clineApi, () => "tok", { eliza: DEFAULT_ELIZA })
		r.main.should.equal(clineApi)
		r.auxModelId.should.equal("anthropic/claude-haiku-4.5")
	})

	it("models.json is identical-model friendly", async () => {
		const other = await fs.mkdtemp(path.join(os.tmpdir(), "myc-route-b-"))
		const spec = {
			main: { kind: "eliza", model: "openai/gpt-5.2" },
			aux: { kind: "eliza", model: "anthropic/claude-haiku-4.5" },
		}
		await writeModels(cwd, spec)
		await writeModels(other, spec)
		const a = await resolveRoutes(cwd, clineApi, () => "t", { eliza: DEFAULT_ELIZA })
		const b = await resolveRoutes(other, clineApi, () => "t", { eliza: DEFAULT_ELIZA })
		;[a.mainModelId, a.auxModelId].should.eql([b.mainModelId, b.auxModelId])
		await fs.rm(other, { recursive: true, force: true })
	})
})
