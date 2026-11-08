// Knowledge-migration instructions, in our own words (docs/tao-behaviour.md §10).
export const MIGRATION_SYSTEM_PROMPT = `A new task is starting after an earlier one. You receive the earlier task's code references,
notes and summary, and the owner's latest request. Pick ONLY what the new task needs; when unsure, leave it
out. Return ONLY a JSON object:
{"add_refs": [{"path", "start_line", "end_line", "why"}], "add_notes": [{"text", "tags"}], "task_summary"?: string}
tags: "hypothesis", "decision", "negative_knowledge", "info". Rewrite "why" for the new task.`
