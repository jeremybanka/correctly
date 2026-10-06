# Correctly for Zed

Install Correctly and any imported adapters in the project, add `correctly.config.ts`, and enable the extension only in projects you trust. It executes that configuration and its imports. JSON, JSONC, YAML, and TOML receive diagnostics; completion and hover currently support JSON/JSONC only. Zed's existing language support handles syntax highlighting and formatting.

## Build and sideload

From the repository, install the `wasm32-wasip2` target for the Rust toolchain selected by `mise.toml`, then build:

```sh
rustup target add wasm32-wasip2
pnpm build:zed
```

The build requires Cargo, Rust, Node, and `tar`. It produces `artifacts/Correctly-<version>.zed/` and `artifacts/Correctly-<version>.zed.tar.gz`, using the Correctly package version.

Share the archive with recipients. Extract it into a permanent directory, open Zed's Extensions view, click **Install Dev Extension**, and select the extracted `Correctly-<version>.zed` directory. When installing your own build, select the generated directory directly. Keep that directory in place: Zed links to it. Select the built artifact rather than this source directory.

The artifact contains a precompiled `extension.wasm`, its manifest, this README, and the license. The WASM embeds the fully bundled language server and project worker. There is no Cargo manifest or Rust library declaration in the artifact, so sideload installation skips Rust compilation. Recipients need no Cargo, Rust, npm installation for the server, or extension-registry access. Zed supplies the Node runtime; Correctly requires Node 22.18 or later. Use a current Zed release supporting extension API 0.7.0.

## Enable Correctly

Add the following to your trusted project's `.zed/settings.json`. Retain other servers with `"..."`:

```json
{
	"languages": {
		"JSON": { "language_servers": ["correctly", "..."] },
		"JSONC": { "language_servers": ["correctly", "..."] },
		"YAML": { "language_servers": ["correctly", "..."] },
		"TOML": { "language_servers": ["correctly", "..."] }
	}
}
```

Other servers may report their own diagnostics or suggestions. To use only Correctly's language server for a language, use `["correctly"]`. This preserves Zed's syntax support but removes the other servers' features. Correctly provides no formatter or automatic fixes; keep your formatter configured separately. Ensure YAML and TOML language support is installed if Zed does not recognize those files.

The bundled server uses project-local configuration imports, so install `correctly` and any adapters imported by `correctly.config.ts` in the project. Data and schema buffers update as you type. Executable configurations and their imports reload after saving; the LSP registers file watchers for disk changes. Zed attaches Correctly to the four registered languages; custom parser file types need a corresponding language association before they can receive editor diagnostics.

## Runtime override and updates

By default the adapter uses Zed's Node runtime. To choose a Node 22.18+ executable instead, set `lsp.correctly.binary.path`. Optional `arguments` are Node flags prepended to the bundled server path and `--stdio`; `env` overrides the worktree's shell environment:

```json
{
	"lsp": {
		"correctly": {
			"binary": {
				"path": "/absolute/path/to/node",
				"arguments": ["--max-old-space-size=4096"],
				"env": { "NODE_OPTIONS": "" }
			}
		}
	}
```

Install a new build by selecting its extracted directory with **Install Dev Extension**, then run **editor: restart language server** if needed. The adapter writes the embedded bundles into a versioned directory under Zed's extension work directory. Already-running servers retain their version's worker path during upgrades. Use **zed: open log** to inspect launch errors.
