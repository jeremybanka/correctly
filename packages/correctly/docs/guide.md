# Correctly guide

## One configuration for CI and editors

Install Correctly in the project (`pnpm add -D correctly`) and create `correctly.config.ts`:

```ts
import { defineConfig, json, jsonc } from "correctly"
import { ajv } from "correctly/validators/ajv"

export default defineConfig({
	files: ["config/**/*.json", "config/**/*.jsonc"],
	exclude: ["config/generated/**"],
	associations: [
		{
			name: "Application",
			files: ["config/**"],
			parse: json(),
			validate: ajv({ schema: "schemas/application.json" }),
		},
		{ files: ["config/local.json"], parse: jsonc(), validate: null },
	],
	remote: {
		offline: false,
		cacheDir: ".correctly-cache",
		timeoutMs: 5000,
		maxBytes: 2097152,
		maxRequests: 64,
	},
})
```

TypeScript is the only configuration format. Comline 0.9.0 loads the default-exported object, including imported parser, validator, and extension implementations. `defineConfig` preserves inference and checks the runtime contract; configuration loaded without it receives the same checks. Unknown options and malformed adapters fail visibly. There is no configuration JSON Schema or string registry of plugins. Import packages installed in the project or relative modules with explicit extensions. Configuration uses Node's native erasable TypeScript support (Node 22.18 or later), not a separate transpiler: no TypeScript path aliases, enums requiring transformation, top-level await, asynchronous configuration exports, or configuration factory functions. Adapter preparation and validation may be asynchronous.

Configuration and its imports are executable project code. CLI invocation opts into executing that code. The VS Code extension is disabled in untrusted workspaces; other LSP clients must establish trust before starting the server. Both CLI and LSP execute the same configuration in a project worker. Workers provide module-cache isolation and termination, not a security sandbox. Project logging is redirected to stderr so JSON stdout and the LSP transport remain clean.

## Migrating from JSON configuration

Rename `correctly.config.json` to `correctly.config.ts`, export a `defineConfig` object, replace `mode: "jsonc"` with `parse: jsonc()`, and replace `schema: path` with `validate: ajv({ schema: path })`. Syntax-only associations use `validate: null`. Move extension choices inside `ajv({ extensions: [...] })` and pass imported implementations. Remove configuration `$schema` links and references to `correctly/config.schema.json`, which is no longer exported. Explicit `--config` accepts a `.ts` module; legacy JSON configuration is rejected. Machine consumers must accept report version 2, including custom validator coverage.

## Discovery, paths and precedence

`correctly check` discovers the nearest configuration by searching upward from the invocation directory. `--config path` overrides discovery and resolves from that directory. CLI discovery selects one project; invoke once per independent workspace root. Explicit document paths also resolve from the invocation directory and must be included by that project's patterns.

Editors choose the longest workspace root containing a file, then search upward from the file's directory, stopping at that root. Nested configurations override parent configurations completely. Sibling roots remain independent. Missing configurations become editor diagnostics. Executable configuration and imported modules must be saved before discovery or reload. Unsaved edits to those files never execute. Unsaved data and JSON Schema buffers still affect validation.

File patterns, exclusions, local schema paths, and cache paths resolve from the configuration directory. Patterns use forward slashes, can match dotfiles, and must be relative without `..` or leading `!`. Use `exclude` instead of negated patterns. `files` defaults to `**/*.json`, `**/*.jsonc`, `**/*.yaml`, `**/*.yml`, `**/*.toml`, and `**/*.pkl`. Built-in exclusions cover `node_modules`, `.git`, `dist`, `artifacts`, and `.correctly-cache`; configured cache directories inside the project are also excluded. User exclusions add to these defaults. Excluded files are skipped.

Associations are ordered: the **last matching rule wins**. `parse` selects a parser implementation; omitting it selects JSONC for `.jsonc`, YAML for `.yaml`/`.yml`, TOML for `.toml`, PKL for `.pkl`, and strict JSON otherwise. Extension detection is case-insensitive; file patterns retain their usual case-sensitive matching. `validate: null` explicitly requests syntax-only coverage. Unassociated included documents are also syntax-checked and reported as `syntax-only`; missing coverage does not fail the command. Reports include the matched index, name, optional schema URI, parser ID (`mode`), validator ID, extension IDs and coverage. Association patterns do not expand the project's `files` list: include custom file extensions there as well.

