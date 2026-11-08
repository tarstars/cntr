import fs from "node:fs"
import { afterEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { type SecretStorageLike, VsCodeSecretSyncStorage } from "../VsCodeSecretSyncStorage"

class FakeSecretStorage implements SecretStorageLike {
	data = new Map<string, string>()
	listeners: Array<(e: { key: string }) => void> = []
	storeCalls: Array<[string, string]> = []
	deleteCalls: string[] = []
	async get(key: string) {
		return this.data.get(key)
	}
	async store(key: string, value: string) {
		this.storeCalls.push([key, value])
		this.data.set(key, value)
	}
	async delete(key: string) {
		this.deleteCalls.push(key)
		this.data.delete(key)
	}
	onDidChange(listener: (e: { key: string }) => void) {
		this.listeners.push(listener)
		return { dispose: () => undefined }
	}
	/** Simulate another VS Code window changing a secret. */
	externalSet(key: string, value: string) {
		this.data.set(key, value)
		for (const l of this.listeners) l({ key })
	}
}

const tick = () => new Promise((r) => setImmediate(r))

describe("VsCodeSecretSyncStorage", () => {
	afterEach(() => sinon.restore())

	it("load preloads known keys", async () => {
		const fake = new FakeSecretStorage()
		fake.data.set("openAiApiKey", "sk-test")
		const store = await VsCodeSecretSyncStorage.load(fake, ["openAiApiKey", "anthropicApiKey"])
		;(store.get("openAiApiKey") as string).should.equal("sk-test")
		;(store.get("anthropicApiKey") === undefined).should.be.true()
	})

	it("set writes through", async () => {
		const fake = new FakeSecretStorage()
		const store = await VsCodeSecretSyncStorage.load(fake, [])
		store.set("k", "v")
		await tick()
		fake.storeCalls.should.containDeep([["k", "v"]])
		;(store.get("k") as string).should.equal("v")
	})

	it("delete removes from both the cache and the storage", async () => {
		const fake = new FakeSecretStorage()
		fake.data.set("k", "v")
		const store = await VsCodeSecretSyncStorage.load(fake, ["k"])
		store.delete("k")
		await tick()
		;(store.get("k") === undefined).should.be.true()
		fake.data.has("k").should.be.false()
	})

	it("setBatch writes every entry and deletes undefined ones", async () => {
		const fake = new FakeSecretStorage()
		fake.data.set("old", "x")
		const store = await VsCodeSecretSyncStorage.load(fake, ["old"])
		await store.setBatch({ a: "1", old: undefined })
		;(store.get("a") as string).should.equal("1")
		fake.data.has("old").should.be.false()
	})

	it("keys stored under unknown names survive a reload", async () => {
		const fake = new FakeSecretStorage()
		const first = await VsCodeSecretSyncStorage.load(fake, [])
		first.set("custom_server_token", "t")
		await tick()
		const second = await VsCodeSecretSyncStorage.load(fake, [])
		;(second.get("custom_server_token") as string).should.equal("t")
	})

	it("refreshes the cache when another window changes a secret", async () => {
		const fake = new FakeSecretStorage()
		const store = await VsCodeSecretSyncStorage.load(fake, ["k"])
		const seen: string[] = []
		store.onDidChange((e) => seen.push(e.key))
		fake.externalSet("k", "new")
		await tick()
		;(store.get("k") as string).should.equal("new")
		seen.should.containEql("k")
	})

	it("never touches the filesystem", async () => {
		const w1 = sinon.spy(fs, "writeFileSync")
		const w2 = sinon.spy(fs.promises, "writeFile")
		const fake = new FakeSecretStorage()
		const store = await VsCodeSecretSyncStorage.load(fake, ["k"])
		store.set("k", "v")
		await store.setBatch({ a: "1" })
		await tick()
		w1.called.should.be.false()
		w2.called.should.be.false()
	})
})
