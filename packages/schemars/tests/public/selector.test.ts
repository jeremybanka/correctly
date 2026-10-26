import { expect, test } from "vite-plus/test"
import { selectSchemarsEra } from "../../src/select-era.ts"
import catalog from "./fixtures/catalog.json" with { type: "json" }

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
	expect(() => selectSchemarsEra(version, catalog)).toThrow(
		"Unsupported Schemars version selection",
	)
})
test("ranges crossing compatibility eras fail instead of unioning incompatible assertions", () => {
	expect(() => selectSchemarsEra(">=0.8.22 <=1.0.0", catalog)).toThrow(
		"crosses compatibility eras",
	)
})

for (const era of catalog) {
	test.each([...era.versions, `>=${era.versions[0]} <=${era.versions.at(-1)}`])(
		"%s selects its fixture era",
		(selection) => {
			expect(selectSchemarsEra(selection, catalog)).toBe(era)
		},
	)
}
