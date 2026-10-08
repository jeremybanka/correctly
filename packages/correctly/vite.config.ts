import { defineConfig } from "vite-plus"
export default defineConfig({
	pack: [
		{
			clean: true,
			entry: {
				cli: "src/cli/main.ts",
				lsp: "src/lsp/server.ts",
				core: "src/core/index.ts",
				worker: "src/runtime/worker.ts",
				ajv: "src/validators/ajv.ts",
				renovate: "src/extensions/renovate.ts",
			},
			format: "esm",
			outDir: "dist",
			sourcemap: true,
			deps: {
				// tsdown <0.23 compatibility: resolve external dependency subpaths.
				// Remove to preserve subpath imports as written (the new default).
				// https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
				resolveDepSubpath: true,
				neverBundle: true,
			},
			dts: {
				entry: [
					"src/core/index.ts",
					"src/validators/ajv.ts",
					"src/extensions/renovate.ts",
				],
				sourcemap: true,
			},
		},
	],
	test: {
		reporters: process.env.CI ? ["default", "json"] : ["default"],
		outputFile: { json: "../../artifacts/test-results/core.json" },
		include: ["tests/**/*.test.ts"],
		exclude: ["tests/private/distribution.test.ts"],
	},
})
