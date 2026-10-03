import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const fixture = new URL(
	"../packages/correctly/tests/public/fixtures/schemars/",
	import.meta.url,
)
const actual: unknown = JSON.parse(
	execFileSync(
		"cargo",
		[
			"run",
			"--quiet",
			"--locked",
			"--manifest-path",
			new URL("Cargo.toml", fixture).pathname,
		],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
	),
)
const expected: unknown = JSON.parse(
	readFileSync(new URL("schemas.json", fixture), "utf8"),
)
assert.deepEqual(
	actual,
	expected,
	"Installed schemars =0.8.22 must reproduce the schemas used by the public tests",
)
console.log(
	"Schemars 0.8.22 regenerated every compatibility fixture successfully.",
)
