import { expect, test } from "vite-plus/test"
import { check, readableReport } from "../../src/cli/check.ts"
import { lspClient } from "./lsp-client.ts"
import { put, setup } from "./helpers.ts"

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
