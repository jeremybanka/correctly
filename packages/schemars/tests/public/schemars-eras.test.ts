import { readFileSync } from "node:fs"
import { expect, test } from "vite-plus/test"
import { schemarsEras } from "../../src/index.ts"
import { schemars } from "../../src/ajv.ts"
import { selectSchemarsEra } from "../../src/select-era.ts"
import { setup } from "../../../correctly/tests/public/helpers.ts"
import type { Corpus } from "../../../../scripts/schemars-contract.ts"

const versions = schemarsEras.flatMap((era) => [...era.versions])
test.each([
	...versions,
	">=0.8.15 <=0.8.22",
	">=0.8.17 <=0.8.20",
	">=0.8.22 <=0.8.22",
	">=1.0.0 <=1.0.3",
	">=1.0.4 <=1.0.5",
	">=1.2.1 <=1.2.2",
	">=1.2.1 <=1.2.3",
	">=1.2.2 <=1.2.3",
])(
	"%s selects the reviewed assertions through executable configuration",
	async (version) => {
		const { engine, file } = await setup(
			{ type: "integer", format: "uint8" },
			{
				associations: [
					{
						files: ["data/**"],
						schema: "schema.json",
						extensions: [`schemars@${version}`],
					},
				],
			},
		)
		expect(await engine.validate(file, "255")).toMatchObject({
			diagnostics: [],
			failures: [],
			association: { extensions: [`schemars@${version}`] },
		})
		expect((await engine.validate(file, "256")).diagnostics[0]?.code).toBe(
			"schema/format",
		)
	},
)
test.each([
	"0.8.14",
	"0.8.23",
	"1.2.4",
	"^0.8.15",
	"0.8",
	"*",
	">=0.8.15",
	">=0.8.15 <0.9.0",
	">=0.8.22 <=0.8.15",
	">=0.8.15 <=0.8.23",
	"0.8.22-alpha.1",
	"00.8.22",
])("%s cannot silently enable unreviewed support", (version) => {
	// @ts-expect-error Exercise JavaScript callers that bypass static validation.
	expect(() => schemars({ version })).toThrow(
		"Unsupported Schemars version selection",
	)
})
test("ranges crossing compatibility eras fail instead of unioning incompatible assertions", () => {
	expect(() => selectSchemarsEra(">=0.8.22 <=1.0.0")).toThrow(
		"crosses compatibility eras",
	)
})
test("the public era catalog cannot be mutated by configuration code", () => {
	expect(Reflect.set(schemarsEras[0].versions, 8, "0.8.23")).toBe(false)
	expect(Reflect.set(schemarsEras[0], "since", "0.8.23")).toBe(false)
	expect(Reflect.set(schemarsEras, schemarsEras.length, {})).toBe(false)
})

const corpus = JSON.parse(
	readFileSync(new URL("./fixtures/eras/1.2.1.json", import.meta.url), "utf8"),
) as Corpus

test.each(["1.2.3", ">=1.2.1 <=1.2.3", ">=1.2.2 <=1.2.3"])(
	"%s retains enum-map, transform, and local-time assertions",
	async (version) => {
		const config = {
			associations: [
				{
					files: ["data/**"],
					schema: "schema.json",
					extensions: [`schemars@${version}`],
				},
			],
		}
		for (const [name, valid, invalid] of [
			["EnumMap", '{"values":{"One":255}}', '{"values":{"Other":1}}'],
			["Transformed", '{"value":"x"}', '{"value":1}'],
			["chrono::NaiveTime", '"23:59:60"', '"2024-02-29T12:00:00"'],
		] as const) {
			const schema = corpus.schemas[name]
			expect(schema, name).toBeDefined()
			const { engine, file } = await setup(schema, config)
			expect(await engine.validate(file, valid), name).toMatchObject({
				failures: [],
				diagnostics: [],
			})
			const rejected = await engine.validate(file, invalid)
			expect(rejected.failures, name).toEqual([])
			expect(rejected.diagnostics.length, name).toBeGreaterThan(0)
		}
	},
)
