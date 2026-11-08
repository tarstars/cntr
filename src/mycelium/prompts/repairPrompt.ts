// Repair planner instructions, in our own words (docs/tao-behaviour.md §10).
export const REPAIR_SYSTEM_PROMPT = `You fix the working plan of a coding agent when it is empty or inconsistent. You receive the
problems found, the current stage, the spec and the plan. Return ONLY a JSON object:
{"add_plan_items": [{"text", "status"}], "update_plan_items": [{"id", "status"}],
 "spec"?: string, "acceptance_criteria"?: string[], "constraints"?: string[]}
Statuses: "todo", "next", "in_progress", "done". Exactly one item should be "in_progress" afterwards.
Fill spec, acceptance_criteria or constraints only if they are listed as empty; derive them from what the
task already says. Keep items small, concrete and inside the current stage.`
