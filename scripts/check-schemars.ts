import { execFileSync } from "node:child_process"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isDeepStrictEqual } from "node:util"
import {
	CATALOG,
	FIXTURES,
	PROBE,
	PACKAGE_NAME,
	PACKAGE_MANIFEST,
	ContractFailure,
	pinnedVersion,
	verifyLock,
	verifyHistoricalInputs,
	validateCatalog,
	reviewCandidate,
	requireChangeset,
	requireNextRelease,
	requirePreviousRelease,
	type Contracts,
	type Catalog,
	type Corpus,
} from "./schemars-contract.ts"

const root = fileURLToPath(new URL("../", import.meta.url))
function read(relative: string) {
	return readFileSync(path.join(root, relative), "utf8")
}
function git(...args: string[]): string {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	})
}
function contracts(readText: (file: string) => string): Contracts {
	const catalog = JSON.parse(readText(CATALOG)) as Catalog
	return {
		catalog,
		fixtures: Object.fromEntries(
			catalog.eras.map((era) => [
				era.since,
				JSON.parse(readText(`${FIXTURES}/eras/${era.since}.json`)) as Corpus,
			]),
		),
	}
}
function generate(manifest: string, expected: string): Corpus {
	if (pinnedVersion(read(manifest)) !== expected)
		throw new Error(`Generator ${manifest} must pin ${expected}`)
	verifyLock(read(path.join(path.dirname(manifest), "Cargo.lock")), expected)
	const output = execFileSync(
		"cargo",
		[
			"run",
			"--quiet",
			"--locked",
			"--manifest-path",
			path.join(root, manifest),
		],
		{
			cwd: root,
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
			env: {
				...process.env,
				CARGO_TARGET_DIR:
					process.env.CARGO_TARGET_DIR ??
					path.join(root, "artifacts/schemars/target"),
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	)
	const corpus = JSON.parse(output) as Corpus
	if (!corpus.schemas || typeof corpus.schemas !== "object")
		throw new Error("Generator must output a schemas object")
	return corpus
}
export async function checkSchemars(
	base = process.env.SCHEMARS_BASE_REF,
): Promise<void> {
	const current = contracts(read)
	validateCatalog(current)
	let previous: Contracts | undefined
	let previousVersion: string | undefined
	let baseFiles: Set<string> | undefined
	if (base) {
		// Missing adoption metadata is expected only when introducing this gate.
		baseFiles = new Set(
			git("ls-tree", "-r", "--name-only", base).trim().split("\n"),
		)
		if (baseFiles.has(CATALOG))
			previous = contracts((file) => git("show", `${base}:${file}`))
		if (baseFiles.has(PROBE))
			previousVersion = pinnedVersion(git("show", `${base}:${PROBE}`))
	}
	const candidate = pinnedVersion(read(PROBE))
	let actual: Corpus
	try {
		actual = generate(PROBE, candidate)
	} catch (error) {
		if (error instanceof ContractFailure) throw error
		const stderr = (error as { stderr?: string }).stderr
		throw new Error(
			`Cannot generate Schemars ${candidate}'s schemas. Check Cargo diagnostics and adapt the probe to the new API/features before deciding whether to add or extend an era.\n${stderr ?? String(error)}`,
		)
	}
	const outputDir = path.join(root, "artifacts/schemars")
	mkdirSync(outputDir, { recursive: true })
	writeFileSync(
		path.join(outputDir, `${candidate}.json`),
		`${JSON.stringify(actual, null, 2)}\n`,
	)
	reviewCandidate(candidate, actual, current, previous)
	if (previous)
		verifyHistoricalInputs(
			previous,
			(file) => git("show", `${base}:${file}`),
			read,
		)
	const newRelease =
		!previous ||
		!previous.catalog.eras.some((era) => era.versions.includes(candidate))
	if (baseFiles && newRelease) {
		const added = git("ls-files", ".changeset/*.md")
			.trim()
			.split("\n")
			.filter((file) => file && !baseFiles.has(file))
		requireChangeset(candidate, added.map(read))
		if (previousVersion) {
			requirePreviousRelease(
				previousVersion,
				[...baseFiles]
					.filter((file) => /^\.changeset\/[^/]+\.md$/.test(file))
					.map((file) => git("show", `${base}:${file}`)),
			)
			const pkg = JSON.parse(git("show", `${base}:${PACKAGE_MANIFEST}`)) as {
				version: string
			}
			const published = await fetch(
				`https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/${pkg.version}`,
				{ signal: AbortSignal.timeout(10000) },
			)
			if (!published.ok)
				throw new ContractFailure(
					"SCHEMARS_PREVIOUS_RELEASE_PENDING",
					`Publish ${PACKAGE_NAME} ${pkg.version} before accepting another Schemars release (npm returned HTTP ${published.status}).`,
				)

			const response = await fetch("https://index.crates.io/sc/he/schemars", {
				signal: AbortSignal.timeout(10000),
			})
			if (!response.ok)
				throw new Error(
					`Cannot check Schemars release order: HTTP ${response.status}`,
				)
			const releases = (await response.text())
				.trim()
				.split("\n")
				.map((line) => (JSON.parse(line) as { vers: string }).vers)
			requireNextRelease(previousVersion, candidate, releases)
		}
	}
	for (const era of current.catalog.eras) {
		for (const version of era.versions) {
			const corpus = generate(
				`${FIXTURES}/versions/${version}/Cargo.toml`,
				version,
			)
			if (!isDeepStrictEqual(corpus, current.fixtures[era.since]))
				throw new ContractFailure(
					"SCHEMARS_CONTRACT_DRIFT",
					`Historical Schemars ${version} no longer reproduces era ${era.since}. Preserve the original fixture and resolve the generator drift.`,
				)
			console.log(
				`Schemars ${version}: reproduced era ${era.since} (${Object.keys(corpus.schemas).length} schemas).`,
			)
		}
	}
	console.log(
		`Schemars ${candidate}: reviewed; all pinned compatibility contracts passed.`,
	)
}
if (import.meta.main) {
	try {
		await checkSchemars()
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	}
}
