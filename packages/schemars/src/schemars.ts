import { isIP } from "node:net"
import { selectSchemarsEra } from "./eras.ts"
import type { SchemaExtension } from "correctly/validators/ajv"

const formats: Record<string, NonNullable<SchemaExtension["formats"]>[string]> =
	{}
for (const bits of [8, 16, 32, 64, 128]) {
	formats[`int${bits}`] = {
		type: "number",
		validate: (value: number) =>
			Number.isInteger(value) &&
			value >= -(2 ** (bits - 1)) &&
			value < 2 ** (bits - 1),
	}
	formats[`uint${bits}`] = {
		type: "number",
		validate: (value: number) =>
			Number.isInteger(value) && value >= 0 && value < 2 ** bits,
	}
}
formats.int = { type: "number", validate: Number.isInteger }
formats.uint = {
	type: "number",
	validate: (value: number) => Number.isInteger(value) && value >= 0,
}
formats.float = {
	type: "number",
	validate: (value: number) =>
		Number.isFinite(value) && Math.abs(value) <= (2 - 2 ** -23) * 2 ** 127,
}
formats.double = { type: "number", validate: Number.isFinite }
formats.ip = { type: "string", validate: (value: string) => isIP(value) !== 0 }
formats.phone = {
	type: "string",
	validate: (value: string) => /^\+[1-9]\d{1,14}$/.test(value),
}

function partialDateTime(value: string): boolean {
	// 0.8.22 assigns this format to BOTH NaiveDateTime and NaiveTime.
	const match =
		/^(?:(\d{4})-(\d{2})-(\d{2})T)?(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?$/.exec(
			value,
		)
	if (!match) return false
	const [, year, month, day, hour, minute, second] = match
	if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 60)
		return false
	if (second === "60" && minute !== "59") return false
	if (year === undefined) return true
	const y = Number(year),
		m = Number(month),
		d = Number(day)
	const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
	return m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]!
}
formats["partial-date-time"] = { type: "string", validate: partialDateTime }

const implementations: Record<string, typeof formats> = {
	"0.8.15": formats,
}

/** Select one reviewed schema contract, using an exact release or closed range. */
export function schemars(options: { version: string }): SchemaExtension {
	const era = selectSchemarsEra(options.version)
	const implementation = implementations[era.since]
	if (!implementation)
		throw new Error(`Schemars era ${era.since} has no validator implementation`)
	return { id: `schemars@${options.version}`, formats: implementation }
}
