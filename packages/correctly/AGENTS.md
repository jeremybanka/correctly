# Correctly consumer guidance

- Keep schema associations in `correctly.config.ts`; document `$schema` fields do not select schemas.
- Run `correctly check` in CI and use the extension or `correctly-lsp --stdio` for editor assistance.
- JSON is strict. JSONC permits comments and trailing commas. Duplicate keys are always errors.
- YAML uses one YAML 1.2 core document with string keys and bounded, noncyclic aliases. TOML uses 1.0; dates and times validate as strings. Both reject non-finite numbers and integers outside JavaScript's safe range.
- Built-in parsers `json()`, `jsonc()`, `yaml()`, and `toml()` produce the `json` value model. Omitting `parse` selects by extension; JSON, JSONC, YAML, YML, and TOML are discovered by default. Schema completion and hover currently support JSON/JSONC only.
- PKL is also discovered by default. Import `pkl as parsePkl` from `correctly` and `pkl` from `correctly/validators/pkl`; use `parse: parsePkl(), validate: pkl()` to evaluate native types and constraints. Use `pkl({ validate: ajv({ schema: "schema.json" }) })` for additional JSON Schema checks on evaluated output. The parser alone checks syntax and produces the `pkl` value model; Ajv cannot consume it directly. The WASM runtime is bundled, with no external Pkl or Rust installation required. Consult the guide for pklr compatibility, module-level evaluation locations, imports, and explicit environment/properties.
- Resolve patterns and local schema paths from the configuration directory. Last matching association wins.
- Import `GITIGNORE` from `correctly` and include it in `exclude` to opt into `.gitignore` rules from the configuration directory and its subdirectories. Save ignore files to refresh editor exclusions.
- Compose parser and validator adapters directly; install `@correctlyjs/schemars` and import `schemars` from `@correctlyjs/schemars/ajv` and opt into the extension on each Ajv validator, for example `extensions: [schemars({ version: "0.8.22" })]`; an exact reviewed release or a closed range within one compatibility era is required; consult the extension package's guide for supported eras, format inventory, and precision. Renovate metadata uses the separate `renovate()` extension.
- Missing format implementations fail with `extension-required`; never disable format validation to work around them.
- Use explicit offline mode for reproducible cached validation. Missing schemas and offline cache misses fail.
- See `docs/guide.md` for detailed semantics. Formatting belongs to your formatter. Custom parsers must specify value semantics and source mapping.

- Use Comline-loaded TypeScript configuration and project-local dependencies. Save executable configuration/imports to reload; do not evaluate unsaved TypeScript. The VSIX requires workspace trust.
