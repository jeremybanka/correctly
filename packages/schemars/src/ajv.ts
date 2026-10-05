import { isIP } from "node:net"
import { selectSchemarsEra } from "./select-era.ts"
import type { SchemarsEra, SchemarsVersionSelection } from "./eras.ts"
import type { AjvExtension } from "correctly/validators/ajv"

const formats: Record<string, NonNullable<AjvExtension["formats"]>[string]> = {}
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

const modernFormats = { ...formats }
delete modernFormats.phone
modernFormats["partial-date-time"] = {
	type: "string",
	validate: (value: string) => value.includes("T") && partialDateTime(value),
}
modernFormats["partial-time"] = {
	type: "string",
	validate: (value: string) => !value.includes("T") && partialDateTime(value),
}
modernFormats.duration = {
	type: "string",
	// ISO 8601 Temporal serialization shared by Jiff Span and SignedDuration.
	validate: (value: string) =>
		/^-?P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d{1,9})?S)?)?$/.test(
			value,
		),
}
modernFormats["zoned-date-time"] = {
	type: "string",
	validate: (value: string) => {
		const match =
			/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)(Z|[+-]\d{2}:\d{2}(?::\d{2})?)\[([A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*|[+-]\d{2}:\d{2}(?::\d{2})?)\]$/.exec(
				value,
			)
		if (!match || !partialDateTime(match[1]!)) return false
		const validOffset = (offset: string) =>
			offset === "Z" ||
			(Number(offset.slice(1, 3)) <= 23 &&
				Number(offset.slice(4, 6)) <= 59 &&
				Number(offset.slice(7, 9) || 0) <= 59)
		return (
			validOffset(match[2]!) &&
			(!/^[+-]/.test(match[3]!) || validOffset(match[3]!))
		)
	},
}

const implementations = {
	"0.8.15": formats,
	"0.9.0": modernFormats,
	"1.0.0": modernFormats,
	"1.0.4": modernFormats,
	"1.1.0": modernFormats,
	"1.2.0": modernFormats,
	"1.2.1": modernFormats,
} satisfies Record<SchemarsEra["since"], typeof formats>

/** Select one reviewed schema contract, using an exact release or closed range. */
export function schemars(options: {
	version: SchemarsVersionSelection
}): AjvExtension {
	const era = selectSchemarsEra(options.version)
	const implementation = implementations[era.since]
	if (!implementation)
		throw new Error(`Schemars era ${era.since} has no validator implementation`)
	return { id: `schemars@${options.version}`, formats: implementation }
}
