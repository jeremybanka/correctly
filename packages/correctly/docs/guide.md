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

File patterns, exclusions, local schema paths, and cache paths resolve from the configuration directory. Patterns use forward slashes, can match dotfiles, and must be relative without `..` or leading `!`. Use `exclude` instead of negated patterns. `files` defaults to `**/*.json` and `**/*.jsonc`. Built-in exclusions cover `node_modules`, `.git`, `dist`, `artifacts`, and `.correctly-cache`; configured cache directories inside the project are also excluded. User exclusions add to these defaults. Excluded files are skipped.

Associations are ordered: the **last matching rule wins**. `parse` selects a parser implementation; omitting it selects JSONC for `.jsonc` and strict JSON otherwise. `validate: null` explicitly requests syntax-only coverage. Unassociated included documents are also syntax-checked and reported as `syntax-only`; missing coverage does not fail the command. Reports include the matched index, name, optional schema URI, parser ID (`mode`), validator ID, extension IDs and coverage. Association patterns do not expand the project's `files` list: include custom file extensions there as well.

## Parsing and validation

Strict JSON rejects comments and trailing commas; JSONC allows both. Both modes reject duplicate object keys, including escaped duplicates, and preserve useful source ranges and JSON pointers. Incomplete editor documents receive syntax diagnostics and tolerant completion/hover; Ajv validates values only once syntax is valid. UTF-16 ranges are zero-based and compatible with LSP; readable CLI locations are one-based. Duplicate-key diagnostics point to the second key, value errors point to the value, disallowed-property errors point to the key, and missing-property errors point to the containing object's start and retain the missing property's pointer.

Document `$schema` is always ordinary data. It is neither removed nor used to select a schema, and a schema can reject that property with `additionalProperties: false`. This also holds for editor hints and unassociated documents. Schema documents' own `$schema` fields retain dialect meaning.

Ajv provides authoritative validation in both CLI and LSP. Separate instances support draft 7 and draft 2020-12, including prefixItems, unevaluatedProperties, and dynamic references. Root schemas without `$schema` default to draft 7; referenced resources without one inherit the referencing dialect. Unknown dialects, mixed-dialect graphs, unsupported required vocabularies, unresolved references, invalid schemas, and unknown validation keywords fail visibly. Standard 2020-12 core/applicator/unevaluated/validation/metadata/format-annotation/content vocabularies are recognized. Required format-assertion vocabulary and custom required vocabularies are not supported. ajv-formats applies its supported format checks in both drafts; unknown formats fail compilation. Content decoding/validation is not performed. `$async` is unsupported.

Descriptive Microsoft schema extensions, such as `markdownDescription`, `enumDescriptions`, and `defaultSnippets`, are treated as annotations. No values are coerced, no defaults are inserted, and no properties are removed. Formatting is outside validation.

## Schema extensions

Extensions are imported implementations passed to an individual Ajv validator. First-party extensions use exactly the same contract as third-party extensions. Importing one makes it available without enabling it globally:

