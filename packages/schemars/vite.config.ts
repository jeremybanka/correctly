import { defineConfig } from "vite-plus"
export default defineConfig({
	pack: [
		{
			clean: true,
			entry: { index: "src/index.ts", ajv: "src/ajv.ts" },
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
			dts: { entry: ["src/index.ts", "src/ajv.ts"], sourcemap: true },
		},
	],
	test: {
		reporters: process.env.CI ? ["default", "json"] : ["default"],
		outputFile: { json: "../../artifacts/test-results/schemars.json" },
		include: ["tests/**/*.test.ts"],
		exclude: ["tests/private/distribution.test.ts"],
	},
})
