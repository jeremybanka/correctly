import { changesetsReleaseDelta } from "@breakage/changesets"
import { semverPolicy } from "breakage"

export default {
	tagPattern: "refs/tags/correctly@",
	// These legacy paths are superseded by extension-api, extension-validation,
	// and project.ts; see tests/README.md for the one-time ownership migration.
	testPattern:
		"tests/public/**/!(extensions.test.ts|schema-compatibility.test.ts|helpers.ts)",
	test: "vp test tests/public",
	baseDirname: ".",
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: "minor" }),
	},
}
