import { readFileSync } from "node:fs"
import { expect, test } from "vite-plus/test"
import { setup } from "../../../correctly/tests/public/helpers.ts"
import type { Corpus } from "../../../../scripts/schemars-contract.ts"

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
