import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import * as vscode from "vscode"
import { StateManager } from "@/core/storage/StateManager"
import { cockpitHtml } from "@/mycelium/cockpit/cockpitHtml"
import { type CockpitMessage, handleCockpitMessage } from "@/mycelium/cockpit/messages"
import { DEFAULT_ELIZA, ELIZA_TOKEN_KEY, elizaConfigFile, loadElizaConfig } from "@/mycelium/llm/eliza"
import { aggregateWorkspace, renderSummaryHtml } from "@/mycelium/metrics/aggregate"
import type { ModeId } from "@/mycelium/modes/pipelines"
import { myceliumDir, nextTaskFile, profileFile } from "@/mycelium/paths"
import type { ProfileId } from "@/mycelium/profile"
import { readWorkspaceSettings } from "@/mycelium/profile"
import { TaskContextStore } from "@/mycelium/store/TaskContextStore"
import { ExtensionRegistryInfo } from "@/registry"
import { MyceliumStatusBar } from "./statusBar"

const PREFIX = `${ExtensionRegistryInfo.name}.`
const workspaceRoot = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

const MODES: { label: string; mode: ModeId; detail: string }[] = [
	{ label: "Architect", mode: "architect", detail: "Design the project with you, one document per stage" },
	{ label: "Developer", mode: "developer", detail: "One roadmap phase: clarify → collect → develop → audit → report" },
	{ label: "Debug", mode: "debug", detail: "End-to-end checks against the running app" },
	{ label: "Free", mode: "free", detail: "No stages; memory is still kept" },
]

async function pickProfile(placeHolder: string, withDefault: boolean): Promise<ProfileId | "default" | undefined> {
	const items = [
		...(withDefault ? [{ label: "Workspace default", value: "default" as const }] : []),
		{ label: "improved", value: "improved" as const, detail: "TAO's ideas with the known weaknesses fixed" },
		{ label: "tao", value: "tao" as const, detail: "Behaves like TAO·CODER 3.1.2 by design" },
	]
	return (await vscode.window.showQuickPick(items, { placeHolder }))?.value
}

/** Register Mycelium's commands, status bar and Cockpit panel. */
export function registerMyceliumCommands(context: vscode.ExtensionContext): void {
	const statusBar = new MyceliumStatusBar(`${PREFIX}openCockpit`)
	context.subscriptions.push(statusBar)
	let cockpit: vscode.WebviewPanel | undefined
	let cockpitTask: string | undefined

	const renderCockpit = async (msg: CockpitMessage = { type: "load" }) => {
		const cwd = workspaceRoot()
		if (!cockpit || !cwd) return
		const store = new TaskContextStore(cwd)
		if (!cockpitTask)
			cockpitTask = (await store.listTasks()).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]?.task_id
		const state = cockpitTask ? await handleCockpitMessage(store, cockpitTask, msg) : { tasks: [], snapshots: [] }
		cockpit.webview.html = cockpitHtml(state, randomBytes(16).toString("hex"), cockpit.webview.cspSource)
		statusBar.refresh()
	}

	context.subscriptions.push(
		vscode.commands.registerCommand(`${PREFIX}newTask`, async () => {
			const cwd = workspaceRoot()
			if (!cwd)
				return void vscode.window.showErrorMessage(
					"Open a folder first: Mycelium keeps its memory in <folder>/.mycelium/.",
				)
			const pick = await vscode.window.showQuickPick(MODES, { placeHolder: "Mode for the new task" })
			if (!pick) return
			const profile = await pickProfile("Profile for this task", true)
			if (!profile) return
			await fs.mkdir(myceliumDir(cwd), { recursive: true })
			await fs.writeFile(
				nextTaskFile(cwd),
				JSON.stringify({ mode: pick.mode, ...(profile === "default" ? {} : { profile }) }, null, 2),
			)
			await vscode.commands.executeCommand(ExtensionRegistryInfo.commands.PlusButton)
			vscode.window.showInformationMessage(`Mycelium: the next task you start will run in ${pick.label} mode.`)
		}),
		vscode.commands.registerCommand(`${PREFIX}setProfile`, async () => {
			const cwd = workspaceRoot()
			if (!cwd) return
			const profile = await pickProfile("Profile for this workspace", false)
			if (!profile || profile === "default") return
			const current = await readWorkspaceSettings(cwd)
			const mode = await vscode.window.showQuickPick(MODES, {
				placeHolder: `Default mode (now: ${current.defaultMode ?? "developer"})`,
			})
			await fs.mkdir(myceliumDir(cwd), { recursive: true })
			await fs.writeFile(
				profileFile(cwd),
				JSON.stringify({ profile, defaultMode: mode?.mode ?? current.defaultMode ?? "developer" }, null, 2),
			)
			statusBar.refresh()
		}),
		vscode.commands.registerCommand(`${PREFIX}openCockpit`, async () => {
			if (cockpit) return cockpit.reveal()
			cockpit = vscode.window.createWebviewPanel("myceliumCockpit", "Mycelium Cockpit", vscode.ViewColumn.Beside, {
				enableScripts: true,
			})
			cockpit.onDidDispose(() => {
				cockpit = undefined
			})
			cockpit.webview.onDidReceiveMessage(async (msg: CockpitMessage | { type: "select"; taskId: string }) => {
				if (msg.type === "select") {
					cockpitTask = msg.taskId
					return renderCockpit()
				}
				return renderCockpit(msg)
			})
			await renderCockpit()
		}),
		vscode.commands.registerCommand(`${PREFIX}summarize`, async () => {
			const cwd = workspaceRoot()
			if (!cwd) return
			const html = renderSummaryHtml(await aggregateWorkspace(cwd))
			await fs.mkdir(myceliumDir(cwd), { recursive: true })
			await fs.writeFile(path.join(myceliumDir(cwd), "summary.html"), html)
			const panel = vscode.window.createWebviewPanel("myceliumSummary", "Mycelium Summary", vscode.ViewColumn.Active, {})
			panel.webview.html = html
		}),
		vscode.commands.registerCommand(`${PREFIX}configureEliza`, async () => {
			const current = await loadElizaConfig()
			const baseUrl = await vscode.window.showInputBox({
				prompt: "Eliza base URL (OpenAI-compatible)",
				value: current.baseUrl || DEFAULT_ELIZA.baseUrl,
				ignoreFocusOut: true,
			})
			if (!baseUrl) return
			const token = await vscode.window.showInputBox({
				prompt: "Your Eliza token (stored in VS Code SecretStorage)",
				password: true,
				ignoreFocusOut: true,
			})
			if (!token) return
			StateManager.get().setRawSecret(ELIZA_TOKEN_KEY, token.trim())
			await fs.mkdir(path.dirname(elizaConfigFile()), { recursive: true })
			await fs.writeFile(elizaConfigFile(), JSON.stringify({ ...current, baseUrl }, null, 2))
			vscode.window.showInformationMessage(
				'Mycelium: Eliza configured. Choose models in .mycelium/models.json (e.g. {"main":{"kind":"eliza","model":"anthropic/claude-sonnet-4.6"}}).',
			)
		}),
	)
}
