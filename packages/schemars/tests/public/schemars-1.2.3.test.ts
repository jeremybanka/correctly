import { readFileSync } from "node:fs"
import { expect, test } from "vite-plus/test"
import { setup } from "../../../correctly/tests/public/helpers.ts"
import type { Corpus } from "../../../../scripts/schemars-contract.ts"

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
