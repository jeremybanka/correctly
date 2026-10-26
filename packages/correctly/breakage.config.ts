import { changesetsReleaseDelta } from "@breakage/changesets"
import { semverPolicy } from "breakage"

export default {
	tagPattern: "refs/tags/correctly@",
	testPattern: "{tests/public/**/*,peer-environments/schemars/package*.json}",
	test: "breakage npm test --config ../../breakage.config.ts --representative packages/correctly/peer-environments/schemars",
	baseDirname: ".",
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: "minor" }),
	},
}
