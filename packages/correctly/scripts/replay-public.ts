import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { ReplayPlan } from "./released-schemars.ts"

export function replayPublic(plan: ReplayPlan, run: () => number): number {
	// Check all inputs before touching any. Breakage owns restoration to candidate
	// files; this runner restores its temporary rewiring to the released originals.
	for (const patch of plan.patches)
		if (
			readFileSync(path.join(plan.root, patch.file), "utf8") !== patch.original
		)
			throw new Error(`Historical input changed before replay: ${patch.file}`)
	try {
		for (const patch of plan.patches)
			writeFileSync(path.join(plan.root, patch.file), patch.replacement)
		return run()
	} finally {
		for (const patch of plan.patches)
			writeFileSync(path.join(plan.root, patch.file), patch.original)
	}
}

if (import.meta.main) {
	const filename = process.env.CORRECTLY_REPLAY_PLAN
	if (!filename)
		throw new Error(
			"Run pnpm -C packages/correctly test:breakage to prepare a pinned replay.",
		)
	let status = 2
	try {
		const plan = JSON.parse(readFileSync(filename, "utf8")) as ReplayPlan
		status = replayPublic(plan, () => {
			const result = spawnSync("pnpm", ["exec", "vp", "test", "--no-cache"], {
				cwd: path.join(plan.root, "packages/correctly"),
				// Breakage 0.8 retains stderr as its failure report; include the
				// runner's assertion output there as well as infrastructure errors.
				stdio: ["inherit", 2, 2],
				env: {
					...process.env,
					CORRECTLY_RELEASED_TEST_FILES: JSON.stringify(
						plan.files.map((file) => path.relative("packages/correctly", file)),
					),
				},
			})
			if (result.error) throw result.error
			return result.status === 0 || result.status === 1 ? result.status : 2
		})
	} catch (error) {
		console.error(error)
	} finally {
		writeFileSync(`${filename}.result`, String(status))
	}
	process.exitCode = status
}
