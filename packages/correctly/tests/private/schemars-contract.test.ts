import { readFileSync } from "node:fs"
import { expect, test } from "vite-plus/test"
import {
	reviewCandidate,
	requireChangeset,
	requireNextRelease,
	requirePreviousRelease,
	pinnedVersion,
	verifyLock,
	validateCatalog,
	type Contracts,
	type Corpus,
} from "../../../../scripts/schemars-contract.ts"
import fixture from "../public/fixtures/schemars/eras/0.8.15.json" with { type: "json" }
import catalog from "../../src/core/extensions/schemars-eras.json" with { type: "json" }

const current: Contracts = { catalog, fixtures: { "0.8.15": fixture } }
const previous: Contracts = {
	catalog: {
		eras: [
			{ since: "0.8.15", versions: catalog.eras[0]!.versions.slice(0, -1) },
		],
	},
	fixtures: current.fixtures,
}
const different: Corpus = {
	schemas: {
		...fixture.schemas,
		NewType: { type: "string", format: "new-format" },
	},
}
const patch =
	'---\n"correctly": patch\n---\n\nExtend Schemars support through 0.8.22.\n'

test("an initial Renovate pin bump with identical schemas is red until its era is extended", () => {
	expect(() => reviewCandidate("0.8.22", fixture, previous, previous)).toThrow(
		"SCHEMARS_ERA_EXTENSION_REQUIRED",
	)
	expect(() =>
		reviewCandidate("0.8.22", fixture, current, previous),
	).not.toThrow()
})
test("changed output requires a new era beginning at exactly the candidate release", () => {
	expect(() =>
		reviewCandidate("0.8.22", different, previous, previous),
	).toThrow("SCHEMARS_NEW_ERA_REQUIRED")
	expect(() => reviewCandidate("0.8.22", different, current, previous)).toThrow(
		"SCHEMARS_NEW_ERA_REQUIRED",
	)
	const next = {
		catalog: {
			eras: [
				...previous.catalog.eras,
				{ since: "0.8.22", versions: ["0.8.22"] },
			],
		},
		fixtures: { ...previous.fixtures, "0.8.22": different },
	}
	expect(() =>
		reviewCandidate("0.8.22", different, next, previous),
	).not.toThrow()
})
test("unchanged output cannot be approved as a new era", () => {
	const next = {
		catalog: {
			eras: [
				...previous.catalog.eras,
				{ since: "0.8.22", versions: ["0.8.22"] },
			],
		},
		fixtures: { ...previous.fixtures, "0.8.22": fixture },
	}
	expect(() => reviewCandidate("0.8.22", fixture, next, previous)).toThrow(
		"SCHEMARS_ERA_EXTENSION_REQUIRED",
	)
})
test("snapshot replacement cannot bypass era review", () => {
	const replaced = { ...current, fixtures: { "0.8.15": different } }
	expect(() =>
		reviewCandidate("0.8.22", different, replaced, previous),
	).toThrow("SCHEMARS_NEW_ERA_REQUIRED")
})
test("rewriting an older corpus is rejected even when the candidate has a valid new era", () => {
	const changedOld = { schemas: { legacy: { type: "boolean" } } }
	const next = {
		catalog: {
			eras: [
				...previous.catalog.eras,
				{ since: "0.8.22", versions: ["0.8.22"] },
			],
		},
		fixtures: { "0.8.15": changedOld, "0.8.22": different },
	}
	expect(() => reviewCandidate("0.8.22", different, next, previous)).toThrow(
		"SCHEMARS_HISTORY_CHANGED",
	)
})
test("a reviewed version cannot silently change its output", () => {
	expect(() => reviewCandidate("0.8.22", different, current)).toThrow(
		"SCHEMARS_CONTRACT_DRIFT",
	)
})
test("multiple new versions cannot share one upgrade PR", () => {
	const earlier = {
		...previous,
		catalog: {
			eras: [
				{ since: "0.8.15", versions: catalog.eras[0]!.versions.slice(0, -2) },
			],
		},
	}
	expect(() => reviewCandidate("0.8.22", fixture, current, earlier)).toThrow(
		"SCHEMARS_ONE_RELEASE_REQUIRED",
	)
})
test("the first catalog may adopt historical releases together", () => {
	expect(() => reviewCandidate("0.8.22", fixture, current)).not.toThrow()
})
test.each(
	[
		[],
		[patch.replace('"correctly"', '"another-package"')],
		[patch.replace("0.8.22", "0.8.21")],
		[patch.replace("patch", "none")],
		[patch.replace("0.8.22", "0.8.220")],
	].map((changesets) => ({ changesets })),
)(
	"missing or unrelated release notes cannot approve the update (%j)",
	({ changesets }) => {
		expect(() => requireChangeset("0.8.22", changesets)).toThrow(
			"SCHEMARS_CHANGESET_REQUIRED",
		)
	},
)
test("a new correctly changeset must name the reviewed release", () => {
	expect(() => requireChangeset("0.8.22", [patch])).not.toThrow()
})
test("pending Schemars changesets must ship before another update", () => {
	expect(() => requirePreviousRelease("0.8.22", [patch])).toThrow(
		"SCHEMARS_PREVIOUS_RELEASE_PENDING",
	)
	expect(() => requirePreviousRelease("0.8.22", [])).not.toThrow()
})
test("Renovate cannot silently skip intermediate stable releases", () => {
	expect(() =>
		requireNextRelease("0.8.20", "0.8.22", [
			"0.8.19",
			"0.8.21",
			"0.8.22",
			"0.8.23",
		]),
	).toThrow("SCHEMARS_RELEASES_SKIPPED")
	expect(() =>
		requireNextRelease("0.8.21", "0.8.22", [
			"0.8.21",
			"0.8.22-alpha.1",
			"0.8.22",
		]),
	).not.toThrow()
})
test("overlapping era definitions are rejected", () => {
	expect(() =>
		validateCatalog({
			...current,
			catalog: { eras: [...catalog.eras, ...catalog.eras] },
		}),
	).toThrow("SCHEMARS_INVALID_ERA")
})
test("every historical crate and derive dependency is locked at its exact advertised version", () => {
	for (const era of catalog.eras)
		for (const version of era.versions) {
			const root = new URL(
				`../public/fixtures/schemars/versions/${version}/`,
				import.meta.url,
			)
			expect(
				pinnedVersion(readFileSync(new URL("Cargo.toml", root), "utf8")),
			).toBe(version)
			expect(() =>
				verifyLock(readFileSync(new URL("Cargo.lock", root), "utf8"), version),
			).not.toThrow()
		}
	expect(() =>
		verifyLock('[[package]]\nname = "schemars"\nversion = "0.8.21"', "0.8.22"),
	).toThrow("SCHEMARS_LOCK_MISMATCH")
	expect(() => pinnedVersion('schemars = { version = "^0.8.22" }')).toThrow(
		"SCHEMARS_PIN_REQUIRED",
	)
})
test("the tracked probe is within Renovate's discovery scope and requires review", () => {
	const renovate = JSON.parse(
		readFileSync(new URL("../../../../renovate.json", import.meta.url), "utf8"),
	)
	const rule = renovate.packageRules.find((rule: { description?: string }) =>
		rule.description?.startsWith("Every Schemars release"),
	)
	expect(rule).toMatchObject({
		matchFileNames: ["compatibility/schemars/probe/Cargo.toml"],
		matchPackageNames: ["schemars"],
		enabled: true,
		automerge: false,
		prCreation: "immediate",
		minimumReleaseAge: null,
	})
	expect(
		readFileSync(
			new URL("../../../../.github/workflows/test.yml", import.meta.url),
			"utf8",
		),
	).toContain("SCHEMARS_BASE_REF: ${{ github.event.pull_request.base.sha }}")
})
