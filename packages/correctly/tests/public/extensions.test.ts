import path from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "vite-plus/test"
import {
	Engine,
	defineConfig,
	json,
	type ProjectConfig,
} from "../../src/core/index.ts"
import { ajv, type SchemaExtension } from "../../src/validators/ajv.ts"
import { schemars } from "../../src/extensions/schemars.ts"
import { renovate } from "../../src/extensions/renovate.ts"
import { check } from "../../src/cli/check.ts"
import { readableReport } from "../../src/cli/readable.ts"
import { configSource, setup, put } from "./helpers.ts"
import { lspClient } from "./lsp-client.ts"

const uint = { type: "integer", format: "uint16" }
const extension = () => schemars({ version: "0.8.22" })
function config(extensions: SchemaExtension[] = []): ProjectConfig {
	return defineConfig({
		associations: [
			{
				files: ["data/**"],
				parse: json(),
				validate: ajv({ schema: "schema.json", extensions }),
			},
		],
	})
}
async function configured(schema: unknown, extensions: SchemaExtension[] = []) {
	const result = await setup(schema)
	result.project.config = config(extensions)
	return { ...result, engine: new Engine(result.project) }
}

test.each([false, true])(
	"same URI has isolated extension implementations (enabled first: %s)",
	async (enabledFirst) => {
		const { project, root } = await setup(uint)
		project.config = defineConfig({
			associations: [
				{
					files: ["data/enabled.json"],
					validate: ajv({ schema: "schema.json", extensions: [extension()] }),
				},
				{
					files: ["data/plain.json"],
					validate: ajv({ schema: "schema.json" }),
				},
			],
		})
		const engine = new Engine(project)
		for (const enabled of enabledFirst
			? [true, false, true]
			: [false, true, false]) {
			const result = await engine.validate(
				path.join(root, enabled ? "data/enabled.json" : "data/plain.json"),
				"1",
			)
			expect(result.diagnostics).toEqual([])
			expect(result.failures).toMatchObject(
				enabled
					? []
					: [
							{
								code: "extension-required",
								details: {
									format: "uint16",
									suggestedExtension: "schemars@0.8.22",
								},
							},
						],
			)
		}
	},
)

test("last matching association selects its complete parser and validator", async () => {
	const { project, file } = await configured(uint, [extension()])
	project.config.associations.push({
		files: ["data/test.json"],
		validate: ajv({ schema: "schema.json" }),
	})
	expect(
		(await new Engine(project).validate(file, "1")).failures[0]?.code,
	).toBe("extension-required")
})

test.each(["child.json", "https://example.test/child"])(
	"extension scope follows references to %s",
	async (ref) => {
		const { project, root, file } = await configured(
			{ $ref: `${ref}#/definitions/a~1b~0c` },
			[extension()],
		)
		await put(root, "child.json", {
			$id: "https://example.test/child",
			definitions: { "a/b~c": uint },
		})
		project.config.associations.push({
			files: ["unused/**"],
			validate: ajv({ schema: "child.json", extensions: [extension()] }),
		})
		const engine = new Engine(project)
		expect(await engine.validate(file, "1")).toMatchObject({
			failures: [],
			diagnostics: [],
		})
		expect((await engine.validate(file, "65536")).diagnostics[0]?.code).toBe(
			"schema/format",
		)
		project.config.associations[0]!.validate = ajv({ schema: "schema.json" })
		expect(
			(await new Engine(project).validate(file, "1")).failures,
		).toMatchObject([
			{
				code: "extension-required",
				details: {
					schemaUri: pathToFileURL(path.join(root, "child.json")).href,
					schemaPointer: "/definitions/a~1b~0c/format",
				},
			},
		])
	},
)

test("missing and annotation-only formats give actionable CLI and JSON failures", async () => {
	for (const format of [
		"uint16",
		"int32",
		"int64",
		"float",
		"double",
		"company-id",
		"password",
		"binary",
	]) {
		const { root } = await setup({ type: "string", format })
		await put(root, "data/test.json", '"value"')
		const report = await check({ cwd: root })
		expect(report.exitCode).toBe(2)
		expect(report.failures).toMatchObject([
			{
				code: "extension-required",
				details: { format, schemaPointer: "/format" },
			},
		])
		const output = readableReport(report, { cwd: root, color: false })
		expect(output).toContain(
			"extension-required: This schema needs an extension.",
		)
		expect(output).toContain(
			`│ Format ${JSON.stringify(format)} has no enabled validator; validation cannot proceed.`,
		)
		expect(output).toContain(
			["uint16", "int32", "int64", "float", "double"].includes(format)
				? 'schemars({ version: "0.8.22" })'
				: "Pass an extension implementing",
		)
		expect(output).toContain("correctly.config.ts")
	}
})

test("schema positions are inspected while defaults, enums, and examples stay opaque", async () => {
	const { engine, file } = await setup({
		type: "object",
		default: { format: "not-a-format" },
		examples: [{ format: "not-a-format" }],
		const: { format: "not-a-format" },
	})
	expect(
		await engine.validate(file, '{"format":"not-a-format"}'),
	).toMatchObject({ failures: [], diagnostics: [] })
	const unused = await setup({
		definitions: { unused: { format: "not-a-format" } },
	})
	await expect(unused.engine.prepare()).rejects.toMatchObject({
		code: "extension-required",
		details: { schemaPointer: "/definitions/unused/format" },
	})
})

