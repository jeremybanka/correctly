import { defineConfig } from "vite-plus"

export default defineConfig({
	test: {
		include: ["tests/private/distribution.test.ts"],
		reporters: process.env.CI ? ["default", "json"] : ["default"],
		outputFile: { json: "../../artifacts/test-results/core-distribution.json" },
	},
})
