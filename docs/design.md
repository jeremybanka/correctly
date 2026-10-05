# Design and reference audit

Inspected the actual `/home/jem/lasertag` checkout at `af3a8cfbcee4d27312644000c9a83f0e58946654` before implementing Correctly: root manifests, Vite Plus and TypeScript configuration, dprint, mise, pinned CI setup and check/test/release workflows, command documentation, and the package's shared core, CLI, LSP server, VS Code client and `src/cli/vsix.ts`.

Retain a pnpm workspace containing `packages/correctly`, a core consumed by CLI and LSP, separate ESM Vite Plus build entries, public/private tests, dprint, pinned CI setup, changesets, and a thin VS Code client plus bundled server packaged with Rolldown and VSCE. Remove CSS/JSX analysis, ESLint rules, cleanup fixes, TypeScript workers/native runtimes, corpus tooling, icons, and tree views. With no native runtime, the VSIX is universal. Publishing workflows and Renovate credentials are not copied: this repository is not published or wired to Lasertag's secrets.

## Libraries and draft coverage

- Ajv 8 and ajv-formats: separate draft 7 and 2020-12 validators; no coercion, defaults, deletion, or asynchronous data validation. Absent dialects default to draft 7 at resource roots and inherit within subschemas. Other dialects, unsupported required vocabularies, mixed-dialect reference graphs, and unknown validation keywords fail explicitly. Microsoft descriptive extension keywords are accepted as annotations.
- jsonc-parser: JSON/JSONC trees, offsets, parse errors, duplicate keys, and JSON pointers. Parsing returns a value, source tree, and diagnostics.
- yaml and toml-eslint-parser: YAML 1.2 core and TOML 1.0 adapters materialize JSON-compatible values, map pointers to original source locations, and retain numeric lexemes. The same parser contract composes with Ajv and custom validators. Format semantics are documented in the package guide.
- tinyglobby and picomatch: discovery and associations, including hidden files. Exclude node_modules, .git, dist, artifacts, and cache directories by default.
- vscode-languageserver/textdocument: stdio and unsaved documents.
- vscode-json-languageservice: completion and hover only. Checked upstream source/releases and installed 5.7.2, including its 2020-12/dynamic-reference support. Ajv remains authoritative so validation does not depend on the hint service's independent implementation. A schema-selection view hides only the root accessor from the service's automatic association lookup. All traversal methods remain bound to the original parsed document; no document properties are removed, rewritten, or excluded from validation or hints. Public tests guard this adapter against library changes.
- Rolldown, vscode-languageclient, VSCE: bundle client/server and build an installable VSIX following Lasertag's staging-and-bundle pattern.

Upstream references: [Ajv draft coverage](https://ajv.js.org/json-schema.html), [Ajv reference resolution](https://ajv.js.org/guide/combining-schemas.html), [Microsoft service API](https://github.com/microsoft/vscode-json-languageservice), [service releases](https://github.com/microsoft/vscode-json-languageservice/releases).

## Configuration semantics

`correctly.config.ts` is a default-exported object loaded by Comline 0.9.0. Associations compose parser and validator implementations directly; Ajv extensions are explicitly passed implementations, not registry strings. The runtime validates configuration structure, parser value-model compatibility, and extension contracts. Explicit `--config` resolves from the invocation directory; otherwise discover upward. Editors choose the longest containing workspace root and stop discovery at that root. Nearest config and last matching association win without merging. Patterns, local schema and cache paths resolve from the configuration directory. `validate: null` chooses syntax-only coverage. Document `$schema` remains ordinary data.

Versioned reports expose the association index/name, schema URI, parsing mode, coverage, diagnostic pointers/ranges, and execution failures. Syntax-only coverage is visible without failing. CLI exit codes are 0 for success, 1 for document errors, 2 for configuration/schema/execution errors (which take priority). Readable output and JSON reports need no filtering.

## Loading and lifecycle

HTTP requests have time, size, redirect, and resource-count bounds. Disk cache is reusable; offline cache misses fail. Online requests revalidate cached resources using HTTP validators when supplied and never silently fall back to stale cache. Schema identifiers and fragments are handled by Ajv, with missing resources loaded by the shared store. Configuration/schema changes invalidate compiled validators and hint services. Unsaved document/schema buffers participate; executable configuration and imports load only from saved files. Project workers are replaced on configuration, imported module, package metadata or schema changes, giving native module caches a bounded lifecycle. Workers abort and dispose prepared adapters before termination. Failed reloads disable stale state. The VSIX requires workspace trust. See the package guide for the public adapter and editor capability contracts. Cancellation and per-document version/generation guards discard stale results; workspace changes re-resolve roots. Configuration/schema failures are editor diagnostics.

## Scope adjustments

Integration checks found two necessary library adaptations: ordinary JSON objects are materialized from jsonc-parser's null-prototype tree values for Ajv equality checks, and root anchors are registered explicitly with Ajv's reference table. Duplicate identifiers/anchors are rejected. VSIX bundling prioritizes dependency ESM entries because jsonc-parser's UMD factory leaves nested `require` calls unresolved under Rolldown; the isolated bundle test protects this packaging choice.

Named `correctly` by the user. Representative fixtures come from Lasertag and sibling repositories instead of an atom.io audit. Built-in parsers cover JSON/JSONC, YAML, and TOML through the same adapter boundary. Completion and hover currently support JSON/JSONC. No formatting, fixes, publishing, remote repository creation, or migrations. Deliver the complete configuration-to-CLI-to-editor path with reference, dialect, cache, location, parity, lifecycle, workspace and packaging checks.
