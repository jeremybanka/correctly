# Correctly consumer guidance

- Keep schema associations in `correctly.config.json`; document `$schema` fields do not select schemas.
- Run `correctly check` in CI and use the extension or `correctly-lsp --stdio` for editor assistance.
- JSON is strict. JSONC permits comments and trailing commas. Duplicate keys are always errors.
- Resolve patterns and local schema paths from the configuration directory. Last matching association wins.
- Use explicit offline mode for reproducible cached validation. Missing schemas and offline cache misses fail.
- See `docs/guide.md` for detailed semantics. Formatting belongs to your formatter; YAML/TOML are not supported yet.