### Gitignore exclusions

Import `GITIGNORE` to opt into `.gitignore` rules alongside ordinary exclusion patterns:

```ts
import { defineConfig, GITIGNORE } from "correctly"

export default defineConfig({
	exclude: [GITIGNORE, "config/generated/**"],
	associations: [],
})
```

Without `GITIGNORE`, ignore files have no effect. Rules are case-sensitive and come from `.gitignore` in the configuration directory and applicable subdirectories. Nested rules override parent rules; comments, anchored paths, directory patterns, escapes, and `!` re-inclusions follow Git ignore syntax. A file cannot be re-included while its parent directory is excluded. Re-inclusions do not override ordinary `exclude` patterns or built-in exclusions. Ancestor ignore files above the configuration directory, Git's global excludes, and `.git/info/exclude` are outside this scope. No Git installation or repository is required.

CLI discovery skips ignored files. Explicit CLI paths and core validation report them as `excluded`; editor diagnostics and hints are suppressed. Saved creation, edits, and deletion of `.gitignore` files refresh editor exclusions. Core inclusion checks cache ignore files for the project; load a fresh project to pick up saved changes.

## Parsing and validation

Strict JSON rejects comments and trailing commas; JSONC allows both. Both modes reject duplicate object keys, including escaped duplicates, and preserve useful source ranges and JSON pointers. Incomplete editor documents receive syntax diagnostics; JSON/JSONC also receive tolerant completion/hover; Ajv validates values only once syntax is valid. UTF-16 ranges are zero-based and compatible with LSP; readable CLI locations are one-based. Duplicate-key diagnostics point to the second key, value errors point to the value, disallowed-property errors point to the key, and missing-property errors point to the containing object's start and retain the missing property's pointer.

Document `$schema` is always ordinary data. It is neither removed nor used to select a schema, and a schema can reject that property with `additionalProperties: false`. This also holds for editor hints and unassociated documents. Schema documents' own `$schema` fields retain dialect meaning.

Ajv provides authoritative validation in both CLI and LSP. Separate instances support draft 7 and draft 2020-12, including prefixItems, unevaluatedProperties, and dynamic references. Root schemas without `$schema` default to draft 7; referenced resources without one inherit the referencing dialect. Unknown dialects, mixed-dialect graphs, unsupported required vocabularies, unresolved references, invalid schemas, and unknown validation keywords fail visibly. Standard 2020-12 core/applicator/unevaluated/validation/metadata/format-annotation/content vocabularies are recognized. Required format-assertion vocabulary and custom required vocabularies are not supported. ajv-formats applies its supported format checks in both drafts; unknown formats fail compilation. Content decoding/validation is not performed. `$async` is unsupported.

Descriptive Microsoft schema extensions, such as `markdownDescription`, `enumDescriptions`, and `defaultSnippets`, are treated as annotations. No values are coerced, no defaults are inserted, and no properties are removed. Formatting is outside validation.

## PKL

PKL has its own native types and constraints. Combine the `pkl()` parser with the separate `pkl()` validator:

```ts
import { defineConfig, pkl as parsePkl } from "correctly"
import { pkl } from "correctly/validators/pkl"
import { ajv } from "correctly/validators/ajv"

export default defineConfig({
	files: ["config/**/*.pkl"],
	associations: [
		{
			files: ["config/**/*.pkl"],
			parse: parsePkl(),
			validate: pkl({
				environment: { APP_NAME: "example" },
				properties: { stage: "development" },
				// Optional additional checks on the evaluated JSON output:
				validate: ajv({ schema: "schemas/application.json" }),
			}),
		},
	],
})
```

```pkl
// config/application.pkl
name: String = read("env:APP_NAME")
port: Int(this > 0 && this < 65536) = 8080
stage: String = read("prop:stage")
```

`validate: pkl()` is sufficient for native Pkl validation. The optional nested validator accepts the `json` value model and receives the evaluated output, including exact serialized numeric lexemes. Ajv schemas, extension metadata, and coverage reporting compose normally. JavaScript values use its numeric representation; use an exact-number-aware validator when constraints depend on integer precision beyond JavaScript's safe range.

