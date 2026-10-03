import path from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "vite-plus/test"
import {
	Engine,
	loadProject,
	type ProjectConfig,
	type SchemaExtension,
} from "../../src/core/index.ts"
import { check } from "../../src/cli/check.ts"
import { readableReport } from "../../src/cli/readable.ts"
import { setup, put } from "./helpers.ts"
import { lspClient } from "./lsp-client.ts"

const schemars = "schemars@0.8.22"
const uint = { type: "integer", format: "uint16" }
const config = (extensions: string[] = []): ProjectConfig => ({
	associations: [{ files: ["data/**"], schema: "schema.json", extensions }],
})

test.each([false, true])(
	"same URI has isolated validators with and without extensions (enabled first: %s)",
	async (enabledFirst) => {
		const { engine, root } = await setup(uint, {
			associations: [
				{
					files: ["data/enabled.json"],
					schema: "schema.json",
					extensions: [schemars],
				},
				{ files: ["data/plain.json"], schema: "schema.json" },
			],
		})
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
								details: { format: "uint16", suggestedExtension: schemars },
							},
						],
			)
		}
	},
)

test("extension choices follow the winning association without merging", async () => {
	const { engine, file } = await setup(uint, {
		associations: [
			{ files: ["data/**"], schema: "schema.json", extensions: [schemars] },
			{ files: ["data/test.json"], schema: "schema.json" },
		],
	})
	expect((await engine.validate(file, "1")).failures[0]?.code).toBe(
		"extension-required",
	)
})

test.each(["child.json", "https://example.test/child"])(
	"extensions apply through references to %s and report escaped schema pointers",
	async (ref) => {
		const project = await setup(
			{ $ref: `${ref}#/definitions/a~1b~0c` },
			config([schemars]),
		)
		const child = {
			$id: "https://example.test/child",
			definitions: { "a/b~c": uint },
		}
		await put(project.root, "child.json", child)
		if (ref.startsWith("https:")) {
			// Preloaded IDs use the same policy as resources loaded on demand.
			await project.engine.store.load(
				pathToFileURL(path.join(project.root, "child.json")).href,
			)
		}
		expect(await project.engine.validate(project.file, "1")).toMatchObject({
			failures: [],
			diagnostics: [],
		})
		expect(
			(await project.engine.validate(project.file, "65536")).diagnostics[0]
				?.code,
		).toBe("schema/format")
		project.project.config.associations[0]!.extensions = []
		const failure = (await project.engine.validate(project.file, "1"))
			.failures[0]!
		expect(failure).toMatchObject({
			code: "extension-required",
			details: {
				schemaUri: pathToFileURL(path.join(project.root, "child.json")).href,
				schemaPointer: "/definitions/a~1b~0c/format",
				format: "uint16",
			},
		})
	},
)

test("unknown and annotation-only formats stop validation with actionable JSON and readable output", async () => {
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
				? 'Add "schemars@0.8.22" to "extensions"'
				: "Enable an extension that validates",
		)
		expect(output).not.toContain("Cannot compile schema")
	}
})

