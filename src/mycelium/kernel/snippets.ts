import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { Profile } from "../profile"
import type { CodeRef } from "../store/schema"

export interface Snippet {
	ref: CodeRef
	text: string
	/** The file is missing, unreadable, or outside the workspace. */
	broken: boolean
	/** The referenced lines still hash to the anchor recorded with the ref. */
	hashMatches: boolean
}

/** sha256 of the referenced lines joined with "\n" (the ref's hash anchor). */
export function anchorHash(lines: string[]): string {
	return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex")
}

/** Which refs get their code shown: tao the first N in storage order (oldest), improved the N most recent. */
export function selectSnippetRefs(refs: CodeRef[], profile: Profile): CodeRef[] {
	const open = refs.filter((r) => !r.resolved)
	const ordered = profile.kernel.snippetSelection === "oldest" ? open : [...open].sort((a, b) => b.at_turn - a.at_turn)
	return ordered.slice(0, profile.kernel.maxSnippets)
}

export async function readSnippet(cwd: string, ref: CodeRef, maxLines: number): Promise<Snippet> {
	const root = path.resolve(cwd)
	const abs = path.resolve(root, ref.path)
	if (abs !== root && !abs.startsWith(root + path.sep)) {
		return { ref, text: "", broken: true, hashMatches: false }
	}
	let lines: string[]
	try {
		lines = (await fs.readFile(abs, "utf8")).split(/\r?\n/)
	} catch {
		return { ref, text: "", broken: true, hashMatches: false }
	}
	const range = lines.slice(Math.max(0, ref.start_line - 1), ref.end_line)
	const shown = range.slice(0, maxLines).map((l, i) => `${ref.start_line + i}| ${l}`)
	if (range.length > maxLines) shown.push(`… ${range.length - maxLines} more lines`)
	return { ref, text: shown.join("\n"), broken: false, hashMatches: anchorHash(range) === ref.sha256 }
}
