import path from "node:path"
import { describe, expect, test } from "vite-plus/test"
import {
	associationFor,
	discoverConfig,
	loadProject,
} from "../../src/core/config.ts"
import { Engine } from "../../src/core/engine.ts"
import { parseDocument } from "../../src/core/parse.ts"
import { put, setup, temp, sampleSchema } from "./helpers.ts"

describe("parsing and diagnostics", () => {
	test("JSONC accepts comments and trailing commas; strict JSON rejects both", () => {
		const text = '{/* comment */ "name": "test",}'
		expect(parseDocument(text, "jsonc").diagnostics).toEqual([])
		expect(parseDocument(text, "json").diagnostics.length).toBeGreaterThan(0)
	})
	test("duplicate keys include escaped pointers and the second key's range", () => {
		const parsed = parseDocument('{"a/b":{"x~y":1,\r\n"x~y":2}}', "json")
		expect(parsed.diagnostics).toMatchObject([
			{
				code: "duplicate-key",
				pointer: "/a~1b/x~0y",
				range: { start: { line: 1, character: 0 } },
			},
		])
	})
	test("schema errors point to values, disallowed keys, and the containing object for required properties", async () => {
		const { engine, file } = await setup()
		const result = await engine.validate(
			file,
			'{\n  "color": "green",\n  "extra": true\n}',
		)
		expect(result.failures).toEqual([])
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "schema/required",
					pointer: "/name",
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 1 },
					},
				}),
				expect.objectContaining({
					code: "schema/additionalProperties",
					pointer: "/extra",
					range: {
						start: { line: 2, character: 2 },
						end: { line: 2, character: 9 },
					},
				}),
				expect.objectContaining({
					code: "schema/enum",
					pointer: "/color",
					range: {
						start: { line: 1, character: 11 },
						end: { line: 1, character: 18 },
					},
				}),
			]),
		)
	})
	test("values, defaults and additional properties are never mutated", async () => {
		const { engine } = await setup({
			type: "object",
			required: ["name"],
			additionalProperties: false,
			properties: {
				name: { type: "string", default: "x" },
				count: { type: "number" },
			},
		})
		const validate = await engine.validator(
			new URL("schema.json", `file://${engine.project.root}/`).href,
		)
		const value = { count: "2", extra: true }
		expect(validate(value)).toBe(false)
		expect(value).toEqual({ count: "2", extra: true })
		expect(validate.errors?.map((e) => e.keyword)).toEqual(
			expect.arrayContaining(["required", "additionalProperties", "type"]),
		)
	})
	test("embedded $schema stays ordinary data and never selects a schema", async () => {
		const { engine, file } = await setup()
		const result = await engine.validate(
			file,
			'{"name":"ok","$schema":"https://invalid.example/schema"}',
		)
		expect(result.failures).toEqual([])
		expect(result.diagnostics).toMatchObject([
			{ code: "schema/additionalProperties", pointer: "/$schema" },
		])
	})
	test("syntax errors skip value validation, while missing schemas still fail", async () => {
		const { engine, file } = await setup()
		expect(
			(await engine.validate(file, '{"name":')).diagnostics.every(
				(d) => d.code === "syntax",
			),
		).toBe(true)
		const broken = await setup(sampleSchema, {
			files: ["data/**"],
			associations: [{ files: ["data/**"], schema: "missing.json" }],
		})
		const result = await broken.engine.validate(broken.file, "{")
		expect(result.diagnostics[0]?.code).toBe("syntax")
		expect(result.failures[0]?.code).toBe("schema-load")
	})
})

