# Correctly consumer guidance

- Keep schema associations in `correctly.config.json`; document `$schema` fields do not select schemas.
- Run `correctly check` in CI and use the extension or `correctly-lsp --stdio` for editor assistance.
- JSON is strict. JSONC permits comments and trailing commas. Duplicate keys are always errors.
- Resolve patterns and local schema paths from the configuration directory. Last matching association wins.
- Enable schema extensions explicitly per association, for example `"extensions": ["schemars@0.8.22"]`; consult `docs/guide.md` for the pinned format and precision contract. Renovate metadata uses the separate `renovate` extension.
- Missing format implementations fail with `extension-required`; never disable format validation to work around them.
- Use explicit offline mode for reproducible cached validation. Missing schemas and offline cache misses fail.
- See `docs/guide.md` for detailed semantics. Formatting belongs to your formatter; YAML/TOML are not supported yet.
