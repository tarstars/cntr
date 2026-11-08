// Fixed text of the memory kernel (our own wording; docs/tao-behaviour.md §8).

export const KERNEL_HEADER = `[Mycelium Task Context — your persistent memory for this task]
This message is rebuilt from disk before every request. It is the authoritative record of the task: older
chat turns may be gone, this is not. Keep it current with the myc_* tools: myc_update_task_spec for the spec,
criteria and constraints; myc_add_code_ref for code that matters (real line numbers); myc_add_note for
findings (tags: hypothesis, decision, negative_knowledge, info); myc_update_plan for plan item status;
myc_update_exit_criteria when a criterion becomes true; myc_set_stage to move on, with evidence ids.`

export const KERNEL_ALGORITHM = `1. Read the last message (a tool result or the owner's words) and this memory.
2. Decide the single next step that moves the current plan item forward within this stage's contract.
3. Reply with exactly one tool call. Plain text without a tool call is not a valid reply.`

export const KERNEL_LEGEND = `[ref <id>] code reference: path:lines — why it matters (STALE: the code moved, re-read it).
[note <id> #tag] a finding; tags: hypothesis (unproven), decision (agreed), negative_knowledge (checked and
ruled out), info, user_message (the owner's words). [change <id>] a change made in this task.
[x]/[ ] exit criterion met / not yet; acceptance criteria show their latest verdict.`
