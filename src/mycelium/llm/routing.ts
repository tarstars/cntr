import fs from "node:fs/promises"
import type { ApiHandler } from "@/core/api"
import { modelsFile } from "../paths"
import { buildElizaHandler, ELIZA_TOKEN_KEY, type ElizaConfig, loadElizaConfig } from "./eliza"
import { apiHandlerCaller, type LlmCaller } from "./LlmCaller"

/** Where a role's model calls go: the provider configured in Cline, or Eliza with a given model id. */
export type RouteSpec = { kind: "cline" } | { kind: "eliza"; model: string }

interface ModelsFile {
	main?: RouteSpec
	aux?: RouteSpec
}

const isRoute = (r: unknown): r is RouteSpec =>
	(r as RouteSpec)?.kind === "cline" ||
	((r as RouteSpec)?.kind === "eliza" && typeof (r as { model?: unknown }).model === "string")

async function readModels(cwd: string): Promise<ModelsFile> {
	try {
		return JSON.parse(await fs.readFile(modelsFile(cwd), "utf8"))
	} catch {
		return {}
	}
}

/**
 * Resolve `.mycelium/models.json` ({ main, aux? }) into the handler for agent calls and the caller for
 * auxiliary calls (update-cycle, repair, migration). Defaults: main = Cline's provider, aux = main.
 */
export async function resolveRoutes(
	cwd: string,
	clineApi: ApiHandler,
	readSecret: (key: string) => string | undefined,
	opts: { eliza?: ElizaConfig } = {},
): Promise<{ main: ApiHandler; aux: LlmCaller; mainModelId: string; auxModelId: string }> {
	const file = await readModels(cwd)
	const mainSpec: RouteSpec = isRoute(file.main) ? file.main : { kind: "cline" }
	const auxSpec: RouteSpec = isRoute(file.aux) ? file.aux : mainSpec
	let eliza: ElizaConfig | undefined = opts.eliza
	const build = async (spec: RouteSpec): Promise<ApiHandler> => {
		if (spec.kind === "cline") return clineApi
		const token = readSecret(ELIZA_TOKEN_KEY)
		if (!token) {
			throw new Error('No Eliza token is stored. Run the command "Mycelium: Configure Eliza…" and paste your token.')
		}
		eliza ??= await loadElizaConfig()
		return buildElizaHandler(eliza, spec.model, token)
	}
	const main = await build(mainSpec)
	const auxApi = auxSpec === mainSpec ? main : await build(auxSpec)
	return { main, aux: apiHandlerCaller(auxApi), mainModelId: main.getModel().id, auxModelId: auxApi.getModel().id }
}
