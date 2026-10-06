import { defineConfig } from "vite-plus"
export default defineConfig({
	pack: [
		{
			clean: true,
			entry: { index: "src/index.ts", ajv: "src/ajv.ts" },
			format: "esm",
			outDir: "dist",
			sourcemap: true,
			deps: { neverBundle: true },
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
