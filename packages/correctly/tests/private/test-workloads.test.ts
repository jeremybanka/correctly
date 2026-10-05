import { expect, test } from "vite-plus/test"
import { verifyOwnership } from "../../../../scripts/check-test-workloads.ts"

const files = ["core.test.ts", "distribution.test.ts"]
test("every discovered test belongs to exactly one workload", () => {
	expect(() =>
		verifyOwnership(files, [
			{ workload: "core", files: [files[0]!] },
			{ workload: "distribution", files: [files[1]!] },
		]),
	).not.toThrow()
})
test("a newly added test cannot be left out of CI", () => {
	expect(() =>
		verifyOwnership(files, [{ workload: "core", files: [files[0]!] }]),
	).toThrow("distribution.test.ts: expected one workload; found none")
})
test("packaging checks cannot run in both ordinary and distribution suites", () => {
	expect(() =>
		verifyOwnership(files, [
			{ workload: "core", files },
			{ workload: "distribution", files: [files[1]!] },
		]),
	).toThrow(
		"distribution.test.ts: expected one workload; found core, distribution",
	)
})
test("obsolete workload assignments cannot replace real tests", () => {
	expect(() =>
		verifyOwnership(files, [
			{ workload: "core", files: [...files, "deleted.test.ts"] },
		]),
	).toThrow("deleted.test.ts: scheduled test was not discovered")
})
