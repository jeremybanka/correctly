# Correctly consumer guidance

- Keep schema associations in `correctly.config.ts`; document `$schema` fields do not select schemas.
- Run `correctly check` in CI and use the extension or `correctly-lsp --stdio` for editor assistance.
- JSON is strict. JSONC permits comments and trailing commas. Duplicate keys are always errors.
- Resolve patterns and local schema paths from the configuration directory. Last matching association wins.
- Import `GITIGNORE` from `correctly` and include it in `exclude` to opt into `.gitignore` rules from the configuration directory and its subdirectories. Save ignore files to refresh editor exclusions.
- Compose parser and validator adapters directly; install `@correctlyjs/schemars` and import `schemars` from `@correctlyjs/schemars/ajv` and opt into the extension on each Ajv validator, for example `extensions: [schemars({ version: "0.8.22" })]`; an exact reviewed release or a closed range within one compatibility era is required; consult the extension package's guide for supported eras, format inventory, and precision. Renovate metadata uses the separate `renovate()` extension.
- Missing format implementations fail with `extension-required`; never disable format validation to work around them.
- Use explicit offline mode for reproducible cached validation. Missing schemas and offline cache misses fail.
- See `docs/guide.md` for detailed semantics. Formatting belongs to your formatter; built-in parsers cover JSON/JSONC. Custom parsers must specify value semantics and source mapping.

- Use Comline-loaded TypeScript configuration and project-local dependencies. Save executable configuration/imports to reload; do not evaluate unsaved TypeScript. The VSIX requires workspace trust.
