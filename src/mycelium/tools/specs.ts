import type { ClineToolSpec } from "@/core/prompts/system-prompt/spec"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"

const p = (name: string, required: boolean, instruction: string, usage?: string) => ({ name, required, instruction, usage })

/** Generic specs for the myc_* tools; other model families fall back to GENERIC. Descriptions in our own words. */
export const MYCELIUM_TOOL_SPECS: ClineToolSpec[] = [
	{
		variant: ModelFamily.GENERIC,
		id: ClineDefaultTool.MYC_SET_STAGE,
		name: "myc_set_stage",
		description:
			"Move the task to another stage of its pipeline. Mycelium checks the stage's exit criteria, the evidence ids and the acceptance-criteria verdicts first; if a check fails you get the reason and stay where you are.",
		parameters: [
			p("to_stage", false, "Target stage id. Omit to go to the next stage of the pipeline.", "data_collection"),
			p(
				"reason",
				true,
				"Why the current stage is finished (one or two sentences).",
				"Spec and criteria agreed with the owner",
			),
			p(
				"evidence",
				true,
				'JSON with ids from memory that prove it: {"refs":[...],"notes":[...],"changes":[...]} (or a JSON array of ids).',
				'{"notes":["n_ab12"]}',
			),
			p("back", false, "true when deliberately returning to an earlier stage.", "false"),
		],
	},
	{
		variant: ModelFamily.GENERIC,
		id: ClineDefaultTool.MYC_UPDATE_TASK_SPEC,
		name: "myc_update_task_spec",
		description: "Write the task's spec, acceptance criteria and constraints. Only the fields you pass change.",
		parameters: [
			p("spec", false, "What will be done, in a few sentences.", "Add a gallery page listing the species"),
			p("acceptance_criteria", false, "JSON array of checkable criteria.", '["The page renders at /species"]'),
			p("constraints", false, "JSON array of constraints.", '["Astro 5", "no new dependencies"]'),
		],
	},
	{
		variant: ModelFamily.GENERIC,
		id: ClineDefaultTool.MYC_ADD_CODE_REF,
		name: "myc_add_code_ref",
		description: "Remember a piece of code that matters for the task. Its current lines are shown to you in later requests.",
		parameters: [
			p("path", true, "File path relative to the workspace.", "src/pages/index.astro"),
			p("start_line", true, "First line (1-based).", "10"),
			p("end_line", true, "Last line.", "42"),
			p("why", true, "What this code does for the task.", "Renders the species list"),
		],
	},
	{
		variant: ModelFamily.GENERIC,
		id: ClineDefaultTool.MYC_ADD_NOTE,
		name: "myc_add_note",
		description: "Record a finding in memory.",
		parameters: [
			p("text", true, "The finding.", "The build fails without NODE_ENV set"),
			p("tags", true, "Comma-separated: hypothesis, decision, negative_knowledge, info.", "negative_knowledge"),
		],
	},
	{
		variant: ModelFamily.GENERIC,
		id: ClineDefaultTool.MYC_ADD_NOTE_COMMENT,
		name: "myc_add_note_comment",
		description: "Add a new fact to an existing note instead of writing a duplicate note.",
		parameters: [p("note_id", true, "Id of the note.", "n_ab12"), p("text", true, "The new fact.", "Confirmed on Node 24")],
	},
	{
		variant: ModelFamily.GENERIC,
		id: ClineDefaultTool.MYC_UPDATE_PLAN,
		name: "myc_update_plan",
		description:
			"Update the plan: either replace it with items, or change the status of one item. Keep exactly one item in_progress.",
		parameters: [
			p("items", false, 'JSON array replacing the plan: [{"text":"...","status":"todo|next|in_progress|done"}].'),
			p("item_id", false, "Id of one plan item to update.", "auto_development_1"),
			p("status", false, "New status for item_id: todo, next, in_progress or done.", "done"),
		],
	},
	{
		variant: ModelFamily.GENERIC,
		id: ClineDefaultTool.MYC_UPDATE_EXIT_CRITERIA,
		name: "myc_update_exit_criteria",
		description: "Mark exit criteria of the current stage as met (true) or not (false). Only mark true what is really done.",
		parameters: [p("criteria", true, "JSON object criterion → true/false.", '{"tests_added": true}')],
	},
	{
		variant: ModelFamily.GENERIC,
		id: ClineDefaultTool.MYC_UPDATE_ACCEPTANCE_CRITERIA,
		name: "myc_update_acceptance_criteria",
		description: "Give acceptance criteria a verdict. Each call adds a round; the latest verdict per criterion counts.",
		parameters: [
			p("statuses", true, 'JSON array: [{"index":0,"status":"pass|fail|skip|pending","comment":"how you checked"}].'),
		],
	},
	{
		variant: ModelFamily.GENERIC,
		id: ClineDefaultTool.MYC_CREATE_HANDOFF,
		name: "myc_create_handoff",
		description:
			"Finish an Architect task by writing a handoff for the next Developer task: spec, criteria, decisions, notes and code references.",
		parameters: [p("summary", true, "What was decided and what the first roadmap phase should do.")],
	},
]
