import { defineConfig } from "vite-plus"
export default defineConfig({
	pack: [
		{
			clean: true,
			entry: { index: "src/index.ts" },
			format: "esm",
			outDir: "dist",
			sourcemap: true,
			deps: { neverBundle: true },
			dts: { entry: ["src/index.ts"], sourcemap: true },
		},
	],
	test: { include: ["tests/**/*.test.ts"] },
})
