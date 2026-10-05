# Correctly

Compose parsers and validators in one TypeScript configuration for CI and editors.

```ts
import { defineConfig, json } from "correctly"
import { ajv } from "correctly/validators/ajv"
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
```

Install `correctly` and `@correctlyjs/schemars` in your project and save this as `correctly.config.ts`, then run `correctly check`. Comline loads the configuration and its imported implementations. Exit codes are 0 for success, 1 for document errors, and 2 for configuration/schema/execution failures. Use `correctly check --format json` for a versioned report or `correctly check --offline` for cached remote schemas.

The VS Code extension and `correctly-lsp --stdio` use the same runtime for diagnostics, completion and hover. Executable configuration runs only in trusted workspaces and reloads after saving; data and schema buffers validate as you type.

Built-in JSON/JSONC parsers and an Ajv adapter support drafts 7 and 2020-12. Schema extensions are explicit per validator. Unsupported formats produce actionable extension requirements. Documents' `$schema` properties remain ordinary data. Correctly does not coerce values, insert defaults, remove properties, format, or fix documents.

See the [guide](docs/guide.md) for migration, adapter contracts, reviewed Schemars eras and precision, discovery, cache policy, diagnostics, and editor behavior.