test("format assertions inspect schema positions, including unused definitions, but leave data opaque", async () => {
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

test("registered extensions remain opt-in, and enforce assertions without weakening strict schema checks", async () => {
	const schema = { type: "string", format: "even-length", "x-origin": "test" }
	const project = await setup(schema, config(["test@1"]))
	const extension: SchemaExtension = {
		id: "test@1",
		formats: {
			"even-length": {
				type: "string",
				validate: (value: string) => value.length % 2 === 0,
			},
		},
		annotations: ["x-origin"],
	}
	const engine = new Engine(project.project, { extensions: [extension] })
	expect(await engine.validate(project.file, '"ab"')).toMatchObject({
		diagnostics: [],
		failures: [],
	})
	expect(
		(await engine.validate(project.file, '"a"')).diagnostics[0]?.code,
	).toBe("schema/format")
	project.project.config.associations[0]!.extensions = []
	expect(
		(await engine.validate(project.file, '"ab"')).failures[0],
	).toMatchObject({
		code: "extension-required",
		details: { suggestedExtension: "test@1" },
	})
	const typo = await setup(
		{ type: "string", format: "email", typoKeyword: true },
		config([schemars]),
	)
	expect(
		(await typo.engine.validate(typo.file, '"person@example.com"')).failures[0]
			?.code,
	).toBe("schema")
})

test.each(["schemars", "schemars@1.2.2", "misspelled"])(
	"unknown extension %s is a configuration failure even on an unused association",
	async (id) => {
		const { engine } = await setup({}, config([id]))
		await expect(engine.prepare()).rejects.toMatchObject({
			code: "extension",
			message: expect.stringContaining(`Unknown extension "${id}"`),
		})
	},
)

test("duplicate identifiers, conflicting implementations, async validators, and annotation overrides fail clearly", async () => {
	const definitions: SchemaExtension[][] = [
		[{ id: schemars }],
		[
			{
				id: "test@1",
				formats: { uint16: { type: "number", validate: () => true } },
			},
		],
		[{ id: "test@1", annotations: ["type"] }],
		[
			{
				id: "test@1",
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
		const { project } = await setup(
			{},
			config([schemars, ...(extensions[0]!.id === schemars ? [] : ["test@1"])]),
		)
		await expect(
			new Engine(project, { extensions }).prepare(),
		).rejects.toMatchObject({ code: "extension" })
	}
})

test("configuration rejects duplicate extension entries and extensions on syntax-only rules", async () => {
	for (const association of [
		{
			files: ["data/**"],
			schema: "schema.json",
			extensions: [schemars, schemars],
		},
		{ files: ["data/**"], schema: null, extensions: [schemars] },
	]) {
		const { root } = await setup()
		const file = await put(root, "invalid.config.json", {
			associations: [association],
		})
		await expect(loadProject(file)).rejects.toMatchObject({ code: "config" })
	}
})

test("Renovate's annotation is an independent opt-in extension", async () => {
	const schema = {
		"x-renovate-version": "44.132.2",
		type: "integer",
		minimum: 1,
	}
	const plain = await setup(schema)
	expect((await plain.engine.validate(plain.file, "1")).failures[0]?.code).toBe(
		"schema",
	)
	const enabled = await setup(schema, config(["renovate"]))
	expect(await enabled.engine.validate(enabled.file, "1")).toMatchObject({
		failures: [],
		diagnostics: [],
	})
	expect(
		(await enabled.engine.validate(enabled.file, "0")).diagnostics[0]?.code,
	).toBe("schema/minimum")
})

test("LSP explains missing extensions and refreshes diagnostics and hints after an unsaved opt-in", async () => {
	const { root, uri, configPath } = await setup(
		{
			type: "object",
			properties: { limit: { ...uint, description: "Configured limit" } },
		},
		config(),
	)
	const client = await lspClient([root])
	await client.open(uri, '{"limit":1}')
	const missing = await client.wait(uri, 1)
	expect(missing.diagnostics).toMatchObject([
		{
			code: "extension-required",
			message: expect.stringContaining('Add "schemars@0.8.22" to "extensions"'),
		},
	])
	const count = client.notifications.length
	await client.open(
		pathToFileURL(configPath).href,
		JSON.stringify(config([schemars])),
	)
	expect((await client.wait(uri, 1, count)).diagnostics).toEqual([])
	const hover = await client.request("textDocument/hover", uri, {
		line: 0,
		character: 3,
	})
	expect(JSON.stringify(hover)).toContain("Configured limit")
	const changed = client.notifications.length
	await client.change(
		pathToFileURL(configPath).href,
		JSON.stringify(config()),
		2,
	)
	expect((await client.wait(uri, 1, changed)).diagnostics[0]?.code).toBe(
		"extension-required",
	)
})

test("a fetched reference requires an assertion and keeps its own source URI", async () => {
	const { project, file } = await setup({
		$ref: "https://example.test/schema.json",
	})
	const engine = new Engine(project, {
		fetch: async () =>
			new Response(JSON.stringify({ type: "string", format: "company-id" })),
	})
	expect((await engine.validate(file, '"value"')).failures).toMatchObject([
		{
			code: "extension-required",
			details: {
				schemaUri: "https://example.test/schema.json",
				schemaPointer: "/format",
			},
		},
	])
})

test("embedded schema identifiers retain pointers in the retrieved resource", async () => {
	const { project, root, file } = await setup({
		$ref: "https://example.test/embedded",
	})
	await put(root, "container.json", {
		definitions: { child: { $id: "https://example.test/embedded", ...uint } },
	})
	const engine = new Engine(project)
	await engine.store.load(pathToFileURL(path.join(root, "container.json")).href)
	expect((await engine.validate(file, "1")).failures).toMatchObject([
		{
			code: "extension-required",
			details: {
				schemaUri: pathToFileURL(path.join(root, "container.json")).href,
				schemaPointer: "/definitions/child/format",
			},
		},
	])
})

test("a misbehaving custom validator cannot pass through a truthy non-boolean result", async () => {
	const { project, file } = await setup(
		{ type: "string", format: "custom" },
		config(["custom@1"]),
	)
	const validate = (() => ({ valid: false })) as unknown as (
		value: string,
	) => boolean
	const engine = new Engine(project, {
		extensions: [
			{ id: "custom@1", formats: { custom: { type: "string", validate } } },
		],
	})
	expect((await engine.validate(file, '"value"')).failures).toMatchObject([
		{ code: "extension", message: expect.stringContaining("non-boolean") },
	])
})
