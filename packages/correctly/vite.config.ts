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
				schemars: "src/extensions/schemars.ts",
				renovate: "src/extensions/renovate.ts",
			},
			format: "esm",
			outDir: "dist",
			sourcemap: true,
			deps: { neverBundle: true },
			dts: {
				entry: [
					"src/core/index.ts",
					"src/validators/ajv.ts",
					"src/extensions/schemars.ts",
					"src/extensions/renovate.ts",
				],
				sourcemap: true,
			},
		},
	],
	test: { include: ["tests/**/*.test.ts"] },
})
