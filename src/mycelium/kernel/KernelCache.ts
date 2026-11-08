/** Rendered kernels, one slot per task (TAO kept a single global slot; per-task slots keep tasks apart). */
export class KernelCache {
	private readonly slots = new Map<string, { key: string; text: string }>()

	get(taskId: string, key: string): string | undefined {
		const slot = this.slots.get(taskId)
		return slot && slot.key === key ? slot.text : undefined
	}

	set(taskId: string, key: string, text: string): void {
		this.slots.set(taskId, { key, text })
	}

	invalidate(taskId: string): void {
		this.slots.delete(taskId)
	}
}
