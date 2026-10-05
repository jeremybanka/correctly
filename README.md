# Correctly

JSON Schema validation for CI and editors, using one external configuration. Correctly wraps Ajv in a CLI, a stdio language server, and a bundled VS Code extension. JSON and JSONC are the initial formats; the core separates parsing from validation for future YAML and TOML support.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm check
pnpm build:vsix
```

The installable extension is `artifacts/Correctly-0.0.0.vsix`. Install it with `code --install-extension artifacts/Correctly-0.0.0.vsix`. Packages and extensions have not been published.

Try the complete example:

```sh
node packages/correctly/dist/cli.mjs check --config packages/correctly/examples/basic/correctly.config.ts
```

Open the example directory as a VS Code workspace to see diagnostics, property/value completion, and schema descriptions on hover. Both editor and CLI use `correctly.config.ts`; documents need no embedded schema link. Formatting is handled by your formatter.

To try schema violations and source excerpts, run `pnpm exec correctly check --config demo/correctly.config.ts`. The [demo materials](demo/README.md) include a valid document and two deliberately invalid documents; the full demo exits 1.

See the [package guide](packages/correctly/docs/guide.md), [repository commands](docs/commands.md), [design/reference audit](docs/design.md), and [delivery validation](docs/validation.md).
