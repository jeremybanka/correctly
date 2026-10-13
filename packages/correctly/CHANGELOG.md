# correctly

## 0.2.0

### Minor Changes

- ff3fa15: Use Comline with Zod-backed options for CLI parsing, help, warnings, and shell completions; unknown options now warn on stderr, booleans accept explicit values, and repeated option values follow Comline's comma-joining semantics.
- 275773c: Move schema locks to correctly.lock and store schemas under stable URL-derived filenames, retaining legacy snapshot validation and migration support; restore both the lock and schemas when rolling back.

## 0.1.4

### Patch Changes

- e78d6c0: Add a precompiled Zed extension with a bundled language server and a build-and-sideload workflow requiring no Rust toolchain on the recipient's machine.

## 0.1.3

### Patch Changes

- cede0c4: Accept valid JSON Schemas with overlapping named and pattern properties while enforcing both sets of constraints.
- cede0c4: Add schema vendoring with correctly schemas pull, integrity-checked project snapshots, discovery and installed-package provenance, and shared CLI/editor locking.

## 0.1.2

### Patch Changes

- 810ab1d: Add composable YAML and TOML parser adapters with default file discovery, numeric lexemes, source locations, CLI reports, and editor diagnostics through the shared project runtime.

## 0.1.1

### Patch Changes

- 9e58df7: Export GITIGNORE for opt-in project-local .gitignore exclusions shared by the CLI, core, and editor.

## 0.1.0

### Minor Changes

- 509f4df: Replace JSON configuration with Comline-loaded TypeScript, compose parser and validator adapters with per-validator imported AjvExtension implementations, support independently published schema extensions with actionable missing-format failures, share reloadable project runtimes across CLI and trusted editors, introduce report version 2 for custom validator coverage.
