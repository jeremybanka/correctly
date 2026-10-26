import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readConfig } from "@changesets/config"
import { expect, test } from "vite-plus/test"
import { put, temp } from "../public/helpers.ts"

test("Changesets releases compatible core and extension updates independently", async () => {
	const require = createRequire(
		import.meta.resolve("@changesets/cli/package.json"),
	)
	const { getPackages } = await import(require.resolve("@manypkg/get-packages"))
	const { assembleReleasePlan } = await import(
		require.resolve("@changesets/assemble-release-plan")
	)
	const root = fileURLToPath(new URL("../../../../", import.meta.url))
	const packages = await getPackages(root)
	const { config } = await readConfig(root, packages)
	for (const name of ["@correctlyjs/schemars", "correctly"]) {
		const plan = assembleReleasePlan(
			[
				{
					id: "independent-update",
					summary: "A compatible update",
					releases: [{ name, type: "patch" }],
				},
			],
			packages,
			config,
		)
		expect(
			plan.releases
				.filter((release: { type: string }) => release.type !== "none")
				.map((release: { name: string }) => release.name),
		).toEqual([name])
	}

	// Apply real versioning to both packages: the external consumer baseline
	// must remain pinned even when Correctly itself receives a release.
	const directory = await temp()
	await put(directory, "package.json", {
		name: "release-fixture",
		private: true,
	})
	await put(directory, "pnpm-workspace.yaml", "packages:\n  - packages/*\n")
	for (const pkg of packages.packages)
		await put(
			directory,
			`packages/${pkg.packageJson.name === "correctly" ? "correctly" : "schemars"}/package.json`,
			pkg.packageJson,
		)
	const fixture = await getPackages(directory)
	const core = packages.packages.find(
		(pkg: { packageJson: { name: string } }) =>
			pkg.packageJson.name === "correctly",
	)!
	const changeset = {
		id: "both-packages",
		summary: "Version both packages without moving the external baseline",
		releases: packages.packages.map(
			(pkg: { packageJson: { name: string } }) => ({
				name: pkg.packageJson.name,
				type: "patch" as const,
			}),
		),
	}
	const plan = assembleReleasePlan([changeset], fixture, config)
	const { applyReleasePlan } = await import(
		require.resolve("@changesets/apply-release-plan")
	)
	await applyReleasePlan(plan, fixture, {
		...config,
		changelog: false,
		format: false,
	})
	const versioned = JSON.parse(
		await readFile(
			path.join(directory, "packages/correctly/package.json"),
			"utf8",
		),
	)
	expect(versioned.version).not.toBe(core.packageJson.version)
	expect(versioned.devDependencies["schemars-released"]).toBe(
		core.packageJson.devDependencies?.["schemars-released"],
	)
})
