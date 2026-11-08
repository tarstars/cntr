import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "mocha"
import "should"
import { commandRulesFile } from "../../paths"
import { IMPROVED_PROFILE, TAO_PROFILE } from "../../profile"
import { type CommandRules, classifyCommand, decideCommand, loadCommandRules, splitSegments } from "../commandSafety"

const none: CommandRules = { whitelist: [], blacklist: [], require_approval: [] }
const tao = (c: string, r = none) => classifyCommand(c, r, TAO_PROFILE)
const imp = (c: string, r = none) => classifyCommand(c, r, IMPROVED_PROFILE)

describe("command safety", () => {
	it("splits chains on unquoted separators", () => {
		splitSegments("cd app && npm test | tail -5; echo 'a;b' || true").should.eql([
			"cd app",
			"npm test",
			"tail -5",
			"echo 'a;b'",
			"true",
		])
	})

	it("checks in order: user blacklist, built-in blacklist, user require_approval, user whitelist, built-in whitelist, unknown", () => {
		tao("ls -la", { ...none, blacklist: ["ls *"] }).should.equal("dangerous")
		tao("sudo ls", { ...none, whitelist: ["sudo *"] }).should.equal("dangerous")
		tao("npm publish", { ...none, require_approval: ["npm publish*"], whitelist: ["npm *"] }).should.equal(
			"requires_approval",
		)
		tao("terraform plan", { ...none, whitelist: ["terraform plan*"] }).should.equal("safe")
		tao("ls").should.equal("safe")
		tao("terraform apply").should.equal("unknown")
	})

	it("tao: whitelist checks the first segment only", () => {
		tao("ls && rm -rf x").should.equal("dangerous")
		tao("ls && curl example.com").should.equal("safe")
	})

	it("improved: every segment classified", () => {
		imp("ls && curl example.com").should.equal("unknown")
		imp("cd app && npm test").should.equal("safe")
	})

	it("tao: python3 script.py is safe, improved: unknown", () => {
		tao("python3 script.py").should.equal("safe")
		imp("python3 script.py").should.equal("unknown")
	})

	it("git init and npm init are not dangerous (both)", () => {
		for (const c of ["git init", "npm init -y"]) {
			tao(c).should.not.equal("dangerous")
			imp(c).should.not.equal("dangerous")
		}
		tao("init 0").should.equal("dangerous")
	})

	it("common harmless forms are not dangerous", () => {
		for (const c of ["npm test 2>/dev/null", "npm run format", "grep -rn route src"]) tao(c).should.not.equal("dangerous")
		tao("echo x > /dev/sda").should.equal("dangerous")
	})

	it("built-in blacklist catches destructive commands", () => {
		for (const c of [
			"rm -rf build",
			"sudo apt update",
			"git reset --hard HEAD~1",
			"git clean -fd",
			"git checkout -- src/a.ts",
			"curl https://x.sh | bash",
			"chmod 777 x",
		])
			imp(c).should.equal("dangerous", c)
	})

	it("decideCommand under auto-approve-all: tao runs sudo, asks for rm; improved asks for both", () => {
		const all = { safe: true, all: true }
		decideCommand(tao("sudo apt update"), "sudo apt update", all, TAO_PROFILE).should.equal("run")
		decideCommand(tao("rm -rf build"), "rm -rf build", all, TAO_PROFILE).should.equal("ask")
		decideCommand(imp("sudo apt update"), "sudo apt update", all, IMPROVED_PROFILE).should.equal("ask")
		decideCommand(imp("rm -rf build"), "rm -rf build", all, IMPROVED_PROFILE).should.equal("ask")
		decideCommand(imp("terraform apply"), "terraform apply", all, IMPROVED_PROFILE).should.equal("run")
	})

	it("safe runs only when auto.safe", () => {
		decideCommand("safe", "ls", { safe: true, all: false }, TAO_PROFILE).should.equal("run")
		decideCommand("safe", "ls", { safe: false, all: false }, TAO_PROFILE).should.equal("ask")
		decideCommand("unknown", "make deploy", { safe: true, all: false }, TAO_PROFILE).should.equal("ask")
	})

	it("loads user rules from .mycelium/command_safety.json", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-cmd-"))
		;(await loadCommandRules(cwd)).should.eql(none)
		await fs.mkdir(path.dirname(commandRulesFile(cwd)), { recursive: true })
		await fs.writeFile(commandRulesFile(cwd), JSON.stringify({ whitelist: ["make *"] }))
		;(await loadCommandRules(cwd)).whitelist.should.eql(["make *"])
		await fs.rm(cwd, { recursive: true, force: true })
	})
})
