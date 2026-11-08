import type { KnipConfig } from "knip"

// Public source entrypoints remain roots, including CLIs, workers, and conditional exports.
// Formatter plugins and JSON schemas are loaded by configuration paths, not imports.
// Generated distributions are checked through their authored source entrypoints.
export default {
	workspaces: {
		".": {
			entry: ["correctly.config.ts", "scripts/*.{ts,tsx}"],
			project: ["*.ts", "scripts/**/*.{ts,tsx}"],
			ignoreDependencies: [
				"@dprint/json",
				"@dprint/markdown",
				"@dprint/oxc",
				"@dprint/toml",
				"dprint-plugin-yaml",
				// Keep workspace CLIs available for manual contributor use.
				"correctly",
			],
		},
		"packages/correctly": {
			entry: [
				"src/cli/main.ts!",
				"src/lsp/server.ts!",
				"src/core/index.ts!",
				"src/runtime/worker.ts!",
				"src/validators/ajv.ts!",
				"src/extensions/renovate.ts!",
				"src/vscode/extension.ts!",
				"vite.distribution.config.ts",
				"breakage.config.ts",
				"tests/**/fixtures/**/*.{ts,tsx,js,mjs,cjs}",
				"examples/**/*.{ts,tsx}",
				"src/cli/zed.ts!",
			],
			project: [
				"*.ts",
				"{src,bin}/**/*.{ts,tsx}!",
				"{tests,__tests__,peer-environments,examples}/**/*.{ts,tsx,js,mjs,cjs}",
			],
			ignoreDependencies: [
				// Provided by the VS Code extension host.
				"vscode",
			],
		},
		"packages/schemars": {
			entry: [
				"src/index.ts!",
				"src/ajv.ts!",
				"vite.distribution.config.ts",
				"breakage.config.ts",
				"vite.peer.config.ts",
				"tests/**/fixtures/**/*.{ts,tsx,js,mjs,cjs}",
				"peer-environments/**/*.{ts,tsx,js,mjs,cjs}",
				"tests/private/era-types.ts",
			],
			project: [
				"*.ts",
				"{src,bin}/**/*.{ts,tsx}!",
				"{tests,__tests__,peer-environments,examples}/**/*.{ts,tsx,js,mjs,cjs}",
			],
			ignoreDependencies: [
				// Release tests deliberately resolve these through @changesets/cli, not this workspace.
				"@manypkg/get-packages",
				"@changesets/assemble-release-plan",
			],
		},
	},
	ignore: ["**/dist/**"],
} satisfies KnipConfig
