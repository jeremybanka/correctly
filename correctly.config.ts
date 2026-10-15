import { defineConfig, json } from "./packages/correctly/src/core/index.ts"
import { ajv } from "./packages/correctly/src/validators/ajv.ts"
import { renovate } from "./packages/correctly/src/extensions/renovate.ts"

const schemastore = {
	id: "schemastore",
	annotations: [
		"x-intellij-language-injection",
		"x-intellij-html-description",
		"tsType",
	],
}

export default defineConfig({
	files: ["**/*.json", "**/*.jsonc"],
	exclude: ["**/tests/public/fixtures/**"],
	associations: [
		{
			name: "Changesets",
			files: [".changeset/config.json"],
			parse: json(),
			validate: ajv({ schema: "node_modules/@changesets/config/schema.json" }),
		},
		...(["correctly", "schemars"] as const).map((name) => ({
			name: `breakage (${name})`,
			files: [`packages/${name}/breakage.config.json`],
			validate: ajv({
				schema: `packages/${name}/node_modules/breakage/dist/breakage.main.schema.json`,
			}),
		})),
		{
			name: "Package manifests",
			files: ["**/package.json"],
			validate: ajv({
				schema: "https://www.schemastore.org/package.json",
				extensions: [schemastore],
			}),
		},
		{
			name: "TypeScript",
			files: ["**/tsconfig.json", "**/tsconfig.*.json"],
			packages: ["typescript"],
			validate: ajv({
				schema: "https://www.schemastore.org/tsconfig.json",
				extensions: [schemastore],
			}),
		},
		{
			name: "dprint",
			files: ["dprint.json"],
			packages: [
				"dprint",
				"@dprint/oxc",
				"@dprint/json",
				"@dprint/markdown",
				"@dprint/toml",
				"dprint-plugin-yaml",
			],
			validate: ajv({ schema: "https://dprint.dev/schemas/v0.json" }),
		},
		{
			name: "Renovate",
			files: ["renovate.json"],
			validate: ajv({
				schema: "https://docs.renovatebot.com/renovate-schema.json",
				extensions: [renovate()],
			}),
		},
	],
})
