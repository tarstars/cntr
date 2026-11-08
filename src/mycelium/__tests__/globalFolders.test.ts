import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { refreshHooks } from "@/core/controller/file/refreshHooks"
import { resolveHooksDirectory } from "@/core/hooks/utils"
import {
	ensureHooksDirectoryExists,
	ensureMcpServersDirectoryExists,
	ensureRulesDirectoryExists,
	ensureWorkflowsDirectoryExists,
} from "@/core/storage/disk"
import { getAgentsConfigPath } from "@/core/task/tools/subagent/AgentConfigLoader"
import { HostProvider } from "@/hosts/host-provider"

// Mycelium must not pick up a Cline install's global rules, workflows, MCP notes, hooks or agents from
// ~/Documents/Cline: hooks run automatically, and shared rules would confound the tao/improved comparison.
describe("global folders are Mycelium's own (~/Documents/Mycelium, not ~/Documents/Cline)", () => {
	let sandbox: sinon.SinonSandbox
	let home: string
	beforeEach(async () => {
		home = await fs.mkdtemp(path.join(os.tmpdir(), "myc-docs-"))
		sandbox = sinon.createSandbox()
		// Not linux: getDocumentsPath() then uses homedir()/Documents instead of asking xdg-user-dir about the real home.
		sandbox.stub(process, "platform").value("darwin")
		sandbox.stub(os, "homedir").returns(home)
	})
	afterEach(async () => {
		sandbox.restore()
		await fs.rm(home, { recursive: true, force: true })
	})
	const docs = () => path.join(home, "Documents", "Mycelium")

	it("rules, workflows, MCP and hooks folders live under Documents/Mycelium", async () => {
		;(await ensureRulesDirectoryExists()).should.equal(path.join(docs(), "Rules"))
		;(await ensureWorkflowsDirectoryExists()).should.equal(path.join(docs(), "Workflows"))
		;(await ensureMcpServersDirectoryExists()).should.equal(path.join(docs(), "MCP"))
		;(await ensureHooksDirectoryExists()).should.equal(path.join(docs(), "Hooks"))
		await fs.stat(path.join(home, "Documents", "Cline")).should.be.rejected()
	})

	it("global hooks and agent configs resolve to Documents/Mycelium", async () => {
		;(await resolveHooksDirectory(true)).should.equal(path.join(docs(), "Hooks"))
		getAgentsConfigPath().should.equal(path.join(docs(), "Agents"))
	})

	it("the hooks list ignores executables in ~/Documents/Cline/Hooks", async () => {
		sandbox.stub(HostProvider, "workspace").get(() => ({ getWorkspacePaths: async () => ({ paths: [] }) }))
		const clineHooks = path.join(home, "Documents", "Cline", "Hooks")
		await fs.mkdir(clineHooks, { recursive: true })
		await fs.writeFile(path.join(clineHooks, "PreToolUse"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
		;(await refreshHooks(undefined as never)).globalHooks.should.eql([])
		await fs.mkdir(path.join(docs(), "Hooks"), { recursive: true })
		await fs.writeFile(path.join(docs(), "Hooks", "PreToolUse"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
		;(await refreshHooks(undefined as never)).globalHooks.map((h) => h.name).should.eql(["PreToolUse"])
	})
})