```ts
import { defineConfig, json } from "correctly"
import { ajv } from "correctly/validators/ajv"
import { schemars } from "correctly/extensions/schemars"
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

### Reviewed Schemars compatibility eras

`schemars({ version: "0.8.22" })` selects an exact reviewed upstream Schemars release. `schemars({ version: ">=0.8.15 <=0.8.22" })` selects a closed range within one compatibility era. The first era contains **0.8.15, 0.8.16, 0.8.17, 0.8.18, 0.8.19, 0.8.20, 0.8.21, and 0.8.22**: all eight independently pinned generators and matching derive crates produce the same 74 schemas. The exported, immutable `schemarsEras` catalog lists every reviewed release and its era's starting version.

The required `version` argument accepts exactly `major.minor.patch` or `>=major.minor.patch <=major.minor.patch` (one space, inclusive bounds). Both endpoints must be reviewed releases in the same era. Reversed bounds, prereleases, caret/tilde ranges, wildcards, open ranges, unreviewed endpoints, and ranges crossing eras are rejected. Future releases never become supported implicitly. Diagnostic IDs preserve the selection, for example `schemars@>=0.8.15 <=0.8.22`. The selection is an explicit compatibility assertion by the configuration author; Correctly cannot infer which Schemars release generated a schema.

An era is a frozen generated-schema contract with its own validation semantics. Extending an era adds a tested release without changing those semantics; changed generated schemas require a new era beginning at that release. Each newly reviewed stable Schemars release requires a new Correctly release, even when schemas are identical. This policy concerns upstream emitted formats, not Rust execution or identical Serde deserialization. Releases outside the catalog and forks, including `oxc-schemars`, are not covered by the upstream pins; schemas using the same vocabulary can explicitly opt into the documented contract.

The complete format inventory is below. Numeric predicates apply to numbers and string predicates to strings, following JSON Schema's format semantics; other instance types require the schema's `type` constraint. All numeric bounds are evaluated on parsed JavaScript numbers.

| Emitted format                                   | Origin                                     | Assertion                                                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `int8`, `int16`, `int32`, `int64`, `int128`      | `i8` through `i128`                        | Integer in −2ⁿ⁻¹ ≤ x < 2ⁿ⁻¹ for the named width n.                                                                                                                                                                                       |
| `uint8`, `uint16`, `uint32`, `uint64`, `uint128` | `u8` through `u128`                        | Integer in 0 ≤ x < 2ⁿ for the named width n.                                                                                                                                                                                             |
| `int`, `uint`                                    | `isize`, `usize`                           | Integer; `uint` additionally requires x ≥ 0. No target architecture is encoded, so no platform width is inferred.                                                                                                                        |
| `float`                                          | `f32`                                      | Finite number with absolute value ≤ (2 − 2⁻²³) × 2¹²⁷. No exact binary32 representability or minimum nonzero magnitude is required.                                                                                                      |
| `double`                                         | `f64`                                      | Finite JavaScript number.                                                                                                                                                                                                                |
| `ip`                                             | `IpAddr`                                   | IPv4 or IPv6 literal, checked by Node's `net.isIP`; no hostname lookup.                                                                                                                                                                  |
| `ipv4`, `ipv6`                                   | `Ipv4Addr`, `Ipv6Addr`                     | The corresponding ajv-formats 3.0.1 full-mode assertion.                                                                                                                                                                                 |
| `date`, `date-time`                              | Chrono `NaiveDate`, `DateTime`             | ajv-formats 3.0.1 full-mode assertions; dates use four-digit years and date-times require a timezone.                                                                                                                                    |
| `partial-date-time`                              | Chrono `NaiveDateTime` **and** `NaiveTime` | Either `YYYY-MM-DDTHH:MM:SS` or `HH:MM:SS`, optionally followed by 1–9 fractional digits, with no timezone. Gregorian date validity, hours 00–23, minutes 00–59, seconds 00–59 or leap second 60 when the minute is 59. Years 0000–9999. |
| `uuid`                                           | UUID 0.8 and 1 integrations                | ajv-formats 3.0.1 full-mode UUID assertion.                                                                                                                                                                                              |
| `uri`                                            | URL integration and derive `url`           | ajv-formats 3.0.1 full-mode URI assertion.                                                                                                                                                                                               |
| `email`                                          | Derive `email`                             | ajv-formats 3.0.1 full-mode email assertion.                                                                                                                                                                                             |
| `phone`                                          | Derive `phone`                             | Canonical international syntax: `+` followed by 2–15 ASCII digits, first digit nonzero. No spaces, local-number inference, country allocation database, or reachability check.                                                           |

This accounts for **all 24 distinct emitted format names**, including optional integrations and derive attributes. Nonzero types preserve their generated minimum/not-zero constraints. Atomic types, collections, and other wrappers use the same underlying formats. Decimal integrations emit a standard string pattern, semver emits a standard pattern, and remaining integrations add no new formats.

Some names do not encode enough information to reproduce a Rust type. The `partial-date-time` assertion accepts the union because this era assigns the same name to both date-times and times; it cannot distinguish them. Standard `date`/`date-time` format behavior and the four-digit-year policy do not cover Chrono's extended-year serialization. Schemars emits `phone` without specifying a numbering policy; the syntax above is Correctly's explicit interpretation, not a promise to reproduce a particular Rust phone library. Custom `JsonSchema` implementations, `schema_with` callbacks, arbitrary format names, and OpenAPI generator settings are outside this finite compatibility contract and need their own extensions where applicable. This era's normal generated draft-7 schemas are tested directly; extension assertions also work in Correctly's draft-2020-12 engine. This does not add draft-2019-09 or OpenAPI dialect support.

**Numeric precision:** parsing still uses IEEE-754 binary64. Integers above 2⁵³−1 can round before any schema assertion, including 64/128-bit bounds, runs. For example, the valid Rust `u64` value `18446744073709551615` rounds to 2⁶⁴ and fails the upper bound. Smaller in-range integers may round and still pass. This extension does not offer lossless large-integer validation. Store exact large quantities as strings with an appropriate schema when exact decimal digits matter.

Each reviewed release has its own exact Cargo manifest and lockfile, with every optional integration enabled and the matching derive crate locked. `pnpm test:schemars` runs all eight historical generators with `cargo run --locked`, comparing their 592 schemas structurally against the shared era corpus; it also checks Renovate's separate candidate probe. Public tests compile the corpus and exercise positive/negative cases for every emitted format in both supported dialects, integer boundaries, nonzero/nested types, association isolation, CLI/LSP agreement, and version/range selection. Rust is a development dependency only. The [maintainer workflow](../tests/public/fixtures/schemars/README.md) documents the required CI review and release steps.

### Missing extension diagnostics

Correctly checks format support before compiling each loaded schema resource, including nested schema positions and unused definitions. A format name with no enabled assertion produces `extension-required`, exit 2, and the same actionable message in the editor. Annotation values such as defaults, enums, and examples are never inspected as schemas. No unsupported format is silently ignored. In particular, ajv-formats' annotation-only `password` and `binary` entries cannot attest to values and require an extension. Its OpenAPI numeric names (`int32`, `int64`, `float`, `double`) now require explicit extension selection too, so their width policy is not implicit.

```text
extension-required: This schema needs an extension.
│ Format "uint64" has no enabled validator; validation cannot proceed.
│ Schema: file:///project/schema.json#/properties/limit/format
│ Import schemars from "correctly/extensions/schemars" and add schemars({ version: "0.8.22" }) to this Ajv validator's extensions in correctly.config.ts.
```

A known provider is suggested with an import and exact version; an unknown format receives guidance to enable an implementation, without inventing a package to install. JSON failures additionally expose `details: { schemaUri, schemaPointer, format, suggestedExtension? }`. The pointer identifies the `format` keyword in the schema resource. Ordinary validation failures remain exit 1; unknown keywords and invalid schemas continue to fail strict compilation.

### Authoring an extension

The first-party implementations use the same exported `SchemaExtension` interface available to consumers:

```ts
import { defineConfig } from "correctly"
import { ajv, type SchemaExtension } from "correctly/validators/ajv"

