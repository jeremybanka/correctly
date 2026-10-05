# Correctly

Compose JSON, JSONC, YAML, and TOML parsers with validators in one TypeScript configuration for CI and editors.

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

The VS Code extension and `correctly-lsp --stdio` use the same runtime for diagnostics in every supported format, with completion and hover for JSON/JSONC. Executable configuration runs only in trusted workspaces and reloads after saving; data and schema buffers validate as you type.

Built-in `json()`, `jsonc()`, `yaml()`, and `toml()` parsers compose with the Ajv adapter for drafts 7 and 2020-12 or with custom validators accepting JSON values. File extensions select the default parser; explicit `parse` overrides it. Schema extensions are explicit per validator. Unsupported schema formats produce actionable extension requirements. Documents' `$schema` properties remain ordinary data. Correctly does not coerce values, insert defaults, remove properties, format, or fix documents.

See the [guide](docs/guide.md) for migration, adapter contracts, reviewed Schemars eras and precision, discovery, cache policy, diagnostics, and editor behavior.
