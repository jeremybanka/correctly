// Checked against built declarations by test:public; these imports are consumer entrypoints.
import { defineConfig, json, jsonc, yaml, toml, type Engine } from "correctly"
import { ajv } from "correctly/validators/ajv"
import { renovate } from "correctly/extensions/renovate"

export default defineConfig({
	associations: [
		{
			files: ["*.json"],
			parse: json(),
			validate: ajv({ schema: "schema.json", extensions: [renovate()] }),
		},
		{ files: ["*.jsonc"], parse: jsonc(), validate: null },
		{ files: ["*.yaml"], parse: yaml(), validate: null },
		{ files: ["*.toml"], parse: toml(), validate: null },
	],
})

// Never executed: preserve the public validation result's consumer types.
export async function validationTypes(engine: Engine) {
	const result = await engine.validate("data.json", '{"name":"ok"}')
	const diagnostics: readonly { code: string; message: string }[] =
		result.diagnostics
	return diagnostics
}
