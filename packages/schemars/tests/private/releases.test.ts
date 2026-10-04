import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { readConfig } from "@changesets/config"
import { expect, test } from "vite-plus/test"

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
	// Model the first published versions without changing working-tree manifests.
	for (const pkg of packages.packages)
		pkg.packageJson.version =
			pkg.packageJson.name === "correctly" ? "0.1.0" : "0.0.1"
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
})
