import { defineConfig } from "vite-plus"
export default defineConfig({
	pack: [
		{
			clean: true,
			entry: {
				cli: "src/cli/main.ts",
				lsp: "src/lsp/server.ts",
				core: "src/core/index.ts",
			},
			format: "esm",
			outDir: "dist",
			sourcemap: true,
			deps: { neverBundle: true },
			dts: { entry: ["src/core/index.ts"], sourcemap: true },
		},
	],
	test: { include: ["tests/**/*.test.ts"] },
})
