import { isDeepStrictEqual } from "node:util"
import type { EraDefinition } from "../packages/schemars/src/eras.ts"
import { compareVersions } from "../packages/schemars/src/select-era.ts"

export type Corpus = { schemas: Record<string, unknown> }
export type Catalog = { eras: readonly EraDefinition[] }
export type Contracts = { catalog: Catalog; fixtures: Record<string, Corpus> }
export const CATALOG = "packages/schemars/src/eras.ts"
export const FIXTURES = "packages/schemars/tests/public/fixtures"
export const PACKAGE_NAME = "@correctlyjs/schemars"
export const PACKAGE_MANIFEST = "packages/schemars/package.json"
export const PROBE = "compatibility/schemars/probe/Cargo.toml"
export class ContractFailure extends Error {
	readonly code: string
	constructor(code: string, message: string) {
		super(`${code}: ${message}`)
		this.code = code
	}
}
function fail(code: string, message: string): never {
	throw new ContractFailure(code, message)
}
export function pinnedVersion(manifest: string): string {
	const version = /^schemars\s*=\s*\{\s*version\s*=\s*"=(\d+\.\d+\.\d+)"/m.exec(
		manifest,
	)?.[1]
	if (!version)
		fail(
			"SCHEMARS_PIN_REQUIRED",
			"The probe and historical manifests must pin one exact stable Schemars release with =major.minor.patch.",
		)
	return version
}
export function verifyLock(lock: string, expected: string): void {
	for (const name of ["schemars", "schemars_derive"]) {
		const versions = lock
			.split("[[package]]")
			.filter((block) => new RegExp(`^name = "${name}"$`, "m").test(block))
			.map((block) => /^version = "([^"]+)"$/m.exec(block)?.[1])
		if (versions.length !== 1 || versions[0] !== expected)
			fail(
				"SCHEMARS_LOCK_MISMATCH",
				`Expected ${name} =${expected} in Cargo.lock; found ${versions.join(", ") || "none"}. Update the probe lockfile without changing historical pins.`,
			)
	}
}
export function validateCatalog({ catalog, fixtures }: Contracts): void {
	let previous: string | undefined
	for (const era of catalog.eras) {
		if (!era.versions.length || era.versions[0] !== era.since)
			fail(
				"SCHEMARS_INVALID_ERA",
				`Era ${era.since} must start with its first tested release.`,
			)
		if (!fixtures[era.since]?.schemas)
			fail(
				"SCHEMARS_FIXTURE_MISSING",
				`Era ${era.since} needs a schema corpus.`,
			)
		for (const version of era.versions) {
			if (
				!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
				(previous && compareVersions(previous, version) >= 0)
			)
				fail(
					"SCHEMARS_INVALID_ERA",
					`Releases must be unique and ordered across nonoverlapping eras: ${version}.`,
				)
			previous = version
		}
	}
	if (!previous)
		fail("SCHEMARS_INVALID_ERA", "At least one reviewed era is required.")
}
function eraFor(contracts: Contracts, version: string) {
	return contracts.catalog.eras.find((era) => era.versions.includes(version))
}
function predecessor(contracts: Contracts, version: string) {
	return contracts.catalog.eras
		.filter((era) => compareVersions(era.since, version) <= 0)
		.at(-1)
}
export function changedSchemas(before: Corpus, after: Corpus): string[] {
	return [
		...new Set([...Object.keys(before.schemas), ...Object.keys(after.schemas)]),
	]
		.filter(
			(name) => !isDeepStrictEqual(before.schemas[name], after.schemas[name]),
		)
		.sort()
}
export function verifyHistoricalInputs(
	previous: Contracts,
	readPrevious: (file: string) => string,
	readCurrent: (file: string) => string,
): void {
	for (const era of previous.catalog.eras) {
		const files = [
			`${FIXTURES}/eras/${era.since}.rs`,
			...era.versions.flatMap((version) => [
				`${FIXTURES}/versions/${version}/Cargo.toml`,
				`${FIXTURES}/versions/${version}/Cargo.lock`,
			]),
		]
		for (const file of files)
			if (readPrevious(file) !== readCurrent(file))
				fail(
					"SCHEMARS_HISTORY_CHANGED",
					`Historical generator input ${file} is frozen. Preserve it and add a generator for the new release.`,
				)
	}
}
/** Unknown releases always fail, even when output is identical. */
export function reviewCandidate(
	version: string,
	actual: Corpus,
	current: Contracts,
	previous?: Contracts,
): void {
	validateCatalog(current)
	const declared = eraFor(current, version)
	const reference = predecessor(previous ?? current, version)
	if (!reference)
		fail(
			"SCHEMARS_NEW_ERA_REQUIRED",
			`Schemars ${version} predates the reviewed contracts. Add an era beginning at ${version}, a pinned generator, assertions, documentation, and an @correctlyjs/schemars changeset.`,
		)
	const before = (previous ?? current).fixtures[reference.since]!
	const changes = changedSchemas(before, actual)
	const knownBefore = previous ? eraFor(previous, version) : declared
	if (!knownBefore) {
		if (changes.length && (!declared || declared.since !== version))
			fail(
				"SCHEMARS_NEW_ERA_REQUIRED",
				`Schemars ${version} produces new schemas (${changes.join(", ")}). Add a compatibility era beginning at ${version}; preserve era ${reference.since}. Add the exact generator pin, behavioral tests, documentation, and an @correctlyjs/schemars changeset.`,
			)
		if (!changes.length && (!declared || declared.since !== reference.since))
			fail(
				"SCHEMARS_ERA_EXTENSION_REQUIRED",
				`Schemars ${version} produces the same schemas as era ${reference.since}. Extend that era through ${version}, add the exact generator pin, and add an @correctlyjs/schemars changeset. Identical schemas still require a release.`,
			)
	}
	if (!declared)
		fail("SCHEMARS_UNREVIEWED", `Schemars ${version} is not reviewed.`)
	if (!isDeepStrictEqual(current.fixtures[declared.since], actual))
		fail(
			"SCHEMARS_CONTRACT_DRIFT",
			`Schemars ${version} does not reproduce era ${declared.since}. Changed schemas: ${changedSchemas(current.fixtures[declared.since]!, actual).join(", ")}. Do not overwrite historical contracts.`,
		)
	if (previous) {
		for (const old of previous.catalog.eras) {
			const now = current.catalog.eras.find((era) => era.since === old.since)
			if (
				!now ||
				!isDeepStrictEqual(
					now.versions.slice(0, old.versions.length),
					old.versions,
				) ||
				!isDeepStrictEqual(
					previous.fixtures[old.since],
					current.fixtures[old.since],
				)
			)
				fail(
					"SCHEMARS_HISTORY_CHANGED",
					`Reviewed era ${old.since} and its existing releases are immutable. Add or extend an era instead.`,
				)
		}
		const oldVersions = new Set(
			previous.catalog.eras.flatMap((era) => era.versions),
		)
		const additions = current.catalog.eras
			.flatMap((era) => era.versions)
			.filter((v) => !oldVersions.has(v))
		if (
			additions.length &&
			(additions.length !== 1 || additions[0] !== version)
		)
			fail(
				"SCHEMARS_ONE_RELEASE_REQUIRED",
				"Compare one new Schemars release at each review step; review a consecutive sequence in order with its own pinned generators and changesets.",
			)
	}
}
function changesetNamesRelease(text: string, version: string): boolean {
	const sections = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text)
	if (!sections) return false
	const [, frontmatter, body] = sections
	return (
		/^["']?@correctlyjs\/schemars["']?:\s*(patch|minor|major)\s*\r?$/m.test(
			frontmatter!,
		) &&
		body!.match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/g)?.includes(version) === true
	)
}
export function requireChangeset(
	version: string,
	changesets: readonly string[],
): void {
	if (!changesets.some((text) => changesetNamesRelease(text, version)))
		fail(
			"SCHEMARS_CHANGESET_REQUIRED",
			`Add a new @correctlyjs/schemars changeset naming Schemars ${version}. Every newly reviewed Schemars release needs release notes, including unchanged schemas.`,
		)
}
/** Each upstream release needs a distinct changeset, even in a batch. */
export function requireReleaseChangesets(
	versions: readonly string[],
	changesets: readonly string[],
): void {
	const remaining = [...changesets]
	for (const version of versions) {
		requireChangeset(version, remaining)
		remaining.splice(
			remaining.findIndex((text) => changesetNamesRelease(text, version)),
			1,
		)
	}
}
/** A newer pending bot PR must not silently skip intervening stable releases. */
export function requireNextRelease(
	from: string,
	to: string,
	released: readonly string[],
): void {
	const skipped = released
		.filter(
			(v) =>
				/^\d+\.\d+\.\d+$/.test(v) &&
				compareVersions(v, from) > 0 &&
				compareVersions(v, to) < 0,
		)
		.sort(compareVersions)
	if (skipped.length)
		fail(
			"SCHEMARS_RELEASES_SKIPPED",
			`Review Schemars ${skipped[0]} first; this review step skips ${skipped.join(", ")}. Include every intervening stable release's pin, contract, and changeset.`,
		)
}

export function requirePreviousRelease(
	version: string,
	pendingChangesets: readonly string[],
): void {
	if (pendingChangesets.some((text) => changesetNamesRelease(text, version)))
		fail(
			"SCHEMARS_PREVIOUS_RELEASE_PENDING",
			`Publish the @correctlyjs/schemars release for Schemars ${version} before accepting another Schemars release. Its changeset is still pending on the base branch.`,
		)
}
