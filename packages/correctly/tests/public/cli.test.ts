import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vite-plus/test"
import { check } from "../../src/cli/check.ts"
import { put, setup, temp } from "./helpers.ts"
import type { Report } from "../../src/core/types.ts"

const entry = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))
test("published check command has stable JSON output and exit statuses without filtering", async () => {
	const { root } = await setup()
	await put(root, "data/test.json", { name: "valid" })
	const valid = spawnSync(
		process.execPath,
		[entry, "check", "--format", "json"],
		{ cwd: root, encoding: "utf8" },
	)
	expect(valid.status).toBe(0)
	expect(valid.stderr).toBe("")
	const report = JSON.parse(valid.stdout) as Report
	expect(report).toMatchObject({
		reportVersion: 1,
		exitCode: 0,
		summary: { checked: 1, schemaCovered: 1, invalid: 0, failures: 0 },
	})
	await put(root, "data/test.json", { name: 1 })
	expect(
		spawnSync(process.execPath, [entry, "check"], { cwd: root }).status,
	).toBe(1)
	await put(root, "correctly.config.json", {
		associations: [{ files: ["**/*.json"], schema: "missing.json" }],
	})
	const missing = spawnSync(
		process.execPath,
		[entry, "check", "--format=json"],
		{ cwd: root, encoding: "utf8" },
	)
	expect(missing.status).toBe(2)
	expect((JSON.parse(missing.stdout) as Report).failures[0]?.code).toBe(
		"schema-load",
	)
})

test("explicit config and file paths resolve from cwd; schemas resolve from the config", async () => {
	const { root, configPath } = await setup()
	await put(root, "data/test.json", { name: "valid" })
	const report = await check({
		cwd: path.join(root, "data"),
		config: "../correctly.config.json",
		files: ["test.json"],
	})
	expect(report).toMatchObject({
		config: configPath,
		exitCode: 0,
		summary: { checked: 1 },
	})
})

test("errors take precedence over invalid inputs and excluded files are visible", async () => {
	const { root } = await setup()
	await put(root, "data/test.json", "{")
	await put(root, "node_modules/ignored.json", "{")
	const report = await check({
		cwd: root,
		files: ["data/test.json", "data/missing.json", "node_modules/ignored.json"],
	})
	expect(report.exitCode).toBe(2)
	expect(
		report.files.find((f) => f.coverage === "excluded")?.diagnostics,
	).toEqual([])
})

test("configuration discovery and argument errors produce exit 2", async () => {
	const root = await temp()
	for (const args of [
		["check"],
		["check", "--unknown"],
		["check", "--format", "invalid"],
		["unknown"],
	])
		expect(
			spawnSync(process.execPath, [entry, ...args], { cwd: root }).status,
		).toBe(2)
})

test("real repository configuration fixtures pass and invalid variants fail", async () => {
	const root = await temp()
	const fixtures = new URL("./fixtures/repositories/", import.meta.url)
	for (const schema of ["changesets", "dprint"])
		await put(
			root,
			`${schema}.schema.json`,
			await readFile(new URL(`${schema}.schema.json`, fixtures), "utf8"),
		)
	await put(root, "correctly.config.json", {
		files: ["data/**/*.json"],
		associations: [
			{ files: ["data/*.changesets.json"], schema: "changesets.schema.json" },
			{ files: ["data/*.dprint.json"], schema: "dprint.schema.json" },
		],
	})
	for (const fixture of [
		"lasertag.changesets.json",
		"wayforge.changesets.json",
		"recoverage.changesets.json",
		"lasertag.dprint.json",
		"agents-yaml.dprint.json",
	])
		await put(
			root,
			`data/${fixture}`,
			await readFile(new URL(fixture, fixtures), "utf8"),
		)
	const report = await check({ cwd: root, offline: true })
	expect(report.failures).toEqual([])
	expect(report.exitCode).toBe(0)
	expect(report.summary.schemaCovered).toBe(5)
	await put(root, "data/invalid.changesets.json", {
		access: "private",
		baseBranch: 2,
	})
	await put(root, "data/invalid.dprint.json", { lineWidth: "wide" })
	const invalid = await check({ cwd: root, offline: true })
	expect(invalid.exitCode).toBe(1)
	expect(invalid.summary.invalid).toBe(2)
})
