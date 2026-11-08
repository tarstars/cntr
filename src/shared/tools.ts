import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import { FunctionDeclaration as GoogleTool } from "@google/genai"
import { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"

export type ClineTool = OpenAITool | AnthropicTool | GoogleTool

// Define available tool ids
export enum ClineDefaultTool {
	ASK = "ask_followup_question",
	ATTEMPT = "attempt_completion",
	BASH = "execute_command",
	FILE_EDIT = "replace_in_file",
	FILE_READ = "read_file",
	FILE_NEW = "write_to_file",
	SEARCH = "search_files",
	LIST_FILES = "list_files",
	LIST_CODE_DEF = "list_code_definition_names",
	BROWSER = "browser_action",
	MCP_USE = "use_mcp_tool",
	MCP_ACCESS = "access_mcp_resource",
	MCP_DOCS = "load_mcp_documentation",
	NEW_TASK = "new_task",
	PLAN_MODE = "plan_mode_respond",
	ACT_MODE = "act_mode_respond",
	TODO = "focus_chain",
	WEB_FETCH = "web_fetch",
	WEB_SEARCH = "web_search",
	CONDENSE = "condense",
	SUMMARIZE_TASK = "summarize_task",
	REPORT_BUG = "report_bug",
	NEW_RULE = "new_rule",
	APPLY_PATCH = "apply_patch",
	GENERATE_EXPLANATION = "generate_explanation",
	USE_SKILL = "use_skill",
	USE_SUBAGENTS = "use_subagents",
	// Mycelium memory and stage tools (src/mycelium/tools)
	MYC_SET_STAGE = "myc_set_stage",
	MYC_UPDATE_TASK_SPEC = "myc_update_task_spec",
	MYC_ADD_CODE_REF = "myc_add_code_ref",
	MYC_ADD_NOTE = "myc_add_note",
	MYC_ADD_NOTE_COMMENT = "myc_add_note_comment",
	MYC_UPDATE_PLAN = "myc_update_plan",
	MYC_UPDATE_EXIT_CRITERIA = "myc_update_exit_criteria",
	MYC_UPDATE_ACCEPTANCE_CRITERIA = "myc_update_acceptance_criteria",
	MYC_CREATE_HANDOFF = "myc_create_handoff",
}

// Array of all tool names for compatibility
// Automatically generated from the enum values
export const toolUseNames = Object.values(ClineDefaultTool) as ClineDefaultTool[]

const dynamicToolUseNamesByNamespace = new Map<string, Set<string>>()

export function setDynamicToolUseNames(namespace: string, names: string[]): void {
	dynamicToolUseNamesByNamespace.set(namespace, new Set(names.map((name) => name.trim()).filter(Boolean)))
}

export function getToolUseNames(): string[] {
	const defaults = [...toolUseNames]
	const dynamic = Array.from(dynamicToolUseNamesByNamespace.values()).flatMap((set) => Array.from(set))
	return Array.from(new Set([...defaults, ...dynamic]))
}

// Tools that are safe to run in parallel with the initial checkpoint commit
// These are tools that do not modify the workspace state
export const READ_ONLY_TOOLS = [
	ClineDefaultTool.LIST_FILES,
	ClineDefaultTool.FILE_READ,
	ClineDefaultTool.SEARCH,
	ClineDefaultTool.LIST_CODE_DEF,
	ClineDefaultTool.BROWSER,
	ClineDefaultTool.ASK,
	ClineDefaultTool.WEB_SEARCH,
	ClineDefaultTool.WEB_FETCH,
	ClineDefaultTool.USE_SKILL,
	ClineDefaultTool.USE_SUBAGENTS,
] as const
