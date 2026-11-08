// Modes, stages, exit criteria, auto-plan items and per-stage tool tables (docs/tao-behaviour.md §1–5).
import { STAGE_CONTRACTS } from "./contracts"

export type ModeId = "architect" | "developer" | "debug" | "free"

export const MYCELIUM_TOOLS = [
	"myc_set_stage",
	"myc_update_task_spec",
	"myc_add_code_ref",
	"myc_add_note",
	"myc_add_note_comment",
	"myc_update_plan",
	"myc_update_exit_criteria",
	"myc_update_acceptance_criteria",
	"myc_create_handoff",
] as const
export type MyceliumToolName = (typeof MYCELIUM_TOOLS)[number]

/** Every architect document stage, in order, with the file it produces and its criteria prefix. */
export const DOC_STAGES = {
	architecture_doc_product_concept: { file: "PRODUCT_CONCEPT.md", key: "product_concept" },
	architecture_doc_target_audience: { file: "TARGET_AUDIENCE.md", key: "target_audience" },
	architecture_doc_design_system: { file: "DESIGN_SYSTEM.md", key: "design_system" },
	architecture_doc_architecture: { file: "ARCHITECTURE.md", key: "architecture" },
	architecture_doc_check_all: { file: "CHECK_ALL.md", key: "check_all_doc" },
	architecture_doc_roadmap: { file: "ROADMAP.md", key: "roadmap" },
	architecture_doc_decisions: { file: "DECISIONS.md", key: "decisions_doc" },
	architecture_doc_readme_ai: { file: "README_AI.md", key: "readme_ai" },
} as const
type DocStageId = keyof typeof DOC_STAGES

export type StageId =
	| "architecture_discussion"
	| DocStageId
	| "clarification"
	| "data_collection"
	| "development"
	| "audit"
	| "rework"
	| "report"
	| "debug_setup"
	| "debug_environment"
	| "debug_execution"
	| "debug_fix"
	| "debug_validation"
	| "execution"

export const PIPELINES: Record<ModeId, readonly StageId[]> = {
	architect: ["architecture_discussion", ...(Object.keys(DOC_STAGES) as DocStageId[])],
	developer: ["clarification", "data_collection", "development", "audit", "report"],
	debug: ["debug_setup", "debug_environment", "debug_execution", "debug_fix", "debug_validation"],
	free: ["execution"],
}

/** The mode a stage belongs to (`rework` belongs to developer). */
export function modeOfStage(stage: StageId): ModeId {
	if (stage === "rework") {
		return "developer"
	}
	return (Object.keys(PIPELINES) as ModeId[]).find((m) => PIPELINES[m].includes(stage)) ?? "free"
}

export interface StageDef {
	contract: string
	/** key → one-line meaning shown to the model. All start false. */
	exitCriteria: Record<string, string>
	autoPlan: string[]
	/** Tools the stage offers. "*" means every tool (Free). */
	allow: ReadonlySet<string>
	/** Tools flagged "needs confirmation" (effective only when profile.stages.confirmFlagsEffective). */
	requireConfirm: ReadonlySet<string>
	/** Whether attempt_completion may end the task here. */
	completion: boolean
}

/** Tools Cline offers that Mycelium never exposes while a Mycelium task is active. */
export const HIDDEN_TOOLS: ReadonlySet<string> = new Set(["plan_mode_respond", "act_mode_respond", "focus_chain"])

const BASE = ["ask_followup_question", "new_task", "read_file", "list_files", "search_files", "list_code_definition_names"]
const MEMORY: readonly string[] = MYCELIUM_TOOLS
const MCP = ["use_mcp_tool", "access_mcp_resource", "load_mcp_documentation"]
const WEB = ["web_search", "web_fetch"]
const WRITE = ["write_to_file", "replace_in_file", "apply_patch"]

const tools = (...groups: (readonly string[])[]) => new Set(groups.flat())

const DOC_STAGE_DEFS = Object.fromEntries(
	(Object.keys(DOC_STAGES) as DocStageId[]).map((id) => {
		const { file, key } = DOC_STAGES[id]
		const def: StageDef = {
			contract: STAGE_CONTRACTS[id],
			exitCriteria: {
				[`${key}_written`]: `${file} is written or updated and the owner agreed its content`,
				[`${key}_cross_linked`]: `${file} links to and from the related project documents`,
				decisions_recorded: "decisions taken in this stage are recorded as decision notes",
			},
			autoPlan: [
				`Read the current ${file} (if any) and the documents it relates to`,
				`Agree the content of ${file} with the owner`,
				`Write or update ${file}`,
				`Add cross-links between ${file} and the other documents`,
			],
			allow: tools(BASE, MEMORY, WRITE, ["execute_command", "attempt_completion"], WEB, MCP),
			requireConfirm: tools(WRITE, ["execute_command"]),
			completion: true,
		}
		return [id, def]
	}),
) as Record<DocStageId, StageDef>