const company: SchemaExtension = {
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

From the repository, run `pnpm build:vsix`, then `code --install-extension artifacts/Correctly-0.0.0.vsix`. The extension requires VS Code 1.105 or later: its [pinned Electron 37.6.0 runtime](https://github.com/microsoft/vscode/blob/1.105.0/.npmrc) includes [Node 22.19](https://releases.electronjs.org/release/v37.6.0), which supports native TypeScript configuration loading. The universal VSIX bundles the client, server and project worker. Configuration imports resolve from the project, so install Correctly and any adapter dependencies there. Open a trusted workspace with a configuration to activate it. All file documents can reach the server; project patterns select which ones are checked. Missing configurations produce diagnostics for JSON/JSONC; unrelated languages without a configuration remain quiet. The extension's **Correctly: Restart Server** command refreshes its lifecycle. Other LSP clients launch `correctly-lsp --stdio` and must send workspace folders and file-change notifications for automatic disk refresh. No formatter or automatic fixes are registered.

Microsoft's JSON language service supplies completions and hover. Its AST is retained with traversal methods bound to the original document; a selection view disables automatic embedded `$schema` selection. Ajv remains the validation authority. Built-in VS Code JSON features may independently provide suggestions/diagnostics; set `json.validate.enable` to `false` to use only Correctly validation, if desired.

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

The core owns association and adapter lifecycle without depending on Ajv or a JSON AST. `loadProject` is a one-shot Comline load using native module caching; long-running embedders must create fresh worker/module contexts when configuration imports change. CLI and LSP already do this. Built-in parsers cover JSON/JSONC; other parsers can compose today through the public interface, provided they define value semantics and source mappings precisely.
