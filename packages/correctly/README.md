# Correctly

Validate JSON and JSONC in CI and editors using one external schema map.

```json
{
	"files": ["config/**/*.json", "config/**/*.jsonc"],
	"associations": [
		{
			"name": "Application",
			"files": ["config/**"],
			"schema": "schemas/app.json"
		}
	]
}
```

Save as `correctly.config.json`, then run `correctly check`. Exit codes are 0 for success, 1 for document errors, and 2 for configuration/schema/execution failures. Use `correctly check --format json` for a stable report or `correctly check --offline` for cached remote schemas. Formatting never changes results.

The VS Code extension uses the same configuration for diagnostics, completion and hover. Other editors can launch `correctly-lsp --stdio`.

Draft 7 and 2020-12 are supported by separate Ajv validators. Documents' `$schema` properties remain ordinary data. Correctly does not coerce values, insert defaults, remove properties, format, or fix documents.

See the [guide](docs/guide.md) for discovery, precedence, cache policy, diagnostics, editor behavior, and core APIs. JSON/JSONC are supported today; YAML/TOML are future scope.
