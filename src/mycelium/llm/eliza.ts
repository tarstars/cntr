import fs from "node:fs/promises"
import path from "node:path"
import type { ApiHandler } from "@/core/api"
import { OpenAiHandler } from "@/core/api/providers/openai"
import { myceliumHome } from "../home"

/** Secret (VS Code SecretStorage) holding the user's personal Eliza token. */
export const ELIZA_TOKEN_KEY = "myceliumElizaToken"

/** Non-secret Eliza connection settings. The endpoint is private, so it is never built in. */
export interface ElizaConfig {
	baseUrl: string
	format: "openai"
	authHeader: string
	authScheme: string
}

/** Keys in ~/.mycelium/.env (or the environment, which wins). See mycelium.env.example. */
const KEYS = { baseUrl: "ELIZA_BASE_URL", authHeader: "ELIZA_AUTH_HEADER", authScheme: "ELIZA_AUTH_SCHEME" } as const

/** ~/.mycelium/.env: private settings kept outside every repository. */
export const myceliumEnvFile = () => path.join(myceliumHome(), ".env")

/** KEY=value lines; `#` comments, an `export ` prefix and surrounding quotes are allowed. */
export function parseDotenv(text: string): Record<string, string> {
	const out: Record<string, string> = {}
	for (const line of text.split(/\r?\n/)) {
		const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
		if (!m) continue
		let value = m[2]
		const q = value[0]
		if ((q === '"' || q === "'") && value.endsWith(q) && value.length >= 2) value = value.slice(1, -1)
		else value = value.replace(/\s+#.*$/, "")
		out[m[1]] = value
	}
	return out
}

async function readEnvFile(): Promise<Record<string, string>> {
	try {
		return parseDotenv(await fs.readFile(myceliumEnvFile(), "utf8"))
	} catch {
		return {}
	}
}

/** Eliza settings from the environment, else ~/.mycelium/.env; fails clearly when the endpoint is not set. */
export async function loadElizaConfig(env: Record<string, string | undefined> = process.env): Promise<ElizaConfig> {
	const file = await readEnvFile()
	const get = (key: string) => env[key]?.trim() || file[key]?.trim() || undefined
	const baseUrl = get(KEYS.baseUrl)
	if (!baseUrl) {
		throw new Error(
			`Eliza is not configured: set ${KEYS.baseUrl} in ${myceliumEnvFile()} (see mycelium.env.example), or run "Mycelium: Configure Eliza…".`,
		)
	}
	return {
		baseUrl,
		format: "openai",
		authHeader: get(KEYS.authHeader) ?? "Authorization",
		authScheme: get(KEYS.authScheme) ?? "Bearer",
	}
}

/** Set ELIZA_BASE_URL in ~/.mycelium/.env, keeping every other line; the file is readable by the owner only. */
export async function saveElizaBaseUrl(url: string): Promise<void> {
	let lines: string[] = []
	try {
		lines = (await fs.readFile(myceliumEnvFile(), "utf8")).split(/\r?\n/)
	} catch {
		// new file
	}
	const isKey = (l: string) => new RegExp(`^\\s*(?:export\\s+)?${KEYS.baseUrl}\\s*=`).test(l)
	const kept = lines.filter((l) => !isKey(l))
	while (kept.length && kept[kept.length - 1] === "") kept.pop()
	kept.push(`${KEYS.baseUrl}=${url.trim()}`)
	await fs.mkdir(path.dirname(myceliumEnvFile()), { recursive: true })
	await fs.writeFile(myceliumEnvFile(), `${kept.join("\n")}\n`, { mode: 0o600 })
	await fs.chmod(myceliumEnvFile(), 0o600)
}

/** Eliza is driven through Cline's OpenAI-compatible handler, whose provider id is "openai". */
export const ELIZA_PROVIDER_ID = "openai"

/** An OpenAI-compatible handler pointed at Eliza; the token goes only into the request header. */
export function buildElizaHandler(cfg: ElizaConfig, model: string, token: string): ApiHandler {
	return new OpenAiHandler({
		openAiBaseUrl: cfg.baseUrl,
		openAiApiKey: "eliza",
		openAiModelId: model,
		openAiHeaders: { [cfg.authHeader]: `${cfg.authScheme} ${token}` },
	})
}
