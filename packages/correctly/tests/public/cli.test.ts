import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vite-plus/test"
import { check, readableReport } from "../../src/cli/check.ts"
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

test("readable CLI groups files with ordered diagnostics, source ranges, and context", async () => {
	const { root } = await setup()
	await put(
		root,
		"data/invalid.json",
		'{\n  "name": 42,\n  "color": "green",\n  "debug": true\n}\n',
	)
	await put(root, "data/missing-name.json", '{\n  "color": "blue"\n}\n')
	const result = spawnSync(process.execPath, [entry, "check"], {
		cwd: root,
		encoding: "utf8",
	})
	expect(result.status).toBe(1)
	expect(result.stderr).toBe("")
	expect(result.stdout).toMatchInlineSnapshot(`
		"data/invalid.json  3 errors
		  json; schema; project → schema.json
		├─ 2:11  schema/type
		│  1 │ {
		│  2 │   "name": 42,
		│    │           ^^
		│    ╰─ /name: must be string
		│
		├─ 3:12  schema/enum
		│  3 │   "color": "green",
		│    │            ^^^^^^^
		│    ╰─ /color: must be equal to one of the allowed values
		│
		└─ 4:3  schema/additionalProperties
		   4 │   "debug": true
		     │   ^^^^^^^
		   5 │ }
		     ╰─ /debug: must NOT have additional properties

		data/missing-name.json  1 error
		  json; schema; project → schema.json
		└─ 1:1  schema/required
		   1 │ {
		     │ ^
		   2 │   "color": "blue"
		     ╰─ /name: must have required property 'name'

		────────────────────────────────────────────────────────

		▲ Check found 4 errors in 2 files

		2 checked, 2 schema-covered, 0 syntax-only, 2 invalid, 0 failures
		"
	`)
	const json = spawnSync(
		process.execPath,
		[entry, "check", "--format", "json"],
		{ cwd: root, encoding: "utf8" },
	)
	expect(JSON.parse(json.stdout)).toEqual(await check({ cwd: root }))
})

test("excerpts use the validated source snapshot and preserve JSON diagnostic order", async () => {
	const { root, file } = await setup()
	await put(root, "data/test.json", '{\n  "name": 42,\n  "debug": true\n}')
	const sources = new Map<string, string>()
	const report = await check({
		cwd: root,
		onRead: (file, text) => {
			sources.set(file, text)
		},
	})
	const serialized = JSON.stringify(report)
	await put(root, "data/test.json", { name: "new contents" })
	const output = readableReport(report, { cwd: root, sources })
	expect(output).toContain('2 │   "name": 42,')
	expect(output).not.toContain("new contents")
	expect(output.indexOf("schema/type")).toBeLessThan(
		output.indexOf("schema/additionalProperties"),
	)
	expect(JSON.stringify(report)).toBe(serialized)
	expect(sources.has(file)).toBe(true)
})

test("source excerpts align tabs and CRLF, mark duplicate keys, and show EOF errors", async () => {
	const { root } = await setup()
	await put(
		root,
		"data/test.json",
		'{\r\n\t"name": 42,\r\n\t"name": "duplicate"\r\n}\r\n',
	)
	const result = spawnSync(process.execPath, [entry, "check"], {
		cwd: root,
		encoding: "utf8",
	})
	expect(result.status).toBe(1)
	expect(result.stdout).toMatchInlineSnapshot(`
		"data/test.json  1 error
		  json; schema; project → schema.json
		└─ 3:2  duplicate-key
		   2 │     "name": 42,
		   3 │     "name": "duplicate"
		     │     ^^^^^^
		   4 │ }
		     ╰─ Duplicate key "name"

		────────────────────────────────────────────────────────

		▲ Check found 1 error in 1 file

		1 checked, 1 schema-covered, 0 syntax-only, 1 invalid, 0 failures
		"
	`)
	await put(root, "data/test.json", '{\n  "name":')
	const eof = spawnSync(process.execPath, [entry, "check"], {
		cwd: root,
		encoding: "utf8",
	})
	expect(eof.status).toBe(1)
	expect(eof.stdout).toMatchInlineSnapshot(`
		"data/test.json  2 errors
		  json; schema; project → schema.json
		├─ 2:10  syntax
		│  1 │ {
		│  2 │   "name":
		│    │          ^
		│    ╰─ ValueExpected
		│
		└─ 2:10  syntax
		   1 │ {
		   2 │   "name":
		     │          ^
		     ╰─ CloseBraceExpected

		────────────────────────────────────────────────────────

		▲ Check found 2 errors in 1 file

		1 checked, 1 schema-covered, 0 syntax-only, 1 invalid, 0 failures
		"
	`)
})

test("long multiline ranges show their endpoints and elide the middle", async () => {
	const { root } = await setup({ type: "string" })
	await put(
		root,
		"data/test.json",
		'{\n  "one": 1,\n  "two": 2,\n  "three": 3\n}',
	)
	const result = spawnSync(process.execPath, [entry, "check"], {
		cwd: root,
		encoding: "utf8",
	})
	expect(result.status).toBe(1)
	expect(result.stdout).toContain(
		"1 │ {\n     │ ^\n     │ …\n   5 │ }\n     │ ^",
	)
	expect(result.stdout).not.toContain('"two"')
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
	const output = readableReport(report, { cwd: root })
	expect(output).toContain("data/missing.json  1 failure\n└─ execution:")
	expect(output).toContain(
		"node_modules/ignored.json  excluded\n  json; excluded",
	)
	expect(output).toContain("▲ Check failed with 1 failure")
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