describe("configuration", () => {
	test("last association wins, explicit null makes syntax-only coverage", async () => {
		const { engine, file } = await setup(sampleSchema, {
			files: ["data/**"],
			associations: [
				{ name: "base", files: ["data/**"], schema: "schema.json" },
				{
					name: "syntax",
					files: ["data/test.json"],
					schema: null,
					mode: "jsonc",
				},
			],
		})
		expect(associationFor(engine.project, file)).toMatchObject({
			index: 1,
			name: "syntax",
			schema: null,
			mode: "jsonc",
		})
		expect(
			await engine.validate(file, '{/*c*/"whatever":true,}'),
		).toMatchObject({ coverage: "syntax-only", diagnostics: [], failures: [] })
	})
	test("unassociated files have visible syntax-only coverage", async () => {
		const { engine, root } = await setup(sampleSchema, { associations: [] })
		expect(
			await engine.validate(
				path.join(root, "other.json"),
				'{"$schema":"https://invalid.example"}',
			),
		).toMatchObject({
			association: null,
			coverage: "syntax-only",
			diagnostics: [],
			failures: [],
		})
	})
	test("exclusions and paths outside a project are skipped", async () => {
		const { engine, root } = await setup(sampleSchema, {
			exclude: ["ignored/**"],
			associations: [],
		})
		for (const file of [
			path.join(root, "node_modules/bad.json"),
			path.join(root, ".git/bad.json"),
			path.join(root, "ignored/bad.json"),
			path.join(root, "../outside.json"),
		])
			expect((await engine.validate(file, "{")).coverage).toBe("excluded")
	})
	test.each([
		'{"associations":[],"associations":[]}',
		'{"associations":[],"typo":true}',
		'{"associations":[],"files":["../*.json"]}',
		'{"associations":[],"files":["!test.json"]}',
		'{"associations":[{"files":["**/*"],"schema":"x","mode":"yaml"}]}',
	])("rejects invalid config: %s", async (text) => {
		const root = await temp()
		await expect(
			loadProject(await put(root, "correctly.config.json", text)),
		).rejects.toMatchObject({ code: "config" })
	})
	test("nearest config discovery stops at workspace boundary", async () => {
		const root = await temp()
		await put(root, "correctly.config.json", { associations: [] })
		await put(root, "nested/correctly.config.json", { associations: [] })
		expect(await discoverConfig(path.join(root, "nested/deep"), root)).toBe(
			path.join(root, "nested/correctly.config.json"),
		)
		await expect(
			discoverConfig(path.join(root, "other"), path.join(root, "other")),
		).rejects.toMatchObject({ code: "config" })
	})
})

