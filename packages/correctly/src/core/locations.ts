import type { SourceSpan } from "./parse.ts"

// Missing properties use the nearest containing value, as they do in JSON.
export class Locations {
	readonly values = new Map<string, SourceSpan>()
	readonly keys = new Map<string, SourceSpan>()
	readonly locate = (pointer: string, key = false): SourceSpan | undefined => {
		let current = pointer
		while (true) {
			const span =
				(key ? this.keys.get(current) : undefined) ?? this.values.get(current)
			if (span) return span
			if (!current) return undefined
			current = current.slice(0, current.lastIndexOf("/"))
		}
	}
}
