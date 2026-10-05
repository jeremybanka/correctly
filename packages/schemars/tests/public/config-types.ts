// Checked by pnpm check and again against the packed package's declarations.
import { defineConfig, json } from "correctly"
import { ajv, type AjvExtension } from "correctly/validators/ajv"
import {
	schemarsEras,
	type SchemarsEra,
	type SchemarsVersion,
	type SchemarsVersionSelection,
} from "@correctlyjs/schemars"
import { schemars } from "@correctlyjs/schemars/ajv"

export default defineConfig({
	associations: [
		{
			files: ["turbo.json"],
			parse: json(),
			validate: ajv({
				schema: "https://turbo.build/schema.json",
				extensions: [schemars({ version: ">=0.8.15 <=0.8.22" })],
			}),
		},
	],
})

// Never executed: invalid calls deliberately test the consumer's compile errors.
export function configurationTypes(dynamic: string): AjvExtension[] {
	const since: "0.8.15" = schemarsEras[0].since
	const era: SchemarsEra = schemarsEras[0]
	const exact: SchemarsVersion = era.versions[7]
	const range = ">=0.8.17 <=0.8.20" satisfies SchemarsVersionSelection

	// @ts-expect-error Unsupported exact releases require a new package release.
	schemars({ version: "0.8.23" })
	// @ts-expect-error Unknown upper bounds cannot extend support implicitly.
	schemars({ version: ">=0.8.15 <=0.8.23" })
	// @ts-expect-error Unknown lower bounds cannot extend support implicitly.
	schemars({ version: ">=0.8.14 <=0.8.22" })
	// @ts-expect-error Both endpoints exist, but reversed bounds are invalid.
	schemars({ version: ">=0.8.22 <=0.8.15" })
	// @ts-expect-error Open ranges are not reviewed selections.
	schemars({ version: ">=0.8.15" })
	// @ts-expect-error Reviewed endpoints cannot cross generated-schema eras.
	schemars({ version: ">=0.8.22 <=1.2.2" })
	// @ts-expect-error Even adjacent releases with changed output are separate eras.
	schemars({ version: ">=1.2.0 <=1.2.1" })
	// @ts-expect-error Caret ranges are not reviewed selections.
	schemars({ version: "^0.8.15" })
	// @ts-expect-error Prereleases are not reviewed selections.
	schemars({ version: "0.8.22-alpha.1" })
	// @ts-expect-error The range grammar requires exactly one space.
	schemars({ version: ">=0.8.15  <=0.8.22" })
	// @ts-expect-error Arbitrary strings are not proof of reviewed support.
	schemars({ version: dynamic })
	// @ts-expect-error Only declared era identifiers exist in the public type.
	const unknownEra: SchemarsEra["since"] = "0.8.23"
	// @ts-expect-error Catalog tuples stay readonly for consumers.
	era.versions.push(unknownEra)

	return [
		schemars({ version: "1.2.2" }),
		schemars({ version: ">=1.2.1 <=1.2.2" }),
		schemars({ version: ">=1.0.0 <=1.0.3" }),
		schemars({ version: since }),
		schemars({ version: exact }),
		schemars({ version: range }),
		schemars({ version: ">=0.8.22 <=0.8.22" }),
		...schemarsEras.flatMap((entry) =>
			entry.versions.map((version) => schemars({ version })),
		),
	]
}
