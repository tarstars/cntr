import type { ApiHandler } from "@/core/api"

/**
 * The handler Task sends agent requests to. Cline replaces its own handler on a Plan/Act switch or a
 * settings change (`task.api = buildApiHandler(…)`); that lands in `cline`. A Mycelium route from
 * models.json (Eliza) is an override that survives those replacements.
 */
export class MainApiSlot {
	cline!: ApiHandler
	private routed?: { api: ApiHandler; providerId: string }

	get current(): ApiHandler {
		return this.routed?.api ?? this.cline
	}

	setCline(api: ApiHandler): void {
		this.cline = api
	}

	override(api: ApiHandler, providerId: string): void {
		this.routed = { api, providerId }
	}

	/** Provider id for prompt-variant selection, error messages and telemetry. */
	providerId(configured: string): string {
		return this.routed?.providerId ?? configured
	}
}