`.pkl` selects the PKL parser by default. Use explicit `parse: parsePkl()` for broad or brace association patterns and for other extensions. The parser checks syntax and produces the `pkl` value model, represented as the source text; it does not evaluate expressions. `validate: null` and unassociated PKL files remain syntax-only. A direct Ajv association is incompatible; wrap Ajv with the PKL validator to validate evaluated JSON.

The bundled WASM build of [pklr](https://github.com/jdx/pklr) provides types, constrained types, classes, type aliases, expressions, interpolation, functions, collections, local imports/import expressions, `amends`, `extends`, glob imports, and its standard library implementations. Relative module and resource paths resolve from the importing PKL file. Local imports and amendments use the editor's unsaved text buffers and register dependencies so changes refresh dependent diagnostics; missing imports fail visibly. Environment reads see only the supplied `environment` map, and `prop:` reads use `properties`; process environment variables are not exposed automatically.

HTTP(S) modules and pklr-supported `package://` imports use Correctly's host fetch implementation. Relative remote imports resolve against the importing URL. ZIP packages are expanded in WASM memory. Remote timeout, byte, request and redirect limits apply; successful downloads are cached under `<cacheDir>/pkl`. `correctly check --offline` and `remote.offline` forbid network requests and require cached modules/packages. Local resources do not use the remote cache. Evaluation is bounded to 256 resource passes, 512 resources and 16 MiB of loaded resource data; an expanded package permits at most 4096 entries and 16 MiB. Resource and runtime failures use exit code 2; syntax, missing local imports, native type/constraint and evaluation errors use exit code 1.

The CLI, core API, stdio LSP and bundled VSIX share this evaluator. Syntax byte offsets are converted to UTF-16 editor positions. pklr does not expose evaluation source maps: evaluation diagnostics point to the start of the module, and nested JSON Schema diagnostics retain their JSON pointers while using the module's source range. Imported syntax errors identify the source module in the message. PKL does not expose completion/hover through Correctly's JSON Schema editor service.

Compatibility follows the pinned pklr implementation, not an assertion of complete compatibility with Apple's official Pkl runtime or toolchain. Unsupported upstream features fail visibly; project/package dependency resolution is limited to what pklr implements, and its package download conventions do not implement the official package resolver's full metadata/checksum protocol. The bundled build patches inherited module constraint checking. The exact upstream commit, patch, build recipe and license inventory are recorded in `compatibility/pklr/README.md` in the source repository. Consumers need neither Rust nor an external Pkl executable.

## YAML and TOML

The exported `yaml()` and `toml()` factories implement the same `Parser` contract as `json()` and `jsonc()`, with `valueModel: "json"`. Omitting `parse` detects the format by extension; explicit factories also work with other filenames:

```ts
import { defineConfig, yaml, toml } from "correctly"
import { ajv } from "correctly/validators/ajv"

export default defineConfig({
	files: ["config/**/*.{yaml,yml,toml}"],
	associations: [
		{
			files: ["config/**/*.{yaml,yml}"],
			parse: yaml(),
			validate: ajv({ schema: "schemas/application.json" }),
		},
		{
			files: ["config/**/*.toml"],
			parse: toml(),
			validate: ajv({ schema: "schemas/application.json" }),
		},
	],
})
```

```yaml
# config/application.yaml
name: application
color: blue
```

```toml
# config/application.toml
name = "application"
color = "blue"
```

YAML accepts one YAML 1.2 document using the core scalar schema: booleans, null, numbers, and strings, including block strings. Empty YAML documents are null. Mapping keys must be strings; quote numeric or boolean-looking keys. Block and flow collections are supported. Anchors and aliases resolve to JSON values; errors within an alias point to its use. Cyclic aliases and more than 100 alias expansions fail. Merge keys (`<<`) are ordinary string keys, with no implicit merging. YAML 1.1 directives, unknown/custom tags, complex keys, and multiple documents fail visibly.

TOML uses version 1.0. Tables, dotted/quoted keys, inline tables, arrays, and arrays of tables map to JSON objects and arrays. Empty TOML documents are empty objects. Date and time literals validate as strings using their parsed spelling, preserving local values and offset information without converting them to UTC. TOML has no null value. Duplicate keys or table redefinitions fail with `duplicate-key`; the parser reports the offending key segment, without a JSON pointer. Other parse errors use `syntax`.

YAML and TOML both reject non-finite numbers and integers outside JavaScript's safe integer range (−9,007,199,254,740,991 through 9,007,199,254,740,991). Numeric values use binary64; floating-point decimals may round. `rawNumber(pointer)` preserves the exact numeric scalar token, including hexadecimal notation or TOML underscores, and returns undefined for nonnumeric or missing paths. For YAML aliases it returns the anchored number's token while `locate` points to the alias use. A raw token is metadata in the source format, not a guarantee of lossless value validation or a JSON number string. Custom validators can consume it explicitly; Ajv continues to validate the parsed value.

All formats validate only after parsing succeeds. Nested validation errors retain JSON pointers and locations in the original source, including TOML table headers and dotted key segments. Syntax-only rules use `validate: null`. These parsers also compose with custom validators accepting the `json` value model. They omit `editorLanguage`, so YAML/TOML receive diagnostics without JSON completion or hover.

## Schema extensions

Extensions are imported implementations passed to an individual Ajv validator. First-party extensions use exactly the same contract as third-party extensions. Importing one makes it available without enabling it globally:

```ts
import { defineConfig, json } from "correctly"
import { ajv } from "correctly/validators/ajv"
import { schemars } from "@correctlyjs/schemars/ajv"
import { renovate } from "correctly/extensions/renovate"

export default defineConfig({
	associations: [
		{
			files: ["turbo.json"],
			parse: json(),
			validate: ajv({
				schema: "https://turbo.build/schema.json",
				extensions: [schemars({ version: "0.8.22" })],
			}),
		},
		{
			files: ["renovate.json"],
			validate: ajv({
				schema: "schemas/renovate.json",
				extensions: [renovate()],
			}),
		},
	],
})
```

Use a separate association and the appropriate schema path for each tool, for example Oxlint's `node_modules/oxlint/configuration_schema.json`. An extension applies to that validator's entire schema reference graph. A referenced resource does not inherit extension choices from another association. The same schema URI can use different extension sets. Prepared validators are cached by adapter object identity within a project session, never by display ID or schema URI alone. Reusing the same adapter object reuses its prepared state. The last matching association wins completely; extension lists never merge. Empty or omitted lists enable none. IDs are diagnostic metadata, not package specifications or lookup keys. Strings and duplicate IDs within one validator fail.

Extensions provide synchronous format assertions or annotation-only keywords. Ordinary type, range, pattern, and other schema constraints still apply. Two enabled extensions cannot own the same format or annotation; annotations cannot override an existing keyword. A format implementation can explicitly replace a baseline implementation. Extension order does not resolve conflicts. Existing Microsoft editor annotations remain supported by the baseline.

`renovate()` permits only the annotation keyword `x-renovate-version`; its value is metadata and never affects validation. It does not declare compatibility with a specific Renovate release.

### Schemars extension

Install `@correctlyjs/schemars` alongside `correctly` and import `schemars` from `@correctlyjs/schemars/ajv`. It is released independently; a new upstream Schemars version requires an extension release. The CLI, LSP, and VSIX load the implementation installed in the project.

Select an exact reviewed release, such as `schemars({ version: "0.8.22" })`, or an inclusive closed range within one compatibility era, such as `schemars({ version: ">=0.8.15 <=0.8.22" })`. The extension's npm version and the upstream Schemars version selected here are independent. Its peer dependency declares the supported Correctly API versions. The package root exports `schemarsEras` and the `SchemarsEra`, `SchemarsVersion`, and `SchemarsVersionSelection` types, all derived from the literal TypeScript catalog. Invalid selections fail type checking and runtime validation. `schemars()` returns the `AjvExtension` type exported by `correctly/validators/ajv`. Core contains installation suggestions only; it does not bundle or depend on the extension.

See the [extension guide](https://github.com/jeremybanka/correctly/blob/main/packages/schemars/docs/guide.md) for the reviewed releases, exhaustive format inventory, numeric precision policies, and other limits.

### Missing extension diagnostics

Correctly checks format support before compiling each loaded schema resource, including nested schema positions and unused definitions. A format name with no enabled assertion produces `extension-required`, exit 2, and the same actionable message in the editor. Annotation values such as defaults, enums, and examples are never inspected as schemas. No unsupported format is silently ignored. In particular, ajv-formats' annotation-only `password` and `binary` entries cannot attest to values and require an extension. Its OpenAPI numeric names (`int32`, `int64`, `float`, `double`) now require explicit extension selection too, so their width policy is not implicit.

```text
extension-required: This schema needs an extension.
│ Format "uint64" has no enabled validator; validation cannot proceed.
│ Schema: file:///project/schema.json#/properties/limit/format
│ For a Schemars-generated schema, install @correctlyjs/schemars and import { schemars } from "@correctlyjs/schemars/ajv". Select the schema's reviewed Schemars version with schemars({ version: "..." }) in this Ajv validator's extensions in correctly.config.ts.
```

A known provider is suggested with a package and import path; select the schema's reviewed upstream version explicitly. An unknown format receives guidance to enable an implementation, without inventing a package to install. JSON failures additionally expose `details: { schemaUri, schemaPointer, format, suggestedExtension? }`. The pointer identifies the `format` keyword in the schema resource. Ordinary validation failures remain exit 1; unknown keywords and invalid schemas continue to fail strict compilation.

### Authoring an extension

The first-party implementations use the same exported `AjvExtension` interface available to consumers:

```ts
import { defineConfig } from "correctly"
import { ajv, type AjvExtension } from "correctly/validators/ajv"

const company: AjvExtension = {
	id: "company@1",
	formats: {
		"ticket-id": {
			type: "string",
			validate: (value: string) => /^TASK-[1-9][0-9]*$/.test(value),
		},
	},
	annotations: ["x-company-description"],
}
export default defineConfig({
	associations: [
		{
			files: ["tickets.json"],
			validate: ajv({ schema: "schemas/tickets.json", extensions: [company] }),
		},
	],
})
```

Import the implementation from a local module or npm package in real projects. The CLI, LSP, and VSIX run those same implementations. Format assertions must be synchronous functions returning booleans; numeric definitions must declare `type: "number"`. RegExp definitions, async format validators, mutation keywords, and arbitrary Ajv plugins are outside this interface. A different validator adapter can expose its own options and extension contract.

## Parser and validator adapters

`Parser` and `Validator` are structural TypeScript interfaces exported from `correctly`. An association composes their instances; no global registration is required.

- A parser declares `id` and `valueModel`, and implements `parse(text, { file, signal })`. It returns `value`, `diagnostics`, and `locate(pointer, key?)`, plus optional `rawNumber(pointer)`. Spans are UTF-16 source offsets/lengths. JSON's locator falls back to the nearest containing node for missing properties; `rawNumber` returns only exact numeric nodes, preserving the original lexeme. Its parsed values still use binary64. Custom lossless parsers must declare their own value model rather than claiming `json` compatibility.
- A validator declares `id` and `accepts` (value model names). `prepare(context)` returns a reusable validator with `validate({ file, text, parsed, signal })`, optional editor support, and optional `dispose()`. Validation returns Correctly diagnostics; `diagnostic(text, code, message, pointer, offset, length)` builds one with LSP ranges. Syntax errors prevent value validation. Throws become execution failures. Parser/validator value-model mismatches are configuration failures (`adapter-incompatible`, exit 2).
- Context supplies `root`, `configPath`, remote policy, `read(uri)`, optional `fetch` and abort signal, and `watch(uri)`. Use `read` for dependency-tracked resources or `watch` for resources read another way. Optional `register(context)` runs for all associations before preparation, letting Ajv register named schema IDs. `context.services` is a project-local map for shared adapter resources; versioned `Symbol.for` keys allow compatible copies of a package to share a service without process-global state.
- Preparation occurs once per adapter object per project session, including unmatched associations. The same schema URI with different adapter instances compiles independently. Fresh workers on reload discard native module caches, validators and editor services together. The runtime aborts its signal and allows disposal up to 250 ms before terminating the worker; disposal cannot indefinitely block editor reload.
- Hints require both parser `editorLanguage: "json" | "jsonc"` and prepared validator `editor: { kind: "json-schema", uri, readSchema(uri) }`. Ajv explicitly provides this capability. A custom validator without it produces diagnostics but no schema completions or hover. A different language needs its own future hint capability; merely returning JSON-like values does not claim JSON source mapping.

For example, a custom validator can consume the built-in parser without using Ajv:

```ts
import { defineConfig, diagnostic, json, type Validator } from "correctly"

const objectOnly: Validator = {
	id: "object-only",
	accepts: ["json"],
	prepare: () => ({
		validate: ({ text, parsed }) =>
			parsed.value !== null &&
			typeof parsed.value === "object" &&
			!Array.isArray(parsed.value)
				? []
				: [diagnostic(text, "object-only", "Expected an object")],
	}),
}
export default defineConfig({
	associations: [
		{ files: ["settings.json"], parse: json(), validate: objectOnly },
	],
})
```

## References and cache

Schema associations accept local paths, `file:` URIs, and HTTP(S) URLs, optionally with pointer or anchor fragments. Relative references resolve from their schema resource's `$id`, or its retrieval URI when there is no identifier. Relative `$id` values are resolved from their parent resource. Configured schema resources are registered before compilation, so identifiers can refer to other configured local schemas without needing to host them. References to unloaded identifiers use the loader. Cycles and nested resources are resolved by Ajv. Only supported dialect graphs are accepted.

Remote requests have a total timeout per resource, a byte limit, at most five redirects, and a resource-count limit per engine. Defaults are shown above; maximum configuration values are 60 seconds, 16 MiB, and 256 resources. Cache entries are keyed by the full retrieval URL without its fragment. Online loads refresh cache entries and send ETag/Last-Modified validators when available. Requests without validators fetch again. Network or HTTP failures never silently fall back to stale cache. Local and loaded remote resources and compiled validators are reused for the life of an engine.

`correctly check --offline` prevents all HTTP requests; a missing or corrupt cached schema fails with exit 2. Warm the cache with an online check, retain the cache directory in CI, then validate offline. Local references still work offline. Cache location is explicit and portable when kept with the project's CI cache. Schema resource size limits also apply to local schemas.

Editor watchers refresh saved configurations, imported modules (including transitive imports and missing relative import candidates), package manifests/lockfiles, and local schema dependencies. Dependencies outside workspace roots receive explicit watchers. Unsaved schema edits also invalidate validators and hints. A failed reload replaces the previous session with visible failures; old validators never continue silently. Relevant schema/configuration changes and server restart refresh remote schemas. Cache writes and unrelated JSON changes do not trigger reloads. Remote servers do not send change notifications, so remote changes require one of those refresh triggers. Cancellation and document version/generation guards prevent older work from publishing diagnostics or hints after newer edits. Closing a buffer returns it to disk contents; closing a document clears its diagnostics.

## CLI and report contract

```sh
correctly check
correctly check --config config/correctly.config.ts
correctly check config/application.json --format json
correctly check --offline
correctly-lsp --stdio
```

Exit 0 means no validation or infrastructure failures; exit 1 means at least one invalid document; exit 2 means a configuration/schema/loading/execution failure, which takes priority over document errors. All configured associations are prepared even when their patterns match no documents, preventing unused broken schema maps from going unnoticed. Readable output identifies every file's coverage and selected association. JSON output is a single object without progress text or a filtering workaround.

Readable output follows Lasertag's file sections: a heading with the file name, error/failure counts, parsing mode, and selected schema; diagnostics sorted by source position; and numbered source excerpts with carets marking each affected range. Syntax-only files explicitly say `syntax only`; custom validators without a schema report their validator ID. Excerpts use the exact text validated, expand tabs to four spaces, and include one context line on each side unless that line has another diagnostic. Long ranges show their first and last lines with an ellipsis between them. Paths inside the current directory are relative; other paths remain absolute.

Missing required properties point to the containing object, while the diagnostic's JSON pointer names the missing property. Enum violations list the allowed values as JSON, including values from referenced schemas. `const` violations include the required value, including `null`, `false`, arrays, and objects. Property-name failures highlight the offending key, including the underlying pattern, enum, or constant reason. `uniqueItems` highlights the later duplicate and names the earlier item by its JSON pointer; array indices remain zero-based.

`oneOf` distinguishes no matching alternatives from overlapping alternatives; matching witnesses are numbered from 1 in schema order, without claiming an exhaustive match count. Failures from `anyOf`, `oneOf`, and conditional schemas are grouped under their summary, with reasons labeled by alternative or by the selected `then`/`else` branch. Nested groups retain their hierarchy. Readable error counts include the top-level groups; repeated identical source ranges appear once within a group. The editor publishes those same primary diagnostics with the nested reasons and their locations in LSP related information. Grouping uses Ajv's schema paths and instance paths. References that lose their caller provenance retain standalone errors rather than receiving a guessed branch label. Every validation failure remains visible.

```text
data/project.json  1 error  ·  JSON against Project (schemas/project.schema.json)
└─ 2:11  schema/type
   1 │ {
   2 │   "name": 42
     │           ^^
   3 │ }
     ╰─ /name: must be string
```

Readable reports use terminal colors automatically: bold file names, red error counts, cyan diagnostic codes, yellow carets, and dim context/gutters. Success summaries are green. Set `NO_COLOR=1` or `FORCE_COLOR=0` to disable colors, or `FORCE_COLOR=1` to force them when piping output. JSON reports never include ANSI styling.

`reportVersion: 2` contains `config`, sorted `files`, top-level `failures`, `summary`, and `exitCode`. Coverage is `schema`, `validated` (a custom validator without a schema URI), `syntax-only`, or `excluded`. `summary.validated` counts both validator-backed categories; `schemaCovered` is the subset with schema coverage, and `syntaxOnly` counts syntax-only files. `association.validator` is an adapter ID or null, and `mode` is a parser ID rather than a closed enum. Each file has `file`, `mode`, `coverage`, `association`, `diagnostics`, and `failures`. Diagnostics contain `code`, `message`, `pointer`, `offset`, `length`, and `range`; failures contain `code`, `message`, optionally `file`, and optional structured `details` for an extension requirement. Paths are absolute. The JSON report retains the complete flat diagnostic list in validator order, including every grouped reason. A grouped reason may additionally have `context: { parent, label }`: `parent` is the zero-based index of its summary in that same file's `diagnostics` array; `label` names its branch. Do not reorder that array before resolving context indices. The exported `diagnosticViews` helper projects it into the same hierarchy used by CLI and LSP, and `diagnosticDetails` lists the nested reasons. Messages reflect the pinned validator/parser versions and Correctly's message enrichment; consumers should use codes and pointers rather than parsing message prose.

## Editor installation and shared APIs

From the repository, run `pnpm build:vsix`, then `code --install-extension artifacts/Correctly-0.0.0.vsix`. The extension requires VS Code 1.105 or later: its [pinned Electron 37.6.0 runtime](https://github.com/microsoft/vscode/blob/1.105.0/.npmrc) includes [Node 22.19](https://releases.electronjs.org/release/v37.6.0), which supports native TypeScript configuration loading. The universal VSIX bundles the client, server and project worker. Configuration imports resolve from the project, so install Correctly and any adapter dependencies there. Open a trusted workspace with a configuration to activate it. All file documents can reach the server; project patterns select which ones are checked. Missing configurations produce diagnostics for JSON, JSONC, YAML, and TOML; unrelated languages without a configuration remain quiet. The extension's **Correctly: Restart Server** command refreshes its lifecycle. Other LSP clients launch `correctly-lsp --stdio` and must send workspace folders and file-change notifications for automatic disk refresh. No formatter or automatic fixes are registered.

Microsoft's JSON language service supplies completions and hover for JSON/JSONC. YAML and TOML currently receive validation diagnostics only. Its AST is retained with traversal methods bound to the original document; a selection view disables automatic embedded `$schema` selection. Ajv remains the validation authority. Built-in VS Code JSON features may independently provide suggestions/diagnostics; set `json.validate.enable` to `false` to use only Correctly validation, if desired.

The package root exports `loadProject`, `Engine`, `SchemaStore`, parser/location utilities, configuration discovery/matching, and report/diagnostic types:

```ts
import { Engine, loadProject } from "correctly"

const engine = new Engine(await loadProject("/project/correctly.config.ts"))
await engine.prepare()
try {
	const result = await engine.validate("/project/config/app.json", sourceText)
	console.log(result)
} finally {
	await engine.dispose()
}
```

The core owns association and adapter lifecycle without depending on Ajv or a JSON AST. `loadProject` is a one-shot Comline load using native module caching; long-running embedders must create fresh worker/module contexts when configuration imports change. CLI and LSP already do this. Built-in parsers cover JSON, JSONC, YAML, and TOML; other parsers can compose today through the public interface, provided they define value semantics and source mappings precisely.
