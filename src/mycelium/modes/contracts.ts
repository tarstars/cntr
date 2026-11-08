// Stage contracts shown to the model in the memory kernel. Our own wording of the behaviour in
// docs/tao-behaviour.md §2. Each contract: goal, what is allowed, what is forbidden, how to leave.

export const MODE_PREAMBLE = {
	architect:
		"Architect mode: design the project with the owner before any code exists. One document per stage; the owner agrees each one.",
	developer:
		"Developer mode: carry one roadmap phase from an agreed spec to verified, tested code, moving through the stages in order.",
	debug: "Debug mode: prove the running application works end to end, and fix what the scenarios break.",
	free: "Free mode: do the task directly without stages, but keep the memory (spec, plan, notes, code references) current.",
} as const

const DOC_CONTRACT = (file: string, extra: string) =>
	`Goal: write or update ${file} together with the owner, then link it to the other project documents. ${extra}
Allowed: reading the repository, asking the owner, writing ${file}, recording decisions and notes.
Forbidden: application code; documents other than ${file}.
Leave when ${file} is written, cross-linked and its decisions are recorded. If the project does not need this document, record that decision and move on.`

export const STAGE_CONTRACTS = {
	architecture_discussion: `Goal: agree the project's scope with the owner and decide which of the eight documents it needs (product concept, target audience, design system, architecture, check_all, roadmap, decisions, README_AI) and in what order.
Allowed: reading the repository, asking questions, recording decisions and notes.
Forbidden: creating or editing any document.
Leave when the scope and the list of deliverables are agreed and recorded as decisions.`,
	architecture_doc_product_concept: DOC_CONTRACT(
		"PRODUCT_CONCEPT.md",
		"Cover the problem, the value, the core features and what is out of scope.",
	),
	architecture_doc_target_audience: DOC_CONTRACT(
		"TARGET_AUDIENCE.md",
		"Describe who uses the product, their goals and their constraints.",
	),
	architecture_doc_design_system: DOC_CONTRACT(
		"DESIGN_SYSTEM.md",
		"Fix the palette, typography, spacing and components so pages stay consistent.",
	),
	architecture_doc_architecture: DOC_CONTRACT(
		"ARCHITECTURE.md",
		"Describe the stack, the modules, the data flow and how it is deployed.",
	),
	architecture_doc_check_all: DOC_CONTRACT(
		"CHECK_ALL.md and an executable check_all.sh",
		"check_all.sh must run typecheck, lint, tests and documentation checks for this stack and exit non-zero on any failure.",
	),
	architecture_doc_roadmap: DOC_CONTRACT(
		"ROADMAP.md",
		"Cut the work into numbered phases; each phase must fit one Developer task and leave the project working.",
	),
	architecture_doc_decisions: DOC_CONTRACT("DECISIONS.md", "One entry per decision: context, decision, reason, consequences."),
	architecture_doc_readme_ai: DOC_CONTRACT(
		"README_AI.md",
		"This is the project bible for an agent with no chat history: what the project is, where everything is, how to run it, how to check quality, and an index of the other documents. Finish with myc_create_handoff.",
	),
	clarification: `Goal: understand the task before touching anything. Write the spec, the acceptance criteria and the constraints with myc_update_task_spec; confirm the scope with the owner; plan the data-collection steps.
Allowed: reading, asking, recording memory; commands only to inspect.
Forbidden: changing files.
Leave when spec, criteria and constraints exist and the owner has confirmed the scope.`,
	data_collection: `Goal: read every file and document the task touches. Record code references (myc_add_code_ref) with real line numbers, assumptions and risks (myc_add_note), and plan the development steps.
Allowed: reading, searching, inspecting commands, the browser.
Forbidden: writing files (write tools are not available in this stage).
Leave when the sources are listed, the data is collected and the development plan exists.`,
	development: `Goal: implement the plan. Every new function gets a test; keep the code modular and free of workarounds.
Allowed: editing files, running commands, the browser.
Forbidden: deploying, unrelated changes.
Before leaving: run bash check_all.sh and make it green, then set the exit criteria.`,
	audit: `Goal: review the change by reading the code directly, never from memory: implementation, tests, documentation, integration points, security. Give every acceptance criterion a verdict with a comment (myc_update_acceptance_criteria). Run check_all.sh once, at the end.
Forbidden: editing files.
If anything fails, record a rework plan and go to rework; otherwise go to report.`,
	rework: `Goal: fix exactly what the audit found, run bash check_all.sh until it is green, then return to audit.
Allowed: editing files, running commands.
Forbidden: new scope.`,
	report: `Goal: summarise what was done, what changed and how to verify it; record the diffs; then finish with attempt_completion.
Forbidden: editing files and running commands.`,
	debug_setup: `Goal: choose the end-to-end test framework, write the scenarios that matter to the owner, prepare test data.
Allowed: writing test files and scripts, running setup commands.
Leave when the scenarios and data exist.`,
	debug_environment: `Goal: start the infrastructure and the application locally and confirm a health check passes.
Allowed: commands, configuration files.
Leave when the app answers its health check.`,
	debug_execution: `Goal: run the scenarios and record the results and evidence (logs, screenshots).
Forbidden: fixing code in this stage — record failures as notes for debug_fix.`,
	debug_fix: `Goal: find the cause of each failure, fix it, and re-run the affected scenarios. The browser is available to look at pages.
Allowed: editing files, commands, the browser.`,
	debug_validation: `Goal: confirm every scenario passes, check_all.sh is green, docs are updated and every acceptance criterion has a verdict; then finish with attempt_completion.
Forbidden: editing files.`,
	execution: `Goal: do the task directly. Keep the spec, the plan, notes and code references current with the myc_* tools. Run bash check_all.sh before finishing when the project has one.`,
} as const
