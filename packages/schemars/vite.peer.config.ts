import { defineConfig } from "vite-plus"

export default defineConfig({
	test: {
		include: ["tests/public/**/*.test.ts"],
		// The selector's explicit catalog argument is an internal source contract.
		// All public factory, era, and format contracts run through package exports.
		exclude: ["tests/public/selector.test.ts"],
	},
})
