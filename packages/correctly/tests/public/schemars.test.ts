import { expect, test } from "vite-plus/test"
import type { TestConfig } from "./helpers.ts"
import { setup } from "./helpers.ts"
import fixture from "./fixtures/schemars/eras/0.8.15.json" with { type: "json" }

const config: TestConfig = {
	associations: [
		{
			files: ["data/**"],
			schema: "schema.json",
			extensions: ["schemars@0.8.22"],
		},
	],
}
const dialects = [
	"http://json-schema.org/draft-07/schema#",
	"https://json-schema.org/draft/2020-12/schema",
]
const cases: Record<string, { valid: unknown[]; invalid: unknown[] }> = {}
for (const bits of [8, 16, 32, 64, 128]) {
	const unsignedEnd = 2 ** bits,
		signedEnd = 2 ** (bits - 1)
	cases[`uint${bits}`] = {
		valid: [0, 1, unsignedEnd - Math.max(1, unsignedEnd * 2 ** -53)],
		invalid: [-1, 0.5, unsignedEnd, unsignedEnd * 2],
	}
	cases[`int${bits}`] = {
		valid: [-signedEnd, -1, 0, signedEnd - Math.max(1, signedEnd * 2 ** -53)],
		invalid: [-signedEnd - Math.max(1, signedEnd * 2 ** -52), 0.5, signedEnd],
	}
}
cases.int = { valid: [-Number.MAX_VALUE, 0, Number.MAX_VALUE], invalid: [0.5] }
cases.uint = { valid: [0, Number.MAX_VALUE], invalid: [-1, 0.5] }
const f32Max = (2 - 2 ** -23) * 2 ** 127
cases.float = {
	valid: [-f32Max, 0, 0.1, f32Max, 1e-50],
	invalid: [2 ** 128, -(2 ** 128)],
}
cases.double = {
	valid: [-Number.MAX_VALUE, 0, 0.1, Number.MAX_VALUE],
	invalid: [],
}
cases.ip = {
	valid: ["127.0.0.1", "::1"],
	invalid: ["256.1.1.1", "example.com", "1234::abcd::1"],
}
cases.ipv4 = { valid: ["192.0.2.1"], invalid: ["::1", "256.1.1.1"] }
cases.ipv6 = { valid: ["2001:db8::1"], invalid: ["127.0.0.1", "example.com"] }
cases.date = { valid: ["2024-02-29"], invalid: ["2023-02-29", "2024-13-01"] }
cases["date-time"] = {
	valid: ["2024-02-29T12:00:00Z"],
	invalid: ["2024-02-29T12:00:00", "2023-02-29T12:00:00Z"],
}
cases["partial-date-time"] = {
	valid: [
		"2024-02-29T12:00:00",
		"12:00:00",
		"00:00:00.123456789",
		"2016-12-31T23:59:60",
		"0000-02-29T00:00:00",
	],
	invalid: [
		"2023-02-29T12:00:00",
		"2024-02-29T12:00:00Z",
		"12:00:00+01:00",
		"24:00:00",
		"12:00:60",
		"12:00:00.1234567890",
		"2024-00-01T00:00:00",
		"2024-01-00T00:00:00",
	],
}
cases.phone = {
	valid: ["+12025550123", "+123456789012345"],
	invalid: [
		"2025550123",
		"+01234",
		"+1234567890123456",
		"+1 (202) 555-0123",
		"phone",
	],
}
cases.uri = {
	valid: ["https://example.com/"],
	invalid: ["relative/path", "not a uri"],
}
cases.email = { valid: ["person@example.com"], invalid: ["not-an-email", "x@"] }
cases.uuid = {
	valid: ["123e4567-e89b-12d3-a456-426614174000"],
	invalid: ["not-a-uuid"],
}

function formatsIn(value: unknown, result = new Set<string>()): Set<string> {
	if (typeof value !== "object" || value === null) return result
	if ("format" in value && typeof value.format === "string")
		result.add(value.format)
	for (const child of Object.values(value)) formatsIn(child, result)
	return result
}

