import { defineConfig } from "vite-plus"

export default defineConfig({
	lint: {
		ignorePatterns: ["**/dist/**", "**/artifacts/**", "**/node_modules/**"],
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
	staged: {
		"*": ["dprint fmt", "vp check --no-fmt --fix"],
	},
})
