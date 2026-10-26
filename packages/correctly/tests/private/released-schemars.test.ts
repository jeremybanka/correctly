import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vite-plus/test"
import {
	dependencyPin,
	dependencyName,
	packageName,
	rebindSchemars,
	type ReplayPlan,
} from "../../scripts/released-schemars.ts"
import { replayPublic } from "../../scripts/replay-public.ts"
import { configSource, temp } from "../public/helpers.ts"
import { configSource as workspaceConfigSource } from "../../../schemars/tests/public/helpers.ts"

test("Correctly uses the published dev dependency while Schemars tests use workspace source", () => {
	const entry = fileURLToPath(import.meta.resolve("schemars-released/ajv"))
	const directory = path.resolve(path.dirname(entry), "..")
	const installed = JSON.parse(
		readFileSync(path.join(directory, "package.json"), "utf8"),
	)
	const candidate = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	)
	expect(installed.name).toBe(packageName)
	expect(installed.version).toBe(
		candidate.devDependencies[dependencyName].slice(
			`npm:${packageName}@`.length,
		),
	)
	expect(
		dependencyPin(
			{ ref: "refs/tags/future-correctly-release", commit: "a".repeat(40) },
			candidate,
			readFileSync(
				new URL("../../../../pnpm-lock.yaml", import.meta.url),
				"utf8",
			),
		).version,
	).toBe(installed.version)
	expect(realpathSync(directory)).not.toBe(
		realpathSync(new URL("../../../schemars", import.meta.url)),
	)
	const config = {
		associations: [
			{
				files: ["*.json"],
				schema: "schema.json",
				extensions: ["schemars@0.8.22"],
			},
		],
	}
	for (const built of [false, true]) {
		expect(configSource(config, built)).toContain(
			import.meta.resolve("schemars-released/ajv"),
		)
		expect(workspaceConfigSource(config, built)).toContain(
			built ? "/schemars/dist/ajv.mjs" : "/schemars/src/ajv.ts",
		)
	}
})

const legacy = {
	ref: "refs/tags/correctly@0.1.0",
	commit: "20e9ef1445c3769d38f57212201f2ee81ac55198",
}
test("legacy replay is restricted to reviewed tag/commit pairs", () => {
	expect(dependencyPin(legacy, {}, "").version).toBe("0.0.1")
	expect(() =>
		dependencyPin({ ...legacy, commit: "a".repeat(40) }, {}, ""),
	).toThrow("Unrecognized legacy")
	expect(() =>
		dependencyPin({ ...legacy, ref: "refs/tags/correctly@9.9.9" }, {}, ""),
	).toThrow("Unrecognized legacy")
})

test("historical dependency identity comes from its manifest and registry lock entry", () => {
	const manifest = {
		devDependencies: { [dependencyName]: "npm:@correctlyjs/schemars@0.0.5" },
	}
	const lock = {
		importers: {
			"packages/correctly": {
				devDependencies: {
					[dependencyName]: {
						specifier: "npm:@correctlyjs/schemars@0.0.5",
						version:
							"@correctlyjs/schemars@0.0.5(correctly@packages+correctly)",
					},
				},
			},
		},
		packages: {
			[`${packageName}@0.0.5`]: {
				resolution: { integrity: "sha512-historical-artifact" },
			},
		},
	}
	expect(dependencyPin(legacy, manifest, JSON.stringify(lock))).toEqual({
		version: "0.0.5",
		integrity: "sha512-historical-artifact",
	})
	lock.importers["packages/correctly"].devDependencies[
		dependencyName
	]!.version = "link:../schemars"
	expect(() => dependencyPin(legacy, manifest, JSON.stringify(lock))).toThrow(
		"registry artifact",
	)
	expect(() =>
		dependencyPin(
			legacy,
			{
				devDependencies: {
					[dependencyName]: "npm:@correctlyjs/schemars@^0.0.5",
				},
			},
			"",
		),
	).toThrow("exact published")
})

test("legacy rewiring preserves every assertion and diagnostic recommendation", () => {
	const assertions =
		'\nexpect(() => schemars({version: "1.2.2"})).toThrow()\nexpect(message).toContain(\'import { schemars } from "@correctlyjs/schemars/ajv"\')\n'
	for (const specifier of [
		"../../../schemars/src/ajv.ts",
		"schemars-released/ajv",
	]) {
		const source = `import { schemars } from "${specifier}"${assertions}`
		const rebound = rebindSchemars(
			"extensions.test.ts",
			source,
			"/released/ajv.mjs",
		)
		expect(rebound).toBe(
			`import { schemars } from "/released/ajv.mjs"${assertions}`,
		)
	}
	const helper =
		'const extension = new URL(\n built ? "../../../schemars/dist/ajv.mjs" : "../../../schemars/src/ajv.ts",\n import.meta.url,\n).href\n'
	expect(rebindSchemars("helpers.ts", helper, "/released/ajv.mjs")).toBe(
		'const extension = "file:///released/ajv.mjs"\n',
	)
	expect(
		rebindSchemars(
			"helpers.ts",
			'const extension = import.meta.resolve("schemars-released/ajv")',
			"/released/ajv.mjs",
		),
	).toBe('const extension = "file:///released/ajv.mjs"')
	expect(() =>
		rebindSchemars("helpers.ts", "unexpected helper", "/released/ajv.mjs"),
	).toThrow("Unrecognized")
})

test.each([0, 1, 2, "throw"] as const)(
	"temporary dependency wiring is restored after result %s",
	async (status) => {
		const root = await temp()
		const file = "helper.ts"
		writeFileSync(path.join(root, file), "released input")
		const plan: ReplayPlan = {
			root,
			files: [],
			patches: [
				{
					file,
					original: "released input",
					replacement: "installed dependency",
				},
			],
		}
		const run = () =>
			replayPublic(plan, () => {
				expect(readFileSync(path.join(root, file), "utf8")).toBe(
					"installed dependency",
				)
				if (status === "throw") throw new Error("runner failed")
				return status
			})
		if (status === "throw") expect(run).toThrow("runner failed")
		else expect(run()).toBe(status)
		expect(readFileSync(path.join(root, file), "utf8")).toBe("released input")
	},
)

test("mismatched historical inputs fail before any file is rewritten", async () => {
	const root = await temp()
	writeFileSync(path.join(root, "first.ts"), "original")
	writeFileSync(path.join(root, "second.ts"), "unexpected")
	expect(() =>
		replayPublic(
			{
				root,
				files: [],
				patches: [
					{ file: "first.ts", original: "original", replacement: "rewritten" },
					{ file: "second.ts", original: "original", replacement: "rewritten" },
				],
			},
			() => 0,
		),
	).toThrow("Historical input changed")
	expect(readFileSync(path.join(root, "first.ts"), "utf8")).toBe("original")
})
