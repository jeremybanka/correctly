# Correctly

JSON Schema validation for JSON, JSONC, YAML, and TOML in CI and editors, using one external TypeScript configuration. Correctly composes parser and validator adapters in a CLI, a stdio language server, and bundled VS Code and Zed extensions.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm check
pnpm build:vsix
pnpm build:zed
```

Builds use the Correctly package version: install `artifacts/Correctly-<version>.vsix` with `code --install-extension`. For Zed, install the `wasm32-wasip2` Rust target before building, then select `artifacts/Correctly-<version>.zed` through **Install Dev Extension**. The Zed archive is shareable; recipients need no Rust toolchain. See the [Zed setup guide](packages/correctly/docs/guide.md#zed). Packages and extensions have not been published.

Try the complete example:

```sh
node packages/correctly/dist/cli.mjs check --config packages/correctly/examples/basic/correctly.config.ts
```

Open the example directory as a trusted VS Code workspace to see diagnostics for all four formats, with property/value completion and schema descriptions on hover for JSON/JSONC. Both editor and CLI use `correctly.config.ts`; documents need no embedded schema link. Formatting is handled by your formatter.

To try schema violations and source excerpts, run `pnpm exec correctly check --config demo/correctly.config.ts`. The [demo materials](demo/README.md) include a valid document and two deliberately invalid documents; the full demo exits 1.

See the [package guide](packages/correctly/docs/guide.md), [repository commands](docs/commands.md), [design/reference audit](docs/design.md), and [delivery validation](docs/validation.md).
