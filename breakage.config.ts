import { changesetsReleaseDelta } from "@breakage/changesets"
import type { NpmConfig } from "breakage"

// The private workspace is a contract harness; Correctly is its candidate peer.
export default {
	npm: {
		artifact: "artifacts/contracts.tgz",
		representatives: "packages/correctly/peer-environments/schemars",
		lockfile: "package-lock.json",
		prepareCommand:
			"npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund",
		localPeers: {
			correctly: {
				directory: "packages/correctly",
				artifact: "artifacts/correctly.tgz",
			},
		},
		suites: {
			correctly: {
				files: [
					"packages/correctly/tests/public/**/*",
					"packages/correctly/vite.config.ts",
				],
				// Preserve released tests' relative paths, using installed packages only.
				// Copy candidate source so CLI package-root observations keep their layout.
				command:
					[
						"cp -R node_modules/correctly/. packages/correctly/",
						"mkdir -p packages/schemars/src",
						"cp packages/correctly/tests/public/fixtures/legacy-schemars.ts packages/schemars/src/ajv.ts",
						"ln -s ../../node_modules/@correctlyjs/schemars node_modules/schemars-released",
						"cd packages/correctly",
					].join(" && ") + " || exit 2; vp test tests/public",
			},
		},
		baseline: { tagPattern: "refs/tags/correctly-workspace@" },
		release: { resolveDelta: changesetsReleaseDelta() },
	} satisfies NpmConfig,
}
