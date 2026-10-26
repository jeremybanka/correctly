import type { AjvExtension } from "../../../src/validators/ajv.ts"

// Small, fixed predicates exercise Correctly's extension API independently.
export function testExtension(): AjvExtension {
	return {
		id: "test-extension",
		formats: Object.fromEntries([8, 16, 32].map((bits) => [
			`uint${bits}`,
			{ type: "number", validate: (value: number) => Number.isInteger(value) && value >= 0 && value < 2 ** bits },
		])),
	}
}
