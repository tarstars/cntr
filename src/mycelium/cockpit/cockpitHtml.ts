import { latestAcStatuses } from "../gate/stageGate"
import { allCallsView, profileView } from "../metrics/metrics"
import { STAGES } from "../modes/pipelines"
import type { CockpitState } from "./messages"

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ENTITIES[c])
const hours = (ms: number) => `${(ms / 60_000).toFixed(1)} min`

/** The Cockpit page: plain HTML plus a small script that posts actions back to the extension. */
export function cockpitHtml(state: CockpitState, nonce: string, cspSource: string): string {
	const c = state.ctx
	const options = state.tasks
		.map(
			(t) =>
				`<option value="${esc(t.task_id)}"${t.task_id === c?.task_id ? " selected" : ""}>${esc(t.task_id)} · ${esc(t.mode)}/${esc(t.stage)} · ${esc(t.status)}</option>`,
		)
		.join("")
	const body = c
		? (() => {
				const verdicts = latestAcStatuses(c)
				const criteria = Object.entries(STAGES[c.stage].exitCriteria)
					.map(
						([k, meaning]) =>
							`<label class="row"><input type="checkbox" data-criterion="${esc(k)}"${c.exit_criteria[k] ? " checked" : ""}> <code>${esc(k)}</code> — ${esc(meaning)}</label>`,
					)
					.join("")
				const acs = c.task.acceptance_criteria.map((a, i) => `${a}`).join("\n")
				const acView = c.task.acceptance_criteria
					.map(
						(a, i) =>
							`<li>${esc(a)} <span class="tag">${esc(verdicts.get(i)?.status ?? "pending")}</span> ${esc(verdicts.get(i)?.comment ?? "")}</li>`,
					)
					.join("")
				const plan = c.task.plan.map((p) => `${p.status}: ${p.text}`).join("\n")
				const history = c.stage_history
					.map(
						(h) =>
							`<li>${esc(h.at.slice(0, 19))} ${esc(h.from)} → ${esc(h.to)} (${esc(h.actor)}): ${esc(h.reason)}</li>`,
					)
					.join("")
				const notes = c.notes
					.filter((n) => !n.hidden)
					.slice(-30)
					.reverse()
					.map(
						(n) =>
							`<li><span class="tag">${esc(n.tags.join(" "))}</span> ${esc(n.text)}${n.resolved ? " (resolved)" : ""}</li>`,
					)
					.join("")
				const refs = c.refs
					.slice(-30)
					.reverse()
					.map(
						(r) =>
							`<li><code>${esc(r.path)}:${r.start_line}-${r.end_line}</code> ${esc(r.why)}${r.stale ? " [STALE]" : ""}</li>`,
					)
					.join("")
				const runs = c.metrics.check_runs
					.slice(-10)
					.reverse()
					.map(
						(r) =>
							`<li>${esc(r.started_at.slice(0, 19))} ${esc(r.source)} <b>${esc(r.status)}</b> exit ${r.exit_code ?? "–"}</li>`,
					)
					.join("")
				const pv = profileView(c.metrics)
				const all = allCallsView(c.metrics)
				const snaps = state.snapshots.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")
				return `
<h2>${esc(c.profile)} · ${esc(c.mode)} · <span class="stage">${esc(c.stage)}</span></h2>
<section><h3>Spec</h3><textarea id="spec" rows="4">${esc(c.task.spec)}</textarea><button data-save="spec">Save spec</button></section>
<section><h3>Acceptance criteria</h3><ul>${acView}</ul><textarea id="ac" rows="4" placeholder="one per line">${esc(acs)}</textarea><button data-save="ac">Save criteria</button></section>
<section><h3>Constraints</h3><textarea id="constraints" rows="3" placeholder="one per line">${esc(c.task.constraints.join("\n"))}</textarea><button data-save="constraints">Save constraints</button></section>
<section><h3>Plan</h3><textarea id="plan" rows="6" placeholder="status: text (todo, next, in_progress, done)">${esc(plan)}</textarea><button data-save="plan">Save plan</button></section>
<section><h3>Exit criteria (${esc(c.stage)})</h3>${criteria}</section>
<section><h3>Stage history</h3><ul>${history || "<li>(none yet)</li>"}</ul></section>
<section><h3>Notes</h3><ul>${notes || "<li>(none)</li>"}</ul><h3>Code references</h3><ul>${refs || "<li>(none)</li>"}</ul></section>
<section><h3>check_all.sh runs</h3><ul>${runs || "<li>(none)</li>"}</ul></section>
<section><h3>Metrics</h3><p>All calls: ${all.count} · tokens ${all.tokens_in}/${all.tokens_out} · $${all.cost_usd.toFixed(4)} · model time ${hours(all.model_ms)}<br>As the profile reports: ${pv.count} calls · $${pv.cost_usd.toFixed(4)} · tool time ${hours(c.metrics.tool_ms)}</p></section>
<section><h3>Snapshots</h3><button data-action="snapshot">Take snapshot</button> <select id="snap">${snaps}</select> <button data-action="rollback">Roll back</button></section>`
			})()
		: "<p>No Mycelium task in this workspace yet. Run <b>Mycelium: New Task…</b>.</p>"
	return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:0 12px}
section{margin:14px 0;border-top:1px solid var(--vscode-panel-border);padding-top:8px}
textarea{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border)}
button,select{margin:4px 4px 0 0}.row{display:block;margin:2px 0}.tag{opacity:.75;font-size:.85em}.stage{color:var(--vscode-textLink-foreground)}
.error{color:var(--vscode-errorForeground)}
</style></head><body>
<p><select id="task">${options}</select> <button data-action="refresh">Refresh</button></p>
${state.error ? `<p class="error">${esc(state.error)}</p>` : ""}
${body}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const lines = (id) => document.getElementById(id).value.split("\\n").map((s) => s.trim()).filter(Boolean);
document.getElementById("task")?.addEventListener("change", (e) => vscode.postMessage({ type: "select", taskId: e.target.value }));
document.querySelectorAll("[data-criterion]").forEach((el) => el.addEventListener("change", () => vscode.postMessage({ type: "toggleExitCriterion", key: el.dataset.criterion, value: el.checked })));
document.querySelectorAll("[data-save]").forEach((el) => el.addEventListener("click", () => {
  const what = el.dataset.save;
  if (what === "spec") vscode.postMessage({ type: "editSpec", spec: document.getElementById("spec").value });
  if (what === "ac") vscode.postMessage({ type: "editAcceptance", items: lines("ac") });
  if (what === "constraints") vscode.postMessage({ type: "editConstraints", items: lines("constraints") });
  if (what === "plan") vscode.postMessage({ type: "editPlan", items: lines("plan").map((l) => { const m = l.match(/^(todo|next|in_progress|done):\\s*(.*)$/); return m ? { status: m[1], text: m[2] } : { status: "todo", text: l }; }) });
}));
document.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", () => {
  const a = el.dataset.action;
  if (a === "refresh") vscode.postMessage({ type: "load" });
  if (a === "snapshot") vscode.postMessage({ type: "snapshot" });
  if (a === "rollback") vscode.postMessage({ type: "rollback", snapshotId: document.getElementById("snap").value });
}));
</script></body></html>`
}
