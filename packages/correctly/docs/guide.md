# Correctly guide

## One configuration for CI and editors

Create `correctly.config.json`:

```json
{
	"files": ["config/**/*.json", "config/**/*.jsonc"],
	"exclude": ["config/generated/**"],
	"associations": [
		{
			"name": "Application",
			"files": ["config/**"],
			"schema": "schemas/application.json"
		},
		{
			"name": "Local settings",
			"files": ["config/local.json"],
			"mode": "jsonc",
			"schema": null
		}
	],
	"remote": {
		"offline": false,
		"cacheDir": ".correctly-cache",
		"timeoutMs": 5000,
		"maxBytes": 2097152,
		"maxRequests": 64
	}
}
```

Configuration is strict JSON, validated by the exported `correctly/config.schema.json`. Unknown configuration properties, invalid modes, and duplicate keys fail. There is no executable configuration, implicit merging, or second editor map.

## Discovery, paths and precedence

`correctly check` discovers the nearest configuration by searching upward from the invocation directory. `--config path` overrides discovery and resolves from that directory. CLI discovery selects one project; invoke once per independent workspace root. Explicit document paths also resolve from the invocation directory and must be included by that project's patterns.

Editors choose the longest workspace root containing a file, then search upward from the file's directory, stopping at that root. Nested configurations override parent configurations completely. Sibling roots remain independent. Missing configurations become editor diagnostics. Unsaved configuration contents, including newly opened configs, participate in discovery.

File patterns, exclusions, local schema paths, and cache paths resolve from the configuration directory. Patterns use forward slashes, can match dotfiles, and must be relative without `..` or leading `!`. Use `exclude` instead of negated patterns. `files` defaults to `**/*.json` and `**/*.jsonc`. Built-in exclusions cover `node_modules`, `.git`, `dist`, `artifacts`, and `.correctly-cache`; configured cache directories inside the project are also excluded. User exclusions add to these defaults. Excluded files are skipped.

Associations are ordered: the **last matching rule wins**. A matching association's `mode` overrides the extension; otherwise `.jsonc` selects JSONC and other files use strict JSON. A null schema explicitly requests syntax-only coverage. Unassociated included documents are also syntax-checked and reported as `syntax-only`; missing coverage does not fail the command. Reports include the matched index, name, schema URI, mode, and coverage. Association patterns do not expand the project's `files` list.

## Parsing and validation

Strict JSON rejects comments and trailing commas; JSONC allows both. Both modes reject duplicate object keys, including escaped duplicates, and preserve useful source ranges and JSON pointers. Incomplete editor documents receive syntax diagnostics and tolerant completion/hover; Ajv validates values only once syntax is valid. UTF-16 ranges are zero-based and compatible with LSP; readable CLI locations are one-based. Duplicate-key diagnostics point to the second key, value errors point to the value, disallowed-property errors point to the key, and missing-property errors point to the containing object's start and retain the missing property's pointer.

Document `$schema` is always ordinary data. It is neither removed nor used to select a schema, and a schema can reject that property with `additionalProperties: false`. This also holds for editor hints and unassociated documents. Schema documents' own `$schema` fields retain dialect meaning.

Ajv provides authoritative validation in both CLI and LSP. Separate instances support draft 7 and draft 2020-12, including prefixItems, unevaluatedProperties, and dynamic references. Root schemas without `$schema` default to draft 7; referenced resources without one inherit the referencing dialect. Unknown dialects, mixed-dialect graphs, unsupported required vocabularies, unresolved references, invalid schemas, and unknown validation keywords fail visibly. Standard 2020-12 core/applicator/unevaluated/validation/metadata/format-annotation/content vocabularies are recognized. Required format-assertion vocabulary and custom required vocabularies are not supported. ajv-formats applies its supported format checks in both drafts; unknown formats fail compilation. Content decoding/validation is not performed. `$async` is unsupported.

Descriptive Microsoft schema extensions, such as `markdownDescription`, `enumDescriptions`, and `defaultSnippets`, are treated as annotations. No values are coerced, no defaults are inserted, and no properties are removed. Formatting is outside validation.

## References and cache