test("the pinned generator's complete format inventory has behavioral coverage", () => {
	expect([...generatedFormats.keys()].sort()).toEqual(Object.keys(cases).sort())
	expect([...formatsIn(fixture.schemas)].sort()).toEqual(
		Object.keys(cases).sort(),
	)
})

test.each(Object.entries(fixture.schemas))(
	"compiles real schemars 0.8.22 output for %s",
	async (_name, schema) => {
		const { engine } = await setup(schema, config)
		await expect(engine.prepare()).resolves.toBeUndefined()
	},
)

const generatedFormats = new Map<string, Record<string, unknown>>()
for (const schema of [
	...Object.values(fixture.schemas),
	...Object.values(fixture.schemas.Attributes.properties),
]) {
	if (
		"format" in schema &&
		typeof schema.format === "string" &&
		!("minimum" in schema && schema.minimum === 1) &&
		!("not" in schema)
	)
		generatedFormats.set(schema.format, schema)
}

for (const $schema of dialects) {
	test.each(Object.entries(cases))(
		`asserts %s bounds and syntax in ${$schema}`,
		async (format, values) => {
			const numeric = /^(?:u?int|float|double)/.test(format)
			const { engine, file } = await setup(
				{ ...generatedFormats.get(format), $schema },
				config,
			)
			for (const value of values.valid) {
				expect(
					await engine.validate(file, JSON.stringify(value)),
					`${format}: ${String(value)}`,
				).toMatchObject({ failures: [], diagnostics: [] })
			}
			for (const value of values.invalid) {
				const result = await engine.validate(file, JSON.stringify(value))
				expect(result.failures).toEqual([])
				expect(
					result.diagnostics.map((d) => d.code),
					`${format}: ${String(value)}`,
				).toContain("schema/format")
			}
			if (numeric)
				for (const raw of ["1e400", "-1e400"]) {
					const result = await engine.validate(file, raw)
					expect(result.failures).toEqual([])
					expect(result.diagnostics.length).toBeGreaterThan(0)
				}
		},
	)
}

test("generated schemas enforce nonzero constraints and nested Rust types", async () => {
	for (const [name, schema] of Object.entries(fixture.schemas)) {
		if (!name.startsWith("NonZero")) continue
		const { engine, file } = await setup(schema, config)
		expect(await engine.validate(file, "1")).toMatchObject({
			failures: [],
			diagnostics: [],
		})
		const zero = await engine.validate(file, "0")
		expect(zero.failures).toEqual([])
		expect(zero.diagnostics.length).toBeGreaterThan(0)
	}
	const { engine, file } = await setup(fixture.schemas.Wrapper, config)
	expect(
		await engine.validate(
			file,
			JSON.stringify({
				optional: null,
				list: [127],
				tuple: [true, 42],
				result: { Ok: 4 },
			}),
		),
	).toMatchObject({ failures: [], diagnostics: [] })
	const invalid = await engine.validate(
		file,
		JSON.stringify({
			optional: 65536,
			list: [128],
			tuple: [true, -1],
			result: { Ok: -1 },
		}),
	)
	expect(invalid.failures).toEqual([])
	expect(
		invalid.diagnostics
			.filter((d) => d.code === "schema/format")
			.map((d) => d.pointer),
	).toEqual(
		expect.arrayContaining(["/optional", "/list/0", "/tuple/1", "/result/Ok"]),
	)
})

test("numeric precision follows the parsed JavaScript value explicitly", async () => {
	const { engine, file } = await setup(fixture.schemas.u64, config)
	expect(await engine.validate(file, "9007199254740993")).toMatchObject({
		failures: [],
		diagnostics: [],
	})
	// This valid Rust u64 rounds UP to 2^64 in JavaScript and is rejected.
	expect(
		(await engine.validate(file, "18446744073709551615")).diagnostics[0]?.code,
	).toBe("schema/format")
	expect(
		(await engine.validate(file, "18446744073709551616")).diagnostics[0]?.code,
	).toBe("schema/format")
})
