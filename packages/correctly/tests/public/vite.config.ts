import { defineConfig } from "vite-plus"

export default defineConfig({
	test: {
		include: ["tests/public/**/*.test.ts"],
		passWithNoTests: false,
	},
})
