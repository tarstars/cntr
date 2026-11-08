import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { loadElizaConfig, myceliumEnvFile, saveElizaBaseUrl } from "../eliza"

// The Eliza endpoint is private: it lives only in ~/.mycelium/.env (or the environment), never in the code.
describe("Eliza connection settings (~/.mycelium/.env)", () => {
	let dir: string
	let saved: string | undefined
	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "myc-env-"))
		saved = process.env.MYCELIUM_DIR
		process.env.MYCELIUM_DIR = dir
	})
	afterEach(async () => {
		if (saved === undefined) delete process.env.MYCELIUM_DIR
		else process.env.MYCELIUM_DIR = saved
		await fs.rm(dir, { recursive: true, force: true })
	})

	it("reads the endpoint from ~/.mycelium/.env (comments, quotes, export prefix)", async () => {
		myceliumEnvFile().should.equal(path.join(dir, ".env"))
		await fs.writeFile(
			myceliumEnvFile(),
			'# gateway\nexport ELIZA_BASE_URL="https://gateway.example/v1"\nELIZA_AUTH_SCHEME=Token\n',
		)
		;(await loadElizaConfig({})).should.eql({
			baseUrl: "https://gateway.example/v1",
			format: "openai",
			authHeader: "Authorization",
			authScheme: "Token",
		})
	})

	it("defaults to a standard Bearer authorization header", async () => {
		await fs.writeFile(myceliumEnvFile(), "ELIZA_BASE_URL=https://gateway.example/v1\n")
		const cfg = await loadElizaConfig({})
		cfg.authHeader.should.equal("Authorization")
		cfg.authScheme.should.equal("Bearer")
	})

	it("environment variables override ~/.mycelium/.env", async () => {
		await fs.writeFile(myceliumEnvFile(), "ELIZA_BASE_URL=https://gateway.example/v1\nELIZA_AUTH_HEADER=X-Key\n")
		const cfg = await loadElizaConfig({ ELIZA_BASE_URL: "https://other.example/v1" })
		cfg.baseUrl.should.equal("https://other.example/v1")
		cfg.authHeader.should.equal("X-Key")
	})

	it("without ELIZA_BASE_URL it fails with a message naming the key and the file", async () => {
		const err = await loadElizaConfig({}).then(
			() => undefined,
			(e) => e,
		)
		err.should.be.instanceOf(Error)
		err.message.should.containEql("ELIZA_BASE_URL")
		err.message.should.containEql(myceliumEnvFile())
	})

	it("saveElizaBaseUrl sets the key, keeps the other lines and makes the file private", async () => {
		await fs.writeFile(myceliumEnvFile(), "# mine\nELIZA_AUTH_SCHEME=Token\nELIZA_BASE_URL=https://old.example/v1\n")
		await saveElizaBaseUrl("https://new.example/v1")
		const text = await fs.readFile(myceliumEnvFile(), "utf8")
		text.should.containEql("# mine")
		text.should.containEql("ELIZA_AUTH_SCHEME=Token")
		text.should.not.containEql("old.example")
		;(await loadElizaConfig({})).baseUrl.should.equal("https://new.example/v1")
		;((await fs.stat(myceliumEnvFile())).mode & 0o777).should.equal(0o600)
		await fs.rm(myceliumEnvFile())
		await saveElizaBaseUrl("https://fresh.example/v1")
		;(await loadElizaConfig({})).baseUrl.should.equal("https://fresh.example/v1")
	})
})
