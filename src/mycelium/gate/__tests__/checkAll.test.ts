import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { isCheckAllCommand, recordObservedRun, runCheckAll } from "../checkAll"

describe("check_all runner", () => {
	let cwd: string
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-check-"))
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})
	const script = (body: string, where = "check_all.sh") => fs.writeFile(path.join(cwd, where), `#!/usr/bin/env bash\n${body}\n`)

	it("passes on exit 0", async () => {
		await script('echo "all green"')
		const run = await runCheckAll(cwd)
		run.status.should.equal("passed")
		run.exit_code!.should.equal(0)
		run.source.should.equal("extension")
		;(await fs.readFile(path.join(cwd, ".mycelium/check_runs/latest.log"), "utf8")).should.containEql("all green")
	})

	it("fails on exit 1 with the log saved", async () => {
		await script('echo "lint failed"; exit 1')
		const run = await runCheckAll(cwd)
		run.status.should.equal("failed")
		run.exit_code!.should.equal(1)
		;(await fs.readFile(run.log_path!, "utf8")).should.containEql("lint failed")
	})

	it("finds scripts/check_all.sh", async () => {
		await fs.mkdir(path.join(cwd, "scripts"))
		await script("exit 0", "scripts/check_all.sh")
		;(await runCheckAll(cwd)).status.should.equal("passed")
	})

	it("reports missing script", async () => {
		const run = await runCheckAll(cwd)
		run.status.should.equal("missing")
		;(run.exit_code === null).should.be.true()
	})

	it("kills a hanging script after the timeout", async () => {
		await script("sleep 30")
		const t0 = Date.now()
		const run = await runCheckAll(cwd, { timeoutMs: 300 })
		run.status.should.equal("timeout")
		;(Date.now() - t0).should.be.below(2000)
	})

	it("log never contains values of env vars named *TOKEN*/*KEY*", async () => {
		await script('echo "token is $ELIZA_TOKEN"')
		const run = await runCheckAll(cwd, { env: { ...process.env, ELIZA_TOKEN: "super-secret-value" } })
		const log = await fs.readFile(run.log_path!, "utf8")
		log.should.not.containEql("super-secret-value")
		log.should.containEql("***")
	})

	it("isCheckAllCommand matches runs and not reads or edits", () => {
		for (const c of [
			"bash check_all.sh",
			"./check_all.sh",
			"cd app && bash scripts/check_all.sh",
			"sh ./check_all.sh 2>&1 | tail -20",
		])
			isCheckAllCommand(c).should.equal(true, c)
		for (const c of ["cat check_all.sh", "vim check_all.sh", "chmod +x check_all.sh", "echo check_all.sh"])
			isCheckAllCommand(c).should.equal(false, c)
	})

	it("recordObservedRun stores an agent_command run with its exit code", async () => {
		const run = await recordObservedRun(cwd, "bash check_all.sh", 2, "tests failed")
		run.source.should.equal("agent_command")
		run.status.should.equal("failed")
		run.exit_code!.should.equal(2)
		;(await fs.readFile(run.log_path!, "utf8")).should.containEql("tests failed")
		;(await recordObservedRun(cwd, "bash check_all.sh", undefined, "")).status.should.equal("unknown")
	})
})

describe("check_all runner — review fixes", () => {
	let cwd: string
	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-check2-"))
	})
	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true })
	})
	const script = (body: string) => fs.writeFile(path.join(cwd, "check_all.sh"), `#!/usr/bin/env bash\n${body}\n`)

	it("returns promptly when the script exits but leaves a background child holding stdout", async () => {
		await script("(sleep 20) &\necho started\nexit 0")
		const t0 = Date.now()
		const run = await runCheckAll(cwd, { timeoutMs: 15000 })
		;(Date.now() - t0).should.be.below(4000)
		run.status.should.equal("passed")
	})

	it("a detached child that escapes the process group cannot hang the gate past the deadline", async () => {
		await script("setsid sleep 20 &\nsleep 20")
		const t0 = Date.now()
		const run = await runCheckAll(cwd, { timeoutMs: 300 })
		run.status.should.equal("timeout")
		;(Date.now() - t0).should.be.below(4000)
	})
})
