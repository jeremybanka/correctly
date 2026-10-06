import { execFileSync } from "node:child_process"
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { schemarsEras } from "../packages/schemars/src/eras.ts"

const root = fileURLToPath(new URL("../", import.meta.url))
type Assignment = { workload: string; files: readonly string[] }

/** New tests must be scheduled exactly once, including packaging checks. */
export function verifyOwnership(
	expected: readonly string[],
	assignments: readonly Assignment[],
): void {
	const owners = new Map<string, string[]>()
	for (const { workload, files } of assignments)
		for (const file of files)
			owners.set(file, [...(owners.get(file) ?? []), workload])
	const expectedFiles = new Set(expected)
	const errors: string[] = []
	for (const file of expectedFiles) {
		const workloads = owners.get(file) ?? []
		if (workloads.length !== 1)
			errors.push(
				`${file}: expected one workload; found ${workloads.join(", ") || "none"}.`,
			)
	}
	for (const file of owners.keys())
		if (!expectedFiles.has(file))
			errors.push(`${file}: scheduled test was not discovered.`)
	if (errors.length) throw new Error(errors.sort().join("\n"))
}

export function verifyTestWorkloads(): void {
	const expected = globSync(
		[
			"packages/*/tests/**/*.{test,spec}.{ts,tsx}",
			"scripts/**/*.{test,spec}.{ts,tsx}",
		],
		{ cwd: root, exclude: ["**/target/**"] },
	).sort()
	const assignments: Assignment[] = []
	const reports = mkdtempSync(path.join(tmpdir(), "correctly-test-workloads-"))
	try {
		for (const pkg of ["correctly", "schemars"])
			for (const distribution of [false, true]) {
				// Ask Vitest itself, so includes/excludes cannot drift from this audit.
				const report = path.join(reports, `${pkg}-${distribution}.json`)
				execFileSync(
					"pnpm",
					[
						"exec",
						"vp",
						"test",
						"list",
						"--filesOnly",
						"--json",
						report,
						...(distribution
							? ["--config", "vite.distribution.config.ts"]
							: []),
					],
					{
						cwd: path.join(root, "packages", pkg),
						encoding: "utf8",
						stdio: ["ignore", "pipe", "pipe"],
					},
				)
				const files = (
					JSON.parse(readFileSync(report, "utf8")) as { file: string }[]
				).map(({ file }) => path.relative(root, file).split(path.sep).join("/"))
				assignments.push({
					workload: distribution ? "distribution" : "core",
					files,
				})
			}
	} finally {
		rmSync(reports, { recursive: true, force: true })
	}
	verifyOwnership(expected, assignments)
	for (const era of schemarsEras.slice(1)) {
		const file = `packages/schemars/tests/public/schemars-${era.since}.test.ts`
		if (!expected.includes(file))
			throw new Error(
				`Era ${era.since} needs its own test entry point: ${file}.`,
			)
	}
	console.log(
		`Verified ${expected.length} test files across source and distribution workloads.`,
	)
}

if (import.meta.main) verifyTestWorkloads()