const CHECK_ALL = "bash check_all.sh ran in the project and every check was green"

export const STAGES: Record<StageId, StageDef> = {
	architecture_discussion: {
		contract: STAGE_CONTRACTS.architecture_discussion,
		exitCriteria: {
			arch_scope_confirmed: "the owner confirmed the project's scope",
			deliverables_defined: "the list and order of documents to write is agreed",
			decisions_recorded: "the scope and deliverables are recorded as decision notes",
		},
		autoPlan: [
			"Ask the owner about goals, users and constraints",
			"Agree which documents are needed and their order",
			"Record the decisions",
		],
		allow: tools(BASE, MEMORY, ["execute_command", "attempt_completion"], WEB, MCP),
		requireConfirm: tools(["execute_command"]),
		completion: true,
	},
	...DOC_STAGE_DEFS,
	clarification: {
		contract: STAGE_CONTRACTS.clarification,
		exitCriteria: {
			has_task_spec: "the spec says what will be done",
			has_acceptance_criteria: "acceptance criteria are written and checkable",
			constraints_defined: "constraints (stack, limits, must-not-change) are written",
			scope_confirmed: "the owner confirmed the scope",
			implementation_plan_created_for_data_collection: "the plan lists the data-collection steps",
		},
		autoPlan: [
			"Restate the task as a spec",
			"Write acceptance criteria and constraints",
			"Confirm the scope with the owner",
			"Plan what to read next",
		],
		allow: tools(BASE, MEMORY, ["execute_command"], WEB, MCP),
		requireConfirm: tools(["execute_command"]),
		completion: false,
	},
	data_collection: {
		contract: STAGE_CONTRACTS.data_collection,
		exitCriteria: {
			sources_listed: "every file and document the task touches is listed",
			data_collected: "the relevant code is read and recorded as code references",
			assumptions_recorded: "assumptions are recorded as notes",
			risks_recorded: "risks are recorded as notes",
			implementation_plan_created_for_development: "the plan lists the development steps",
		},
		autoPlan: [
			"Find the files the task touches",
			"Read them and record code references",
			"Record assumptions and risks",
			"Plan the development steps",
		],
		allow: tools(BASE, MEMORY, ["execute_command", "browser_action"], WEB, MCP),
		requireConfirm: tools(["execute_command"]),
		completion: false,
	},
	development: {
		contract: STAGE_CONTRACTS.development,
		exitCriteria: {
			implementation_done: "every planned change is implemented",
			tests_added: "every new function has a test",
			check_all_passed: CHECK_ALL,
			code_modular: "the change is split into focused modules",
			code_production_quality: "no debug leftovers, clear names, errors handled",
			no_hacks_or_workarounds: "no workaround or disabled check was introduced",
			no_plan_for_audit: "the plan has no open development items left",
		},
		autoPlan: [
			"Implement the planned change",
			"Add tests for every new function",
			"Update the documentation",
			"Run check_all.sh until green",
		],
		allow: tools(BASE, MEMORY, WRITE, ["new_rule", "execute_command", "browser_action"], WEB, MCP),
		requireConfirm: tools(["browser_action"]),
		completion: false,
	},
	audit: {
		contract: STAGE_CONTRACTS.audit,
		exitCriteria: {
			implementation_reviewed: "the diff was re-read file by file",
			tests_reviewed: "tests cover the acceptance criteria",
			docs_reviewed: "documentation matches the change",
			integration_reviewed: "callers and integration points still work",
			security_reviewed: "no secrets, injections or unsafe defaults were added",
			check_all_passed: CHECK_ALL,
			rework_plan_recorded_if_needed: "if anything failed, the rework plan is recorded",
			audit_completed: "the audit is complete",
			ac_statuses_updated: "every acceptance criterion has a verdict with a comment",
		},
		autoPlan: [
			"Re-read the diff",
			"Check the tests",
			"Check the documentation",
			"Check the integration points",
			"Check security",
			"Give every acceptance criterion a verdict",
			"Run check_all.sh once at the end",
		],
		allow: tools(BASE, MEMORY, ["execute_command"], MCP),
		requireConfirm: tools(["execute_command", "use_mcp_tool", "myc_create_handoff", "myc_set_stage"]),
		completion: false,
	},
	rework: {
		contract: STAGE_CONTRACTS.rework,
		exitCriteria: {
			fixes_applied: "every audit finding is fixed",
			check_all_passed: CHECK_ALL,
		},
		autoPlan: ["Fix each audit finding", "Run check_all.sh until green", "Return to audit"],
		allow: tools(BASE, MEMORY, WRITE, ["new_rule", "execute_command", "browser_action"], WEB, MCP),
		requireConfirm: tools(["browser_action"]),
		completion: false,
	},
	report: {
		contract: STAGE_CONTRACTS.report,
		exitCriteria: {
			report_written: "the report says what changed and how to verify it",
			diffs_recorded: "the changes are recorded in memory",
		},
		autoPlan: ["Write the report", "Record the changes", "Finish with attempt_completion"],
		allow: tools(BASE, MEMORY, ["attempt_completion", "summarize_task", "generate_explanation"], MCP),
		requireConfirm: tools(["myc_set_stage"]),
		completion: true,
	},
	debug_setup: {
		contract: STAGE_CONTRACTS.debug_setup,
		exitCriteria: {
			e2e_scripts_written: "the end-to-end scenarios are written",
			e2e_framework_selected: "the test framework is chosen and installed",
			test_data_prepared: "test data is ready",
		},
		autoPlan: ["Choose the E2E framework", "Write the scenarios", "Prepare test data"],
		allow: tools(BASE, MEMORY, WRITE, ["execute_command"], WEB, MCP),
		requireConfirm: tools(["execute_command"]),
		completion: false,
	},
	debug_environment: {
		contract: STAGE_CONTRACTS.debug_environment,
		exitCriteria: {
			infra_started: "databases and services the app needs are running",
			server_started: "the application is running locally",
			health_check_passed: "the application answers its health check",
		},
		autoPlan: ["Start the infrastructure", "Start the application", "Confirm the health check"],
		allow: tools(BASE, MEMORY, WRITE, ["execute_command"], WEB, MCP),
		requireConfirm: tools(["execute_command", "use_mcp_tool"], WRITE),
		completion: false,
	},
	debug_execution: {
		contract: STAGE_CONTRACTS.debug_execution,
		exitCriteria: {
			e2e_scripts_executed: "every scenario was run",
			results_recorded: "results are recorded as notes",
			evidence_collected: "logs and screenshots are saved",
		},
		autoPlan: ["Run the scenarios", "Record the results", "Collect evidence"],
		allow: tools(BASE, MEMORY, ["execute_command"], WEB, MCP),
		requireConfirm: tools(["execute_command"]),
		completion: false,
	},
	debug_fix: {
		contract: STAGE_CONTRACTS.debug_fix,
		exitCriteria: {
			bugs_identified: "the cause of each failure is identified",
			fixes_applied: "each cause is fixed",
			tests_revalidated: "the affected scenarios were re-run and pass",
		},
		autoPlan: ["Find the cause of each failure", "Fix it", "Re-run the affected scenarios"],
		allow: tools(BASE, MEMORY, WRITE, ["new_rule", "execute_command", "browser_action", "attempt_completion"], WEB, MCP),
		requireConfirm: tools(["browser_action"]),
		completion: true,
	},
	debug_validation: {
		contract: STAGE_CONTRACTS.debug_validation,
		exitCriteria: {
			all_e2e_passed: "every scenario passes",
			check_all_passed: CHECK_ALL,
			docs_updated: "the documentation reflects the fixes",
			ac_statuses_updated: "every acceptance criterion has a verdict with a comment",
		},
		autoPlan: [
			"Run every scenario",
			"Run check_all.sh",
			"Update the documentation",
			"Give every acceptance criterion a verdict",
		],
		allow: tools(BASE, MEMORY, ["execute_command", "attempt_completion"], WEB, MCP),
		requireConfirm: tools(["execute_command", "myc_set_stage"]),
		completion: true,
	},
	execution: {
		contract: STAGE_CONTRACTS.execution,
		exitCriteria: {
			spec_finalized: "the spec says what was done",
			plan_created: "the plan reflects the work",
			implementation_done: "the task is implemented",
			tests_added_or_verified: "tests were added or existing ones still pass",
			check_all_passed: CHECK_ALL,
			docs_updated: "the documentation is current",
		},
		autoPlan: ["Write the spec and plan", "Do the work", "Run check_all.sh", "Update the documentation"],
		allow: new Set(["*"]),
		requireConfirm: new Set(),
		completion: true,
	},
}
