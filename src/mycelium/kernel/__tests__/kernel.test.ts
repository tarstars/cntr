import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { IMPROVED_PROFILE, type Profile, TAO_PROFILE } from "../../profile"
import { type CodeRef, emptyMetrics, type Note, type TaskContext } from "../../store/schema"
import { autoPlanFor, criteriaFor } from "../../store/TaskContextStore"
import { KernelCache } from "../KernelCache"
import { estimateTokens, type KernelInputs, renderKernel } from "../renderKernel"
import { anchorHash, readSnippet, selectSnippetRefs } from "../snippets"

const SECTIONS = [
	"## Memory feed",
	"## Stage",
	"## Task",
	"## System",
	"## Project bible",
	"## Recent finished tasks",
	"## Algorithm",
	"## Stage contract",
	"## Exit criteria",
	"## Legend",
]

function ctx(patch: Partial<TaskContext> = {}): TaskContext {
	const at = new Date().toISOString()
	return {
		schema_version: 1,
		task_id: "t_1",
		cline_task_id: "c",
		profile: "tao",
		mode: "developer",
		stage: "development",
		status: "active",
		created_at: at,
		updated_at: at,
		stage_history: [],
		exit_criteria: criteriaFor("development"),
		task: {
			spec: "Build the fungi page",
			acceptance_criteria: ["page renders"],
			constraints: ["Astro"],
			plan: autoPlanFor("development"),
		},
		ac_rounds: [],
		refs: [],
		notes: [],
		changes: [],
		user_notes: [],
		execution_log: [],
		update_cycle: { processed_until: 0, turn_counter: 0, pending_force: false },
		repair: {},
		migration: {},
		metrics: emptyMetrics(at),
		...patch,
	}
}
const inputs = (patch: Partial<KernelInputs> = {}): KernelInputs => ({
	readmeAi: "# README_AI\nproject bible",
	recentTasks: ["task A: built header"],
	snippets: [],
	systemInfo: "OS: linux",
	...patch,
})
const note = (i: number, text = `note number ${i} `.repeat(20)): Note => ({
	id: `n${i}`,
	text,
	tags: ["info"],
	at_turn: i,
	hidden: false,
	resolved: false,
	comments: [],
})
const ref = (i: number, at_turn: number): CodeRef => ({
	id: `r${i}`,
	path: `f${i}.ts`,
	start_line: 1,
	end_line: 2,
	sha256: "x",
	why: "w",
	at_turn,
	stale: false,
	resolved: false,
})
const withBudget = (p: Profile, tokens: number): Profile => ({ ...p, kernel: { ...p.kernel, hotBudgetTokens: tokens } })
const order = (text: string, names: string[]) => names.map((n) => text.indexOf(n))