describe("schemas and references", () => {
	test("draft 7 relative local refs and pointer fragments", async () => {
		const { engine, root, file } = await setup({
			$ref: "defs.json#/definitions/name",
		})
		await put(root, "defs.json", { definitions: { name: { type: "string" } } })
		expect((await engine.validate(file, '"valid"')).diagnostics).toEqual([])
		expect((await engine.validate(file, "42")).diagnostics[0]?.code).toBe(
			"schema/type",
		)
	})
	test("association fragments resolve against the complete schema resource", async () => {
		const { engine, file } = await setup(
			{ definitions: { item: { type: "integer" } } },
			{
				files: ["data/**"],
				associations: [
					{ files: ["data/**"], schema: "schema.json#/definitions/item" },
				],
			},
		)
		expect(await engine.validate(file, "1")).toMatchObject({
			diagnostics: [],
			failures: [],
		})
		expect((await engine.validate(file, '"1"')).diagnostics[0]?.code).toBe(
			"schema/type",
		)
	})
	test("relative identifiers and nested resources establish reference bases", async () => {
		const { engine, root, file } = await setup({
			$id: "schemas/root.json",
			$ref: "defs.json#name",
		})
		await put(root, "schemas/defs.json", {
			$schema: "https://json-schema.org/draft/2020-12/schema",
			$anchor: "name",
			type: "string",
		})
		// Mixed drafts fail explicitly, rather than accepting a draft-specific anchor accidentally.
		expect((await engine.validate(file, '"x"')).failures[0]?.code).toBe(
			"unsupported-dialect",
		)
		const proper = await setup({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			$id: "schemas/root.json",
			$ref: "defs.json#name",
		})
		await put(proper.root, "schemas/defs.json", {
			$anchor: "name",
			type: "string",
		})
		expect(await proper.engine.validate(proper.file, '"x"')).toMatchObject({
			failures: [],
			diagnostics: [],
		})
	})
	test("draft 2020-12 prefixItems and unevaluatedProperties are authoritative", async () => {
		const { engine, file } = await setup({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			type: "object",
			properties: {
				tuple: {
					type: "array",
					prefixItems: [{ type: "string" }],
					items: false,
				},
			},
			unevaluatedProperties: false,
		})
		expect(await engine.validate(file, '{"tuple":["x"]}')).toMatchObject({
			failures: [],
			diagnostics: [],
		})
		expect(
			(await engine.validate(file, '{"tuple":[2],"extra":1}')).diagnostics.map(
				(d) => d.code,
			),
		).toEqual(
			expect.arrayContaining(["schema/type", "schema/unevaluatedProperties"]),
		)
	})
	test("draft 2020-12 dynamic references validate recursive data", async () => {
		const { engine, file } = await setup({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			$dynamicAnchor: "node",
			type: "object",
			properties: {
				value: { type: "string" },
				child: { $dynamicRef: "#node" },
			},
		})
		expect(
			await engine.validate(file, '{"child":{"value":"ok"}}'),
		).toMatchObject({ failures: [], diagnostics: [] })
		expect(
			(await engine.validate(file, '{"child":{"value":2}}')).diagnostics[0]
				?.pointer,
		).toBe("/child/value")
	})
	test.each([
		[
			{ $schema: "http://json-schema.org/draft-04/schema#" },
			"unsupported-dialect",
		],
		[
			{ $schema: "https://json-schema.org/draft/2019-09/schema" },
			"unsupported-dialect",
		],
		[
			{
				$schema: "https://json-schema.org/draft/2020-12/schema",
				$vocabulary: { "https://example.test/required": true },
			},
			"unsupported-vocabulary",
		],
		[{ type: "not-a-type" }, "schema"],
		[{ typoKeyword: true }, "schema"],
		[{ $async: true }, "schema"],
		[{ $ref: "missing.json" }, "schema-load"],
		[{ $ref: "#/definitions/missing" }, "schema"],
	] as const)("schema failures are visible: %j", async (schema, code) => {
		const { engine, file } = await setup(schema)
		expect((await engine.validate(file, "{}")).failures[0]?.code).toBe(code)
	})
	test("$schema inside enum data is not interpreted as a dialect", async () => {
		const { engine, file } = await setup({
			enum: [{ $schema: "ordinary data" }],
		})
		expect(
			await engine.validate(file, '{"$schema":"ordinary data"}'),
		).toMatchObject({ diagnostics: [], failures: [] })
	})
	test("configured local schemas can reference one another by logical identifiers", async () => {
		const { engine, file, root } = await setup(
			{ $ref: "https://schemas.example.test/value" },
			{
				files: ["data/**"],
				associations: [
					{ files: ["data/**"], schema: "schema.json" },
					{ files: ["unused/**"], schema: "named.json" },
				],
			},
		)
		await put(root, "named.json", {
			$id: "https://schemas.example.test/value",
			type: "integer",
		})
		await engine.prepare()
		expect(await engine.validate(file, "1")).toMatchObject({
			failures: [],
			diagnostics: [],
		})
		expect((await engine.validate(file, '"x"')).diagnostics[0]?.code).toBe(
			"schema/type",
		)
	})
	test("required format-assertion vocabulary is reported explicitly", async () => {
		const { engine, file } = await setup({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			$vocabulary: {
				"https://json-schema.org/draft/2020-12/vocab/format-assertion": true,
			},
		})
		expect((await engine.validate(file, "{}")).failures[0]?.code).toBe(
			"unsupported-vocabulary",
		)
	})
	test("root and nested anchors resolve; duplicate anchors fail", async () => {
		const root = await setup(
			{
				$schema: "https://json-schema.org/draft/2020-12/schema",
				$anchor: "root",
				type: "integer",
			},
			{
				files: ["data/**"],
				associations: [{ files: ["data/**"], schema: "schema.json#root" }],
			},
		)
		expect(await root.engine.validate(root.file, "1")).toMatchObject({
			failures: [],
			diagnostics: [],
		})
		const nested = await setup({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			$defs: { item: { $id: "nested.json", $anchor: "item", type: "string" } },
			$ref: "nested.json#item",
		})
		expect(await nested.engine.validate(nested.file, '"valid"')).toMatchObject({
			failures: [],
			diagnostics: [],
		})
		const duplicate = await setup({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			$anchor: "duplicate",
			$defs: { item: { $anchor: "duplicate" } },
		})
		expect(
			(await duplicate.engine.validate(duplicate.file, "{}")).failures[0]?.code,
		).toBe("schema")
	})
	test("format assertions reject malformed values", async () => {
		const { engine, file } = await setup({ type: "string", format: "email" })
		expect(
			(await engine.validate(file, '"invalid"')).diagnostics[0]?.code,
		).toBe("schema/format")
	})
	test("boolean schemas and separate dialect associations", async () => {
		const { project, root, file } = await setup(false)
		expect(
			(await new Engine(project).validate(file, "{}")).diagnostics[0]?.code,
		).toBe("schema/false schema")
		await put(root, "schema.json", true)
		expect(await new Engine(project).validate(file, "{}")).toMatchObject({
			diagnostics: [],
			failures: [],
		})
	})
})
