import fs from "node:fs/promises"
import path from "node:path"
import { myceliumHome } from "./home"
import { screenshotsDir } from "./paths"

const DEFAULT_ARTIFACTS_DIR = path.join(process.env.HOME ?? "", "database", "20261108_mycelium", "artifacts")

/** Large-artifact directory from ~/.mycelium/mycelium.json ({ "artifactsDir": "…" }). */
export async function artifactsDir(): Promise<string> {
	try {
		const cfg = JSON.parse(await fs.readFile(path.join(myceliumHome(), "mycelium.json"), "utf8"))
		if (typeof cfg.artifactsDir === "string" && cfg.artifactsDir) return cfg.artifactsDir
	} catch {
		// default below
	}
	return DEFAULT_ARTIFACTS_DIR
}

/**
 * Save a browser screenshot (data URL) to `.mycelium/screenshots/<task_id>/` and to
 * `<artifacts>/screenshots/<workspace name>/`. Returns the written paths ([] if `dataUrl` is not an image).
 */
export async function saveScreenshot(
	cwd: string,
	taskId: string,
	dataUrl: string,
	action: string,
	artifacts?: string,
): Promise<string[]> {
	const m = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/s)
	if (!m) return []
	const ext = m[1] === "jpeg" ? "jpg" : m[1]
	const bytes = Buffer.from(m[2], "base64")
	const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${action.replace(/[^\w-]/g, "_")}.${ext}`
	const targets = [
		path.join(screenshotsDir(cwd, taskId), name),
		path.join(artifacts ?? (await artifactsDir()), "screenshots", path.basename(cwd), `${taskId}-${name}`),
	]
	const written: string[] = []
	for (const file of targets) {
		try {
			await fs.mkdir(path.dirname(file), { recursive: true })
			await fs.writeFile(file, bytes)
			written.push(file)
		} catch {
			// an unwritable artifacts directory must not break the browser tool
		}
	}
	return written
}
