import * as vscode from "vscode"
import { myceliumDir } from "@/mycelium/paths"
import { readWorkspaceSettings } from "@/mycelium/profile"
import { TaskContextStore } from "@/mycelium/store/TaskContextStore"

const REFRESH_MS = 3000

/** `Mycelium · <profile> · <mode>/<stage>` for the most recently updated task; hidden outside Mycelium workspaces. */
export class MyceliumStatusBar implements vscode.Disposable {
	private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
	private readonly timer: NodeJS.Timeout

	constructor(command: string) {
		this.item.command = command
		this.item.tooltip = "Open the Mycelium Cockpit"
		this.timer = setInterval(() => this.refresh(), REFRESH_MS)
		this.refresh()
	}

	refresh(): void {
		void this.update().catch(() => this.item.hide())
	}

	private async update(): Promise<void> {
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!cwd) return this.item.hide()
		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(myceliumDir(cwd)))
		} catch {
			return this.item.hide()
		}
		const settings = await readWorkspaceSettings(cwd)
		const latest = (await new TaskContextStore(cwd).listTasks()).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
		this.item.text = latest
			? `$(type-hierarchy) Mycelium · ${latest.profile} · ${latest.mode}/${latest.stage}`
			: `$(type-hierarchy) Mycelium · ${settings.profile}`
		this.item.show()
	}

	dispose(): void {
		clearInterval(this.timer)
		this.item.dispose()
	}
}
