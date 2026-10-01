import { expect, test } from "vite-plus/test"
import { check, readableReport } from "../../src/cli/check.ts"
import {
	diagnosticDetails,
	diagnosticViews,
} from "../../src/core/diagnostics.ts"
import { lspClient } from "./lsp-client.ts"
import { put, setup } from "./helpers.ts"

async function grouped(
	schema: unknown,
	text: string,
	resources: Record<string, unknown> = {},
) {
	const { root, uri } = await setup(schema)
	for (const [name, schema] of Object.entries(resources))
		await put(root, name, schema)
	await put(root, "data/test.json", text)
	const sources = new Map<string, string>()
	const report = await check({
		cwd: root,
		onRead: (file, source) => {
			sources.set(file, source)
		},
	})
	expect(report.failures).toEqual([])
	expect(report.exitCode).toBe(1)
	const diagnostics = report.files[0]!.diagnostics
	const views = diagnosticViews(diagnostics)
	const serialized = JSON.stringify(report)
	const readable = readableReport(report, { cwd: root, sources, color: false })
	expect(JSON.stringify(report)).toBe(serialized)
	const client = await lspClient([root])
	await client.open(uri, text)
	const editor = await client.wait(uri, 1)
	expect(
		editor.diagnostics.map((d) => ({
			code: d.code,
			message: d.message,
			range: d.range,
		})),
	).toEqual(
		views.map((d) => ({ code: d.code, message: d.message, range: d.range })),
	)
	for (const [index, view] of views.entries()) {
		const details = diagnosticDetails(view)
		expect(editor.diagnostics[index]?.relatedInformation ?? []).toEqual(
			details.map(({ label, diagnostic }) => ({
				location: { uri, range: diagnostic.range },
				message: `${label}: ${diagnostic.message}`,
			})),
		)
	}
	return { diagnostics, views, readable, editor }
}

test.each([
	"http://json-schema.org/draft-07/schema#",
	"https://json-schema.org/draft/2020-12/schema",
])(
	"anyOf groups branch reasons without dropping the JSON diagnostics in %s",
	async ($schema) => {
		const { diagnostics, views, readable, editor } = await grouped(
			{ $schema, anyOf: [{ type: "string" }, { type: "number" }] },
			"false",
		)
		expect(diagnostics).toHaveLength(3)
		expect(diagnostics.slice(0, 2).map((d) => d.context)).toEqual([
			{ parent: 2, label: "Alternative 1" },
			{ parent: 2, label: "Alternative 2" },
		])
		expect(views).toHaveLength(1)
		expect(views[0]?.message).toBe(
			"/: must match at least one alternative; none matched",
		)
		expect(readable).toContain("data/test.json  1 error")
		expect(readable).toContain("Alternative 1")
		expect(readable).toContain("Alternative 2")
		expect(
			editor.diagnostics[0]?.relatedInformation?.map((d) => d.message),
		).toEqual([
			"Alternative 1: /: must be string",
			"Alternative 2: /: must be number",
		])
	},
)

test("nested alternatives keep their hierarchy and unrelated sibling errors remain separate", async () => {
	const schema = {
		type: "object",
		properties: {
			choice: {
				anyOf: [
					{ oneOf: [{ type: "string" }, { type: "number" }] },
					{ const: true },
				],
			},
			other: { type: "number" },
		},
	}
	const { diagnostics, views, readable } = await grouped(
		schema,
		'{"choice":false,"other":"bad"}',
	)
	expect(diagnostics).toHaveLength(6)
	expect(views).toHaveLength(2)
	expect(views.map((d) => d.pointer)).toEqual(["/choice", "/other"])
	expect(views[0]?.branches[0]?.diagnostics[0]?.code).toBe("schema/oneOf")
	expect(
		views[0]?.branches[0]?.diagnostics[0]?.branches.map((b) => b.label),
	).toEqual(["Alternative 1", "Alternative 2"])
	expect(readable).toContain("data/test.json  2 errors")
	expect(readable).toContain("/other: must be number")
	expect(readable).toMatchInlineSnapshot(`
		"data/test.json  2 errors  ·  JSON against project (schema.json)
		├─ 1:11  schema/anyOf
		│  1 │ {"choice":false,"other":"bad"}
		│    │           ^^^^^
		│    ╰─ /choice: must match at least one alternative; none matched
		│    ├─ Alternative 1
		│    │  └─ 1:11  schema/oneOf
		│    │       ╰─ /choice: must match exactly one alternative; none matched
		│    │       ├─ Alternative 1
		│    │       │  └─ 1:11  schema/type
		│    │       │       ╰─ /choice: must be string
		│    │       └─ Alternative 2
		│    │          └─ 1:11  schema/type
		│    │               ╰─ /choice: must be number
		│    └─ Alternative 2
		│       └─ 1:11  schema/const
		│            ╰─ /choice: must equal true
		│
		└─ 1:25  schema/type
		   1 │ {"choice":false,"other":"bad"}
		     │                         ^^^^^
		     ╰─ /other: must be number

		────────────────────────────────────────────────────────

		▲ Check found 2 errors in 1 file

		1 checked, 1 schema-covered, 0 syntax-only, 1 invalid, 0 failures"
	`)
})

