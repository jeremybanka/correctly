import { expect, test } from "vite-plus/test"
import { check, readableReport } from "../../src/cli/check.ts"
import { lspClient } from "./lsp-client.ts"
import { put, setup } from "./helpers.ts"

test.each([
	["draft 7 scalar items", { type: "string" }, '["x","y","x"]', '"x"'],
	["draft 7 structured items", {}, '[{"x":1},{"x":2},{"x":1}]', '{"x":1}'],
	["draft 2020-12 nested arrays", {}, "[[1],[2],[1]]", "[1]"],
] as const)(
	"uniqueItems highlights the later duplicate and names its earlier pointer: %s",
	async (name, items, values, duplicate) => {
		const schema = {
			...(name.includes("2020-12")
				? { $schema: "https://json-schema.org/draft/2020-12/schema" }
				: {}),
			type: "object",
			properties: { "a/~b": { type: "array", items, uniqueItems: true } },
		}
		const text = `{"a/~b":${values}}`
		const { core, readable, report } = await sharedResult(schema, text)
		expect(core.diagnostics).toHaveLength(1)
		const d = core.diagnostics[0]!
		expect(d).toMatchObject({
			code: "schema/uniqueItems",
			pointer: "/a~1~0b/2",
			message:
				"/a~1~0b/2: duplicates item at /a~1~0b/0; array items must be unique",
		})
		expect(text.slice(d.offset, d.offset + d.length)).toBe(duplicate)
		expect(d.offset).toBe(text.lastIndexOf(duplicate))
		expect(readable).toContain(d.message)
		expect(report.exitCode).toBe(1)
	},
)

test("unique array items still validate without a diagnostic", async () => {
	const { engine, file } = await setup({ type: "array", uniqueItems: true })
	expect(
		(await engine.validate(file, '[1,"1",{"x":1},{"x":2}]')).diagnostics,
	).toEqual([])
})

test.each([
	["false", "/choice: must match exactly one alternative; none matched"],
	[
		"5",
		"/choice: must match exactly one alternative; multiple matched (alternatives 1, 2)",
	],
])(
	"oneOf distinguishes no match from overlap for %s",
	async (value, message) => {
		const alternatives = [
			{ type: "number", minimum: 0 },
			{ type: "number", maximum: 10 },
		]
		const { core, report, readable } = await sharedResult(
			{ type: "object", properties: { choice: { oneOf: alternatives } } },
			`{"choice":${value}}`,
		)
		expect(
			core.diagnostics.find((d) => d.code === "schema/oneOf"),
		).toMatchObject({ pointer: "/choice", message })
		expect(readable).toContain(message)
		expect(report.exitCode).toBe(1)
		const { engine, file } = await setup({ oneOf: alternatives })
		expect((await engine.validate(file, "20")).diagnostics).toEqual([])
	},
)

test("referenced 2020-12 oneOf reports overlap without claiming all matching alternatives were counted", async () => {
	const { core } = await sharedResult(
		{
			$schema: "https://json-schema.org/draft/2020-12/schema",
			$ref: "choice.json",
		},
		"5",
		{
			"choice.json": {
				oneOf: [{ type: "number" }, { type: "integer" }, { minimum: 0 }],
			},
		},
	)
	expect(core.diagnostics).toMatchObject([
		{
			code: "schema/oneOf",
			message:
				"/: must match exactly one alternative; multiple matched (alternatives 1, 2)",
		},
	])
})

test.each([
	{ pattern: "^[a-z]+$" },
	{ enum: ["lowercase"] },
	{ const: "lowercase" },
])(
	"property-name reasons highlight the escaped key, not its object or value: %j",
	async (propertyNames) => {
		const text = '{\r\n  "labels": {\r\n    "A/~B": 42\r\n  }\r\n}'
		const { core, readable } = await sharedResult(
			{
				type: "object",
				properties: { labels: { type: "object", propertyNames } },
			},
			text,
		)
		expect(core.diagnostics).toHaveLength(2)
		for (const d of core.diagnostics) {
			expect(d.pointer).toBe("/labels/A~1~0B")
			expect(d.range).toEqual({
				start: { line: 2, character: 4 },
				end: { line: 2, character: 10 },
			})
			expect(text.slice(d.offset, d.offset + d.length)).toBe('"A/~B"')
		}
		expect(readable).toContain('3 │     "A/~B": 42')
	},
)

test("an empty property name still targets its key", async () => {
	const { engine, file } = await setup({
		type: "object",
		propertyNames: { minLength: 1 },
	})
	const text = '{"": 7}'
	const result = await engine.validate(file, text)
	expect(result.failures).toEqual([])
	for (const d of result.diagnostics) {
		expect(d.pointer).toBe("/")
		expect(text.slice(d.offset, d.offset + d.length)).toBe('""')
	}
})

async function sharedResult(
	schema: unknown,
	text: string,
	resources: Record<string, unknown> = {},
) {
	const { root, file, uri, engine } = await setup(schema)
	for (const [name, resource] of Object.entries(resources))
		await put(root, name, resource)
	await put(root, "data/test.json", text)
	const core = await engine.validate(file, text)
	expect(core.failures).toEqual([])
	const sources = new Map<string, string>()
	const report = await check({
		cwd: root,
		onRead: (file, source) => {
			sources.set(file, source)
		},
	})
	expect(report.files[0]?.diagnostics).toEqual(core.diagnostics)
	const client = await lspClient([root])
	await client.open(uri, text)
	const editor = await client.wait(uri, 1)
	expect(
		editor.diagnostics.map((d) => ({
			code: d.code,
			message: d.message,
			range: d.range,
			pointer: (d.data as { pointer: string }).pointer,
		})),
	).toEqual(
		core.diagnostics.map((d) => ({
			code: d.code,
			message: d.message,
			range: d.range,
			pointer: d.pointer,
		})),
	)
	return {
		core,
		report,
		editor,
		readable: readableReport(report, { cwd: root, sources, color: false }),
	}
}

test.each([
	[null, "null"],
	[false, "false"],
	[0, "0"],
	["", '""'],
	['line\n"break', '"line\\n\\"break"'],
	[{ mode: "safe" }, '{"mode":"safe"}'],
	[[1, "x"], '[1,"x"]'],
] as const)(
	"const diagnostics include the expected JSON value %j",
	async (constant, expected) => {
		const { engine, file } = await setup({ const: constant })
		const result = await engine.validate(file, '"wrong"')
		expect(result.failures).toEqual([])
		expect(result.diagnostics).toMatchObject([
			{ code: "schema/const", message: `/: must equal ${expected}` },
		])
		expect(
			(await engine.validate(file, JSON.stringify(constant))).diagnostics,
		).toEqual([])
	},
)

test.each([
	"http://json-schema.org/draft-07/schema#",
	"https://json-schema.org/draft/2020-12/schema",
])(
	"referenced const values agree across CLI and LSP in %s",
	async ($schema) => {
		const { core, readable, report } = await sharedResult(
			{ $schema, $ref: "constant.json" },
			'{"kind":"development"}',
			{
				"constant.json": {
					type: "object",
					properties: { kind: { const: "production" } },
				},
			},
		)
		expect(core.diagnostics[0]).toMatchObject({
			pointer: "/kind",
			message: '/kind: must equal "production"',
		})
		expect(readable).toContain('/kind: must equal "production"')
		expect(report.exitCode).toBe(1)
	},
)