describe("kernel renderer", () => {
	for (const p of [TAO_PROFILE, IMPROVED_PROFILE]) {
		it(`section order (${p.id})`, () => {
			const text = renderKernel(ctx({ notes: [note(1)] }), inputs(), p)
			const idx = order(text, SECTIONS)
			idx.every((i) => i >= 0).should.equal(true, `missing section in ${p.id}`)
			idx.should.eql([...idx].sort((a, b) => a - b))
			text.indexOf("Task Context").should.be.below(idx[0])
		})
	}

	it("tao: feed is never trimmed even beyond the budget; later sections are dropped first", () => {
		const notes = Array.from({ length: 60 }, (_, i) => note(i))
		const text = renderKernel(ctx({ notes }), inputs(), withBudget(TAO_PROFILE, 1500))
		for (const n of notes) text.should.containEql(`[note ${n.id}`)
		text.should.not.containEql("## Legend")
	})

	it("improved: feed trimmed oldest-first to stay within hotBudgetTokens*4 chars, fixed sections kept", () => {
		const notes = Array.from({ length: 60 }, (_, i) => note(i))
		const p = withBudget(IMPROVED_PROFILE, 3000)
		const text = renderKernel(ctx({ notes }), inputs(), p)
		text.length.should.be.belowOrEqual(p.kernel.hotBudgetTokens * 4)
		text.should.containEql("[note n59")
		text.should.not.containEql("[note n0 ")
		for (const s of SECTIONS) text.should.containEql(s)
	})

	it("tao picks the 25 oldest refs, improved the 25 most recent", () => {
		const refs = Array.from({ length: 30 }, (_, i) => ref(i, i))
		selectSnippetRefs(refs, TAO_PROFILE)
			.map((r) => r.id)
			.should.eql(refs.slice(0, 25).map((r) => r.id))
		selectSnippetRefs(refs, IMPROVED_PROFILE)
			.map((r) => r.id)
			.should.eql(
				refs
					.slice(5)
					.reverse()
					.map((r) => r.id),
			)
	})

	it("plan appears in the kernel only for improved", () => {
		renderKernel(ctx(), inputs(), IMPROVED_PROFILE).should.containEql("## Plan")
		renderKernel(ctx(), inputs(), TAO_PROFILE).should.not.containEql("## Plan")
	})

	it("estimates tokens as chars/4", () => {
		estimateTokens("abcdefgh").should.equal(2)
		estimateTokens("abcdefghi").should.equal(3)
	})

	it("caches kernels per task id", () => {
		const cache = new KernelCache()
		cache.set("t_a", "k1", "kernel A")
		cache.set("t_b", "k1", "kernel B")
		cache.get("t_a", "k1")!.should.equal("kernel A")
		;(cache.get("t_a", "k2") === undefined).should.be.true()
		cache.invalidate("t_a")
		;(cache.get("t_a", "k1") === undefined).should.be.true()
		cache.get("t_b", "k1")!.should.equal("kernel B")
	})

	describe("snippets", () => {
		let cwd: string
		beforeEach(async () => {
			cwd = await fs.mkdtemp(path.join(os.tmpdir(), "myc-kernel-"))
		})
		afterEach(async () => {
			await fs.rm(cwd, { recursive: true, force: true })
		})

		it("anchors and renders refs in files with Cyrillic content and paths", async () => {
			const lines = ["# Хищные грибы", "Узбекистан: Arthrobotrys oligospora", "конец"]
			await fs.mkdir(path.join(cwd, "тест"))
			await fs.writeFile(path.join(cwd, "тест", "файл.md"), lines.join("\n"))
			const r: CodeRef = {
				...ref(1, 0),
				path: "тест/файл.md",
				start_line: 1,
				end_line: 2,
				sha256: anchorHash(lines.slice(0, 2)),
			}
			const s = await readSnippet(cwd, r, 150)
			s.broken.should.be.false()
			s.hashMatches.should.be.true()
			s.text.should.containEql("Узбекистан: Arthrobotrys oligospora")
			anchorHash(lines.slice(0, 2)).should.equal(anchorHash(["# Хищные грибы", "Узбекистан: Arthrobotrys oligospora"]))
		})

		it("broken ref (missing file) is rendered as [BROKEN]; hash mismatch sets hashMatches=false", async () => {
			const missing = await readSnippet(cwd, ref(1, 0), 150)
			missing.broken.should.be.true()
			renderKernel(ctx({ refs: [ref(1, 0)] }), inputs({ snippets: [missing] }), TAO_PROFILE).should.containEql("[BROKEN]")
			await fs.writeFile(path.join(cwd, "f2.ts"), "a\nb\n")
			;(await readSnippet(cwd, { ...ref(2, 0), sha256: "not-the-hash" }, 150)).hashMatches.should.be.false()
		})

		it("refuses paths outside the workspace", async () => {
			;(await readSnippet(cwd, { ...ref(3, 0), path: "../../etc/passwd" }, 150)).broken.should.be.true()
		})
	})
})

describe("token estimate — review fixes", () => {
	it("counts non-ASCII text (e.g. Russian) at about 2 characters per token", () => {
		estimateTokens("абвгдежз").should.equal(4)
		estimateTokens("abcd" + "аб").should.equal(2)
	})
})
