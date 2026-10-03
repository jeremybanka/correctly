import type { Ajv } from "ajv"

function unsignedInteger(value: number): boolean {
	return Number.isInteger(value) && value >= 0
}

export function addNumericFormats(ajv: Ajv): void {
	for (const bits of [8, 32, 64])
		ajv.addFormat(`uint${bits}`, {
			type: "number",
			validate: (value: number) => unsignedInteger(value) && value < 2 ** bits,
		})
	// The unqualified format has no declared width; schema bounds still apply.
	ajv.addFormat("uint", { type: "number", validate: unsignedInteger })
	ajv.addFormat("double", { type: "number", validate: Number.isFinite })
}