Schema associations accept local paths, `file:` URIs, and HTTP(S) URLs, optionally with pointer or anchor fragments. Relative references resolve from their schema resource's `$id`, or its retrieval URI when there is no identifier. Relative `$id` values are resolved from their parent resource. Configured schema resources are registered before compilation, so identifiers can refer to other configured local schemas without needing to host them. References to unloaded identifiers use the loader. Cycles and nested resources are resolved by Ajv. Only supported dialect graphs are accepted.

Remote requests have a total timeout per resource, a byte limit, at most five redirects, and a resource-count limit per engine. Defaults are shown above; maximum configuration values are 60 seconds, 16 MiB, and 256 resources. Cache entries are keyed by the full retrieval URL without its fragment. Online loads refresh cache entries and send ETag/Last-Modified validators when available. Requests without validators fetch again. Network or HTTP failures never silently fall back to stale cache. Local and loaded remote resources and compiled validators are reused for the life of an engine.

`correctly check --offline` prevents all HTTP requests; a missing or corrupt cached schema fails with exit 2. Warm the cache with an online check, retain the cache directory in CI, then validate offline. Local references still work offline. Cache location is explicit and portable when kept with the project's CI cache. Schema resource size limits also apply to local schemas.

Editor watchers refresh configurations and local schemas, including schemas outside workspace roots through explicit dependency watchers; unsaved schema edits also invalidate validators and hints. Relevant schema/configuration changes and server restart refresh remote schemas. Cache writes and unrelated JSON changes do not trigger reloads. Remote servers do not send change notifications, so remote changes require one of those refresh triggers. Cancellation and document version/generation guards prevent older work from publishing diagnostics or hints after newer edits. Closing a buffer returns it to disk contents; closing a document clears its diagnostics.

## CLI and report contract

```sh
correctly check
correctly check --config config/correctly.config.json
correctly check config/application.json --format json
correctly check --offline
correctly-lsp --stdio
```

Exit 0 means no validation or infrastructure failures; exit 1 means at least one invalid document; exit 2 means a configuration/schema/loading/execution failure, which takes priority over document errors. All configured associations are prepared even when their patterns match no documents, preventing unused broken schema maps from going unnoticed. Readable output identifies every file's coverage and selected association. JSON output is a single object without progress text or a filtering workaround.

`reportVersion: 1` contains `config`, sorted `files`, top-level `failures`, `summary`, and `exitCode`. Each file has `file`, `mode`, `coverage`, `association`, `diagnostics`, and `failures`. Diagnostics contain `code`, `message`, `pointer`, `offset`, `length`, and `range`; failures contain `code`, `message`, and optionally `file`. Paths are absolute. Messages reflect the pinned validator/parser versions; consumers should use codes and pointers rather than parsing message prose.

## Editor installation and shared APIs

From the repository, run `pnpm build:vsix`, then `code --install-extension artifacts/Correctly-0.0.1.vsix`. The universal VSIX bundles the client and server and needs no npm dependencies on the editor machine. Open a workspace with a configuration to activate JSON/JSONC support. The extension's **Correctly: Restart Server** command refreshes its lifecycle. Other LSP clients launch `correctly-lsp --stdio` and must send workspace folders and file-change notifications for automatic disk refresh. No formatter or automatic fixes are registered.

Microsoft's JSON language service supplies completions and hover. Its AST is retained with traversal methods bound to the original document; a selection view disables automatic embedded `$schema` selection. Ajv remains the validation authority. Built-in VS Code JSON features may independently provide suggestions/diagnostics; set `json.validate.enable` to `false` to use only Correctly validation, if desired.

The package root exports `loadProject`, `Engine`, `SchemaStore`, parser/location utilities, configuration discovery/matching, and report/diagnostic types:

```ts
import { Engine, loadProject } from "correctly"

const engine = new Engine(await loadProject("/project/correctly.config.json"))
await engine.prepare()
const result = await engine.validate("/project/config/app.json", sourceText)
```

The core owns association, loading, and validation; parsing is isolated in its own module. The validation layer consumes a value, diagnostics, and a pointer-to-source-span locator without depending on the JSON AST. A future YAML/TOML adapter must supply equivalent pointer/source mapping and explicit format semantics before becoming a supported mode. Those formats are not accepted by the initial configuration schema.