test.each([
	["number", '"wrong"', "Then branch", "then", "schema/type"],
	["other", '"wrong"', "Else branch", "else", "schema/const"],
] as const)(
	"conditional errors explain the selected branch for kind %s",
	async (kind, value, label, keyword, reason) => {
		const schema = {
			type: "object",
			if: { properties: { kind: { const: "number" } }, required: ["kind"] },
			// oxlint-disable-next-line unicorn/no-thenable -- This is a JSON Schema keyword.
			then: { properties: { value: { type: "number" } } },
			else: { properties: { value: { const: "fallback" } } },
		}
		const { diagnostics, views, readable } = await grouped(
			schema,
			`{"kind":"${kind}","value":${value}}`,
		)
		expect(diagnostics).toHaveLength(2)
		expect(views).toHaveLength(1)
		expect(views[0]?.message).toBe(
			`/: must satisfy the ${keyword} branch of the conditional schema`,
		)
		expect(views[0]?.branches[0]?.label).toBe(label)
		expect(views[0]?.branches[0]?.diagnostics[0]?.code).toBe(reason)
		expect(readable).toContain(label)
	},
)

test("repeated array schemas do not mix reasons from different items", async () => {
	const { views } = await grouped(
		{
			type: "array",
			items: { anyOf: [{ type: "string" }, { type: "number" }] },
		},
		"[false,true]",
	)
	expect(views.map((d) => d.pointer)).toEqual(["/0", "/1"])
	for (const [index, view] of views.entries())
		expect(diagnosticDetails(view).map((d) => d.diagnostic.pointer)).toEqual([
			`/${index}`,
			`/${index}`,
		])
})

test("allOf constraints with the same instance path keep their separate alternatives", async () => {
	const { views } = await grouped(
		{
			allOf: [
				{ anyOf: [{ type: "string" }, { type: "number" }] },
				{ anyOf: [{ type: "boolean" }, { type: "null" }] },
			],
		},
		"{}",
	)
	expect(views).toHaveLength(2)
	expect(diagnosticDetails(views[0]!).map((d) => d.diagnostic.message)).toEqual(
		["/: must be string", "/: must be number"],
	)
	expect(diagnosticDetails(views[1]!).map((d) => d.diagnostic.message)).toEqual(
		["/: must be boolean", "/: must be null"],
	)
})

test("a referenced complete alternative schema retains its branch grouping", async () => {
	const { views } = await grouped({ $ref: "choice.json" }, "false", {
		"choice.json": { anyOf: [{ type: "string" }, { type: "number" }] },
	})
	expect(views).toHaveLength(1)
	expect(views[0]?.branches.map((b) => b.label)).toEqual([
		"Alternative 1",
		"Alternative 2",
	])
})

test("reference errors with lost caller provenance stay visible without a guessed branch", async () => {
	const { diagnostics, views, readable } = await grouped(
		{ anyOf: [{ $ref: "value.json" }, { type: "number" }] },
		"false",
		{ "value.json": { type: "string" } },
	)
	expect(diagnostics).toHaveLength(3)
	expect(diagnostics[0]?.context).toBeUndefined()
	expect(views).toHaveLength(2)
	expect(views[0]?.message).toBe("/: must be string")
	expect(readable).toContain("/: must be string")
	expect(readable).toContain("Alternative 2")
})

test("invalid context metadata cannot hide diagnostics or create cycles", () => {
	const base = {
		code: "schema/type",
		message: "must be string",
		pointer: "",
		offset: 0,
		length: 1,
		range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
	}
	expect(
		diagnosticViews([
			{ ...base, context: { parent: 0, label: "self" } },
			{ ...base, context: { parent: 100, label: "missing" } },
		]),
	).toHaveLength(2)
})
