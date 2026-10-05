import { cases, formatsIn } from "./schemars-cases.ts"
import { expect, test } from "vite-plus/test"
import type { TestConfig } from "../../../correctly/tests/public/helpers.ts"
import { setup } from "../../../correctly/tests/public/helpers.ts"
import fixture from "./fixtures/eras/0.8.15.json" with { type: "json" }

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
