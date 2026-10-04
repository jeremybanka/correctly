# Correctly consumer guidance

- Keep schema associations in `correctly.config.ts`; document `$schema` fields do not select schemas.
- Run `correctly check` in CI and use the extension or `correctly-lsp --stdio` for editor assistance.
- JSON is strict. JSONC permits comments and trailing commas. Duplicate keys are always errors.
- Resolve patterns and local schema paths from the configuration directory. Last matching association wins.
- Compose parser and validator adapters directly; opt into imported extensions on each Ajv validator, for example `extensions: [schemars({ version: "0.8.22" })]`; consult `docs/guide.md` for the pinned format and precision contract. Renovate metadata uses the separate `renovate()` extension.
- Missing format implementations fail with `extension-required`; never disable format validation to work around them.
- Use explicit offline mode for reproducible cached validation. Missing schemas and offline cache misses fail.
- See `docs/guide.md` for detailed semantics. Formatting belongs to your formatter; built-in parsers cover JSON/JSONC. Custom parsers must specify value semantics and source mapping.

- Use Comline-loaded TypeScript configuration and project-local dependencies. Save executable configuration/imports to reload; do not evaluate unsaved TypeScript. The VSIX requires workspace trust.
