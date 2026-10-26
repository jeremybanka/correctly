import { execFileSync } from "node:child_process"
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { breakage, breakagePrelude, type BreakageOptions } from "breakage"
import {
	dependencyPin,
	installReleasedSchemars,
	publicDirectory,
	rebindSchemars,
	type ReplayPlan,
} from "./released-schemars.ts"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const config = JSON.parse(
	readFileSync(new URL("../breakage.config.json", import.meta.url), "utf8"),
) as BreakageOptions
const artifacts = path.join(root, "artifacts")
mkdirSync(artifacts, { recursive: true })
const directory = mkdtempSync(path.join(artifacts, "correctly-replay-"))
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8" })

try {
	if (git("status", "--porcelain").trim())
		throw new Error("Historical replay requires a clean checkout.")
	const baselineFile = path.join(directory, "baseline.json")
	const baseline = await breakagePrelude({
		out: baselineFile,
		tagPattern: config.tagPattern,
		baseDirname: root,
	})
	const show = (file: string) => git("show", `${baseline.commit}:${file}`)
	const pin = dependencyPin(
		baseline,
		JSON.parse(show("packages/correctly/package.json")),
		show("pnpm-lock.yaml"),
	)
	console.log(
		`Replaying ${baseline.ref} (${baseline.commit}) with published @correctlyjs/schemars@${pin.version}.`,
	)
	const entry = installReleasedSchemars(directory, pin)
	const files = git(
		"ls-tree",
		"-r",
		"--name-only",
		baseline.commit,
		"--",
		publicDirectory,
	)
		.trim()
		.split("\n")
		.filter((file) => /\.(?:test|spec)\.tsx?$/.test(file))
	if (!files.length)
		throw new Error("The selected release has no public tests.")
	const plan: ReplayPlan = {
		root,
		files,
		patches: ["extensions.test.ts", "helpers.ts"].map((name) => {
			const file = `${publicDirectory}${name}`
			const original = show(file)
			return {
				file,
				original,
				replacement: rebindSchemars(file, original, entry),
			}
		}),
	}
	const planFile = path.join(directory, "plan.json")
	writeFileSync(planFile, JSON.stringify(plan))
	process.env.CORRECTLY_REPLAY_PLAN = planFile
	const result = await breakage({ ...config, baseDirname: root, baselineFile })
	console.log(result.summary)
	if (
		result.gitWasClean &&
		result.lastReleaseFound &&
		result.testsWereFound &&
		result.breakingChangesFound
	)
		console.error(result.testResult)
	// Breakage 0.8's certification hook cannot distinguish setup errors. Never
	// allow it to certify a missing runner result or a failed replay setup.
	if (readFileSync(`${planFile}.result`, "utf8") === "2")
		throw new Error("Historical replay setup failed.")
	process.exitCode =
		result.gitWasClean &&
		result.lastReleaseFound &&
		result.testsWereFound &&
		(!result.breakingChangesFound || result.breakingChangesCertified)
			? 0
			: 1
} catch (error) {
	console.error(error)
	process.exitCode = 2
} finally {
	delete process.env.CORRECTLY_REPLAY_PLAN
	rmSync(directory, { recursive: true, force: true })
}