test("imported implementations assert values and preserve strict schema checks", async () => {
	const schema = { type: "string", format: "even-length", "x-origin": "test" }
	const extension: SchemaExtension = {
		id: "test@1",
		formats: {
			"even-length": {
				type: "string",
				validate: (value) => value.length % 2 === 0,
			},
		},
		annotations: ["x-origin"],
	}
	const { engine, file } = await configured(schema, [extension])
	expect(await engine.validate(file, '"ab"')).toMatchObject({
		failures: [],
		diagnostics: [],
	})
	expect((await engine.validate(file, '"a"')).diagnostics[0]?.code).toBe(
		"schema/format",
	)
	const missing = await configured(schema)
	expect(
		(await missing.engine.validate(missing.file, '"ab"')).failures[0]?.code,
	).toBe("extension-required")
	const typo = await configured(
		{ type: "string", format: "email", typoKeyword: true },
		[extension],
	)
	expect(
		(await typo.engine.validate(typo.file, '"x@example.com"')).failures[0]
			?.code,
	).toBe("schema")
})

test("version selection is exact and extension identifiers cannot replace implementations", async () => {
	for (const version of ["0.8", "^0.8.22", "1.2.2"])
		expect(() => schemars({ version: version as "0.8.22" })).toThrow(
			"Unsupported Schemars version",
		)
	await expect(
		configured(uint, ["schemars@0.8.22" as unknown as SchemaExtension]),
	).rejects.toMatchObject({ code: "config" })
})

test("duplicate identities, conflicts, and async implementations fail visibly", async () => {
	const definitions: SchemaExtension[][] = [
		[extension(), extension()],
		[
			extension(),
			{
				id: "custom",
				formats: { uint16: { type: "number", validate: () => true } },
			},
		],
		[{ id: "custom", annotations: ["type"] }],
		[
			{
				id: "custom",
				formats: {
					custom: {
						async: true,
						validate: async () => true,
					} as unknown as NonNullable<SchemaExtension["formats"]>[string],
				},
			},
		],
	]
	for (const extensions of definitions) {
		const { engine } = await configured({}, extensions)
		await expect(engine.prepare()).rejects.toMatchObject({ code: "extension" })
	}
})

test("Renovate metadata is independently opted into", async () => {
	const schema = {
		"x-renovate-version": "44.132.2",
		type: "integer",
		minimum: 1,
	}
	const plain = await configured(schema)
	expect((await plain.engine.validate(plain.file, "1")).failures[0]?.code).toBe(
		"schema",
	)
	const enabled = await configured(schema, [renovate()])
	expect(await enabled.engine.validate(enabled.file, "1")).toMatchObject({
		failures: [],
		diagnostics: [],
	})
	expect(
		(await enabled.engine.validate(enabled.file, "0")).diagnostics[0]?.code,
	).toBe("schema/minimum")
})

test("LSP displays extension guidance and applies a saved config's imported implementation", async () => {
	const { root, uri, configPath } = await setup({
		type: "object",
		properties: { limit: { ...uint, description: "Configured limit" } },
	})
	const client = await lspClient([root])
	await client.open(uri, '{"limit":1}')
	expect((await client.wait(uri, 1)).diagnostics[0]?.message).toContain(
		'schemars({ version: "0.8.22" })',
	)
	const source = configSource({
		files: ["data/**"],
		associations: [
			{
				files: ["data/**"],
				schema: "schema.json",
				extensions: ["schemars@0.8.22"],
			},
		],
	})
	await put(root, "correctly.config.ts", source)
	const count = client.notifications.length
	await client.connection.sendNotification("workspace/didChangeWatchedFiles", {
		changes: [{ uri: pathToFileURL(configPath).href, type: 2 }],
	})
	expect((await client.wait(uri, 1, count)).diagnostics).toEqual([])
	expect(
		JSON.stringify(
			await client.request("textDocument/hover", uri, {
				line: 0,
				character: 3,
			}),
		),
	).toContain("Configured limit")
})

test("external and embedded references retain the source URI and pointer", async () => {
	const remote = await setup({ $ref: "https://example.test/schema.json" })
	const engine = new Engine(remote.project, {
		fetch: async () =>
			new Response(JSON.stringify({ type: "string", format: "company-id" })),
	})
	expect(
		(await engine.validate(remote.file, '"value"')).failures,
	).toMatchObject([
		{
			code: "extension-required",
			details: {
				schemaUri: "https://example.test/schema.json",
				schemaPointer: "/format",
			},
		},
	])
	const local = await setup({ $ref: "https://example.test/embedded" })
	await put(local.root, "container.json", {
		definitions: { child: { $id: "https://example.test/embedded", ...uint } },
	})
	local.project.config.associations.push({
		files: ["unused/**"],
		validate: ajv({ schema: "container.json", extensions: [extension()] }),
	})
	expect(
		(await new Engine(local.project).validate(local.file, "1")).failures,
	).toMatchObject([
		{
			code: "extension-required",
			details: {
				schemaUri: pathToFileURL(path.join(local.root, "container.json")).href,
				schemaPointer: "/definitions/child/format",
			},
		},
	])
})

test("a truthy non-boolean assertion cannot silently pass", async () => {
	const validate = (() => ({ valid: false })) as unknown as (
		value: string,
	) => boolean
	const { engine, file } = await configured(
		{ type: "string", format: "custom" },
		[{ id: "custom", formats: { custom: { type: "string", validate } } }],
	)
	expect((await engine.validate(file, '"value"')).failures).toMatchObject([
		{ code: "extension", message: expect.stringContaining("non-boolean") },
	])
})
