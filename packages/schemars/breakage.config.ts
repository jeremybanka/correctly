import { changesetsReleaseDelta } from "@breakage/changesets"
import { defineConfig, semverPolicy } from "breakage"

export default defineConfig({
	tagPattern: "refs/tags/@correctlyjs/schemars@",
	// Superseded source-coupled contracts now use package exports and an explicit
	// selector catalog fixture. No production source belongs in the restore set.
	testPattern:
		"tests/public/**/!(schemars.test.ts|schemars-eras.test.ts|schemars-regressions.test.ts|schemars-modern.ts)",
	test: "vp test tests/public",
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: "minor" }),
	},
	npm: {
		artifact: "../../artifacts/schemars.tgz",
		representatives: "peer-environments/*",
		lockfile: "package-lock.json",
		prepareCommand:
			"npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund",
		suites: {
			correctly: {
				files: ["tests/public/**/*", "vite.peer.config.ts"],
				command: "vp test --config vite.peer.config.ts",
			},
		},
		localPeers: {
			correctly: {
				directory: "../correctly",
				artifact: "../../artifacts/correctly.tgz",
			},
		},
		baseline: { tagPattern: "refs/tags/@correctlyjs/schemars@" },
	},
})
