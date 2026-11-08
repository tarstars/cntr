import { Logger } from "@/shared/services/Logger"
import { ClineSyncStorage } from "@/shared/storage/ClineStorage"
import { SecretKeys } from "@/shared/storage/state-keys"

/** The part of vscode.SecretStorage this store needs (kept structural so tests need no VS Code). */
export interface SecretStorageLike {
	get(key: string): Thenable<string | undefined>
	store(key: string, value: string): Thenable<void>
	delete(key: string): Thenable<void>
	onDidChange?(listener: (e: { key: string }) => unknown): { dispose(): unknown }
}

/** Every secret key Mycelium knows up front: Cline's keys plus our own. */
export const MYCELIUM_SECRET_KEYS: readonly string[] = [...SecretKeys, "myceliumElizaToken"]

/**
 * VS Code SecretStorage cannot list its keys, so the names of every key ever stored are kept
 * in one extra secret. This lets custom keys (e.g. per-server tokens) survive a reload.
 */
const KEY_INDEX = "mycelium:secretKeyIndex"

/**
 * Secrets store backed by VS Code SecretStorage (OS keychain) instead of Cline's plaintext
 * ~/.cline/data/secrets.json. Reads are served synchronously from a cache filled at load time;
 * writes go to the cache at once and to SecretStorage in the background.
 */
export class VsCodeSecretSyncStorage extends ClineSyncStorage<string> {
	protected name = "Secrets"
	private readonly cache = new Map<string, string>()
	private readonly index = new Set<string>()

	private constructor(private readonly storage: SecretStorageLike) {
		super()
	}

	static async load(storage: SecretStorageLike, knownKeys: readonly string[]): Promise<VsCodeSecretSyncStorage> {
		const store = new VsCodeSecretSyncStorage(storage)
		const indexed = await VsCodeSecretSyncStorage.readIndex(storage)
		const keys = new Set([...knownKeys, ...indexed])
		await Promise.all(
			[...keys].map(async (key) => {
				const value = await storage.get(key)
				if (value !== undefined) {
					store.cache.set(key, value)
					store.index.add(key)
				}
			}),
		)
		storage.onDidChange?.((e) => {
			if (e.key === KEY_INDEX) {
				return
			}
			void store.refresh(e.key)
		})
		return store
	}

	private static async readIndex(storage: SecretStorageLike): Promise<string[]> {
		try {
			const raw = await storage.get(KEY_INDEX)
			const parsed = raw ? JSON.parse(raw) : []
			return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : []
		} catch {
			return []
		}
	}

	/** Pull one key from SecretStorage after another window changed it. */
	private async refresh(key: string): Promise<void> {
		const value = await this.storage.get(key)
		if (value === undefined) {
			this.cache.delete(key)
		} else {
			this.cache.set(key, value)
		}
		this.fireChange(key)
	}

	public setBatch(entries: Record<string, string | undefined>): Thenable<void> {
		const writes: Thenable<void>[] = []
		for (const [key, value] of Object.entries(entries)) {
			writes.push(this.write(key, value))
			this.fireChange(key)
		}
		return Promise.all(writes).then(() => undefined)
	}

	protected _get(key: string): string | undefined {
		return this.cache.get(key)
	}

	protected _set(key: string, value: string | undefined): void {
		void this.write(key, value)
	}

	protected _delete(key: string): void {
		void this.write(key, undefined)
	}

	protected _keys(): readonly string[] {
		return [...this.cache.keys()]
	}

	private async write(key: string, value: string | undefined): Promise<void> {
		const indexChanged = value === undefined ? this.index.delete(key) : !this.index.has(key) && !!this.index.add(key)
		if (value === undefined) {
			this.cache.delete(key)
		} else {
			this.cache.set(key, value)
		}
		try {
			if (value === undefined) {
				await this.storage.delete(key)
			} else {
				await this.storage.store(key, value)
			}
			if (indexChanged) {
				await this.storage.store(KEY_INDEX, JSON.stringify([...this.index]))
			}
		} catch (error) {
			// Never log the value; the key name is enough to diagnose.
			Logger.error(`[Mycelium] failed to persist secret '${key}':`, error instanceof Error ? error.message : error)
		}
	}
}
