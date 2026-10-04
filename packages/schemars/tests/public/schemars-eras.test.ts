import { expect, test } from "vite-plus/test"
import { schemars, schemarsEras } from "../../src/index.ts"
import { selectSchemarsEra } from "../../src/eras.ts"
import { setup } from "../../../correctly/tests/public/helpers.ts"

const versions = schemarsEras.flatMap((era) => [...era.versions])
test.each([
	...versions,
	">=0.8.15 <=0.8.22",
	">=0.8.17 <=0.8.20",
	">=0.8.22 <=0.8.22",
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
	"1.2.2",
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
	expect(() => schemars({ version })).toThrow(
		"Unsupported Schemars version selection",
	)
})
test("ranges crossing compatibility eras fail instead of unioning incompatible assertions", () => {
	expect(() =>
		selectSchemarsEra(">=0.8.22 <=1.0.0", [
			...schemarsEras,
			{ since: "1.0.0", versions: ["1.0.0"] },
		]),
	).toThrow("crosses compatibility eras")
})
test("the public era catalog cannot be mutated by configuration code", () => {
	expect(() => (schemarsEras[0]!.versions as string[]).push("0.8.23")).toThrow()
})
