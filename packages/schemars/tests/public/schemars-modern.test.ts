import { readFileSync } from "node:fs"
import { expect, test } from "vite-plus/test"
import { schemarsEras } from "../../src/eras.ts"
import {
	setup,
	type TestConfig,
} from "../../../correctly/tests/public/helpers.ts"
import { cases, formatsIn } from "./schemars-cases.ts"
import type { Corpus } from "../../../../scripts/schemars-contract.ts"

const modernCases = { ...cases }
delete modernCases.phone
modernCases["partial-date-time"] = {
	valid: ["2024-02-29T12:00:00", "2016-12-31T23:59:60", "0000-02-29T00:00:00"],
	invalid: [
		"12:00:00",
		"2023-02-29T12:00:00",
		"2024-02-29T12:00:00Z",
		"2024-02-29T24:00:00",
	],
}
modernCases["partial-time"] = {
	valid: ["12:00:00", "00:00:00.123456789", "23:59:60"],
	invalid: [
		"2024-02-29T12:00:00",
		"12:00:00Z",
		"12:00:00+01:00",
		"24:00:00",
		"12:00:60",
		"12:00:00.1234567890",
	],
}
modernCases.duration = {
	valid: ["PT0S", "-PT1.123456789S", "P1Y2M3W4DT5H6M7.8S", "P1W", "PT24H"],
	invalid: [
		"P",
		"PT",
		"P1DT",
		"PT1.1234567890S",
		"PT1S2H",
		"1 hour",
		"P-1D",
		"PT1.5M",
	],
}
modernCases["zoned-date-time"] = {
	valid: [
		"2024-02-29T12:00:00-05:00[America/New_York]",
		"2024-02-29T12:00:00Z[UTC]",
		"2024-02-29T12:00:00.123456789+01:00[+01:00]",
		"2024-02-29T12:00:00+01:02:03[+01:02:03]",
	],
	invalid: [
		"2023-02-29T12:00:00Z[UTC]",
		"2024-02-29T12:00:00[UTC]",
		"2024-02-29T12:00:00Z",
		"2024-02-29T12:00:00+24:00[UTC]",
		"2024-02-29T12:00:00+01:60[UTC]",
		"2024-02-29T12:00:00Z[+99:99]",
		"2024-02-29T24:00:00Z[UTC]",
		"2024-02-29T12:00:00Z[]",
	],
}

for (const era of schemarsEras.slice(1)) {
	const corpus = JSON.parse(
		readFileSync(
			new URL(`./fixtures/eras/${era.since}.json`, import.meta.url),
			"utf8",
		),
	) as Corpus
	const config: TestConfig = {
		associations: [
			{
				files: ["data/**"],
				schema: "schema.json",
				extensions: [`schemars@${era.since}`],
			},
		],
	}
	const generated = new Map<string, Record<string, unknown>>()
	const visit = (schema: unknown) => {
		if (typeof schema !== "object" || schema === null) return
		const object = schema as Record<string, unknown>
		if (typeof object.format === "string" && !generated.has(object.format))
			generated.set(object.format, object)
		Object.values(object).forEach(visit)
	}
	visit(corpus.schemas)
	test(`${era.since} covers every generated format`, () => {
		expect([...formatsIn(corpus.schemas)].sort()).toEqual(
			Object.keys(modernCases).sort(),
		)
	})
	test.each(Object.entries(corpus.schemas))(
		`compiles Schemars era ${era.since} output for %s`,
		async (_name, schema) => {
			const { engine } = await setup(schema, config)
			await expect(engine.prepare()).resolves.toBeUndefined()
		},
	)
	for (const $schema of [
		"http://json-schema.org/draft-07/schema#",
		"https://json-schema.org/draft/2020-12/schema",
	]) {
		test.each(Object.entries(modernCases))(
			`${era.since} asserts %s in ${$schema}`,
			async (format, values) => {
				const { engine, file } = await setup(
					{ ...generated.get(format), $schema },
					config,
				)
				for (const value of values.valid)
					expect(
						await engine.validate(file, JSON.stringify(value)),
						`${format}: ${String(value)}`,
					).toMatchObject({ failures: [], diagnostics: [] })
				for (const value of values.invalid) {
					const result = await engine.validate(file, JSON.stringify(value))
					expect(result.failures).toEqual([])
					expect(
						result.diagnostics.map((d) => d.code),
						`${format}: ${String(value)}`,
					).toContain("schema/format")
				}
			},
		)
	}
	test(`${era.since} preserves nonzero and nested constraints`, async () => {
		for (const [name, schema] of Object.entries(corpus.schemas)) {
			if (!name.startsWith("NonZero")) continue
			const { engine, file } = await setup(schema, config)
			expect(await engine.validate(file, "1")).toMatchObject({
				failures: [],
				diagnostics: [],
			})
			expect(
				(await engine.validate(file, "0")).diagnostics.length,
			).toBeGreaterThan(0)
		}
		const { engine, file } = await setup(corpus.schemas.Wrapper, config)
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
		expect(
			(
				await engine.validate(
					file,
					JSON.stringify({
						optional: 65536,
						list: [128],
						tuple: [true, -1],
						result: { Ok: -1 },
					}),
				)
			).diagnostics.length,
		).toBeGreaterThan(0)
	})
	test(`${era.since} enforces enum map and transform behavior`, async () => {
		const map = await setup(corpus.schemas.EnumMap, config)
		expect(
			await map.engine.validate(map.file, '{"values":{"One":1}}'),
		).toMatchObject({ failures: [], diagnostics: [] })
		expect(
			(await map.engine.validate(map.file, '{"values":{"Other":1}}'))
				.diagnostics.length > 0,
		).toBe(era.since === "1.2.0" || era.since === "1.2.1")
		const transformed = await setup(corpus.schemas.Transformed, config)
		const result = await transformed.engine.validate(
			transformed.file,
			'{"value":"x"}',
		)
		expect(result.failures).toEqual([])
		expect(result.diagnostics.length === 0).toBe(era.since === "1.2.1")
	})
	test(`${era.since} preserves flattened enum behavior`, async () => {
		const fixed = ["1.1.0", "1.2.0", "1.2.1"].includes(era.since)
		const flattened = await setup(corpus.schemas.Flattened, config)
		const variant = await flattened.engine.validate(
			flattened.file,
			'{"One":null}',
		)
		expect(variant.failures).toEqual([])
		expect(variant.diagnostics.length === 0).toBe(fixed)
		expect(
			(await flattened.engine.validate(flattened.file, "{}")).diagnostics
				.length,
		).toBeGreaterThan(0)
		expect(
			(
				await flattened.engine.validate(
					flattened.file,
					'{"One":null,"Two":null}',
				)
			).diagnostics.length,
		).toBeGreaterThan(0)
		const optional = await setup(corpus.schemas.FlattenedOptional, config)
		expect(
			(await optional.engine.validate(optional.file, "{}")).diagnostics
				.length === 0,
		).toBe(fixed)
	})
}

test("1.2 enum maps permit empty maps while rejecting unknown keys", async () => {
	for (const version of ["1.1.0", "1.2.0"] as const) {
		const corpus = JSON.parse(
			readFileSync(
				new URL(`./fixtures/eras/${version}.json`, import.meta.url),
				"utf8",
			),
		) as Corpus
		const { engine, file } = await setup(corpus.schemas.EnumMap, {
			associations: [
				{
					files: ["data/**"],
					schema: "schema.json",
					extensions: [`schemars@${version}`],
				},
			],
		})
		expect((await engine.validate(file, '{"values":{}}')).diagnostics).toEqual(
			[],
		)
	}
})
