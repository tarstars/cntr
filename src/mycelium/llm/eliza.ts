import fs from "node:fs/promises"
import path from "node:path"
import type { ApiHandler } from "@/core/api"
import { OpenAiHandler } from "@/core/api/providers/openai"
import { myceliumHome } from "../home"

/** Secret (VS Code SecretStorage) holding the user's personal Eliza token. */
export const ELIZA_TOKEN_KEY = "myceliumElizaToken"

/** Non-secret Eliza connection settings, from ~/.mycelium/eliza.json (see the private Eliza notes). */
export interface ElizaConfig {
	baseUrl: string
	format: "openai"
	authHeader: string
	authScheme: string
}

/** Eliza: an OpenAI-compatible gateway; header and scheme come from the private settings. */
export const DEFAULT_ELIZA: ElizaConfig = {
	baseUrl: "https://gateway.example/v1",
	format: "openai",
	authHeader: "Authorization",
	authScheme: "Bearer",
}

export const elizaConfigFile = () => path.join(myceliumHome(), "eliza.json")

export async function loadElizaConfig(): Promise<ElizaConfig> {
	try {
		return { ...DEFAULT_ELIZA, ...JSON.parse(await fs.readFile(elizaConfigFile(), "utf8")) }
	} catch {
		return DEFAULT_ELIZA
	}
}

/** An OpenAI-compatible handler pointed at Eliza; the token goes only into the request header. */
/** Eliza is driven through Cline's OpenAI-compatible handler, whose provider id is "openai". */
export const ELIZA_PROVIDER_ID = "openai"

export function buildElizaHandler(cfg: ElizaConfig, model: string, token: string): ApiHandler {
	return new OpenAiHandler({
		openAiBaseUrl: cfg.baseUrl,
		openAiApiKey: "eliza",
		openAiModelId: model,
		openAiHeaders: { [cfg.authHeader]: `${cfg.authScheme} ${token}` },
	})
}
