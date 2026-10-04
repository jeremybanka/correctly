import { defineConfig, json } from "./packages/correctly/src/core/index.ts"
import { ajv } from "./packages/correctly/src/validators/ajv.ts"

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
	],
})
