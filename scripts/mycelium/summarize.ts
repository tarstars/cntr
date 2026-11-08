// Summarise a Mycelium workspace:
//   npx tsx scripts/mycelium/summarize.ts <workspace> [--html out.html] [--json out.json]
import fs from "node:fs/promises"
import { aggregateWorkspace, renderSummaryHtml } from "../../src/mycelium/metrics/aggregate"

async function main() {
	const [workspace, ...rest] = process.argv.slice(2)
	if (!workspace) {
		console.error("usage: summarize.ts <workspace> [--html out.html] [--json out.json]")
		process.exit(2)
	}
	const opt = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined)
	const summary = await aggregateWorkspace(workspace)
	const html = opt("--html")
	const json = opt("--json")
	if (html) await fs.writeFile(html, renderSummaryHtml(summary))
	if (json) await fs.writeFile(json, JSON.stringify(summary, null, 2))
	if (!html && !json) console.log(JSON.stringify(summary.totals, null, 2))
}

void main()
