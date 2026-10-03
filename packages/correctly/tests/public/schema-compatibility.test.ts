import type { CompletionList, Hover } from "vscode-languageserver/node"
import { expect, test } from "vite-plus/test"
import { check } from "../../src/cli/check.ts"
import { put, setup } from "./helpers.ts"
import { lspClient } from "./lsp-client.ts"

const DIALECTS = [
	"http://json-schema.org/draft-07/schema#",
	"https://json-schema.org/draft/2020-12/schema",
]

const UNSIGNED = [
	{ format: "uint8", maximum: 255, overflow: 256 },
	{ format: "uint32", maximum: 2 ** 32 - 1, overflow: 2 ** 32 },
	{ format: "uint64", maximum: 2 ** 64 - 2048, overflow: 2 ** 64 },
	{ format: "uint", maximum: Number.MAX_SAFE_INTEGER, overflow: undefined },
]

for (const $schema of DIALECTS) {
	test.each(UNSIGNED)(
		`$format accepts unsigned integers and rejects invalid values in ${$schema}`,
		async ({ format, maximum, overflow }) => {
			const { engine, file } = await setup({
				$schema,
				type: "integer",
				format,
			})
			for (const value of [0, 1, maximum])
				expect(
					await engine.validate(file, JSON.stringify(value)),
				).toMatchObject({
					diagnostics: [],
					failures: [],
				})
			for (const value of [
				-1,
				0.5,
				...(overflow === undefined ? [] : [overflow]),
			]) {
				const result = await engine.validate(file, JSON.stringify(value))
				expect(result.failures).toEqual([])
				expect(result.diagnostics).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ code: "schema/format" }),
					]),
				)
			}
			const string = await engine.validate(file, '"1"')
			expect(string.failures).toEqual([])
			expect(string.diagnostics[0]?.code).toBe("schema/type")
		},
	)
	test(`double accepts finite numbers in ${$schema}`, async () => {
		const { engine, file } = await setup({
			$schema,
			type: "number",
			format: "double",
		})
		for (const value of [-1.5, 0, 0.5, Number.MAX_VALUE])
			expect(await engine.validate(file, JSON.stringify(value))).toMatchObject({
				diagnostics: [],
				failures: [],
			})
		for (const source of ["1e400", "-1e400", '"0.5"']) {
			const result = await engine.validate(file, source)
			expect(result.failures).toEqual([])
			expect(result.diagnostics.length).toBeGreaterThan(0)
		}
	})
}

test("numeric format bounds and explicit schema bounds both apply through references", async () => {
	const { engine, file, root } = await setup({
		$ref: "limits.json#/definitions/depth",
	})
	await put(root, "limits.json", {
		definitions: {
			depth: { type: "integer", format: "uint8", minimum: 1, maximum: 25 },
		},
	})
	expect(await engine.validate(file, "2")).toMatchObject({
		diagnostics: [],
		failures: [],
	})
	for (const [source, code] of [
		["0", "schema/minimum"],
		["26", "schema/maximum"],
		["256", "schema/format"],
	]) {
		const result = await engine.validate(file, source!)
		expect(result.failures).toEqual([])
		expect(result.diagnostics.map((d) => d.code)).toContain(code)
	}
})

test.each(DIALECTS)(
	"Renovate's version annotation preserves validation and strict schema checks in %s",
	async ($schema) => {
		const { engine, file } = await setup({
			$schema,
			"x-renovate-version": "44.132.2",
			type: "object",
			required: ["enabled"],
			additionalProperties: false,
			properties: { enabled: { type: "boolean" } },
		})
		expect(await engine.validate(file, '{"enabled":true}')).toMatchObject({
			diagnostics: [],
			failures: [],
		})
		const invalid = await engine.validate(file, '{"enabled":"true","extra":1}')
		expect(invalid.failures).toEqual([])
		expect(invalid.diagnostics.map((d) => d.code)).toEqual(
			expect.arrayContaining(["schema/type", "schema/additionalProperties"]),
		)
		for (const schema of [
			{ $schema, "x-renovate-version": "44.132.2", typoKeyword: true },
			{ $schema, type: "string", format: "not-a-known-format" },
		]) {
			const unknown = await setup(schema)
			expect(
				(await unknown.engine.validate(unknown.file, "{}")).failures,
			).toMatchObject([{ code: "schema" }])
		}
	},
)

test("CLI and stdio LSP share numeric format diagnostics and retain editor hints", async () => {
	const { root, file, uri } = await setup({
		"x-renovate-version": "44.132.2",
		type: "object",
		properties: {
			limit: {
				type: "integer",
				format: "uint32",
				description: "Unsigned warning limit",
			},
		},
	})
	await put(root, "data/test.json", { limit: 1 })
	expect((await check({ cwd: root, offline: true })).exitCode).toBe(0)
	const client = await lspClient([root])
	await client.open(uri, '{"limit":1}')
	expect((await client.wait(uri, 1)).diagnostics).toEqual([])
	const invalid = '{"limit":4294967296}'
	await client.change(uri, invalid, 2)
	const editor = await client.wait(uri, 2)
	await put(root, "data/test.json", invalid)
	const cli = await check({ cwd: root, offline: true })
	expect(cli.exitCode).toBe(1)
	expect(cli.failures).toEqual([])
	const result = cli.files.find((result) => result.file === file)!
	expect(result.failures).toEqual([])
	expect(
		editor.diagnostics.map((d) => ({ code: d.code, range: d.range })),
	).toEqual(result.diagnostics.map((d) => ({ code: d.code, range: d.range })))
	expect(result.diagnostics).toMatchObject([
		{ code: "schema/format", pointer: "/limit" },
	])
	const hover = await client.request<Hover>("textDocument/hover", uri, {
		line: 0,
		character: 3,
	})
	expect(JSON.stringify(hover)).toContain("Unsigned warning limit")
	await client.change(uri, '{""}', 3)
	const completions = await client.request<CompletionList>(
		"textDocument/completion",
		uri,
		{ line: 0, character: 2 },
	)
	expect(completions.items.map((item) => item.label)).toContain("limit")
})
