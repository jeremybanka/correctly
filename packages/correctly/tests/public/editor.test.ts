import { pathToFileURL } from "node:url"
import path from "node:path"
import { TextDocument } from "vscode-languageserver-textdocument"
import { expect, test } from "vite-plus/test"
import { Hints } from "../../src/lsp/hints.ts"
import { Workspace } from "../../src/lsp/workspace.ts"
import { Engine } from "../../src/core/engine.ts"
import {
	setup,
	put,
	sampleSchema,
	temp,
	configSource,
	onCleanup,
} from "./helpers.ts"

function workspaceFor(roots: string[]) {
	const workspace = new Workspace(roots)
	onCleanup(async () => {
		workspace.invalidate()
	})
	return workspace
}

test("external associations provide property/value completions and hover without embedded $schema", async () => {
	const { engine, uri } = await setup()
	const hints = new Hints()
	const incomplete = TextDocument.create(uri, "json", 1, '{\n  ""\n}')
	expect(
		(
			await hints.complete(engine, incomplete, { line: 1, character: 3 })
		)?.items.map((i) => i.label),
	).toEqual(expect.arrayContaining(["name", "color"]))
	const value = TextDocument.create(uri, "json", 2, '{"name":"ok","color": ""}')
	expect(
		(
			await hints.complete(engine, value, { line: 0, character: 23 })
		)?.items.map((i) => i.label),
	).toEqual(expect.arrayContaining(['"red"', '"blue"']))
	const hover = await hints.hover(engine, value, { line: 0, character: 15 })
	expect(JSON.stringify(hover)).toContain("A primary color")
})

test("$schema remains ordinary data in hints, with no remote override", async () => {
	const { engine, uri } = await setup({
		...sampleSchema,
		properties: {
			...sampleSchema.properties,
			$schema: {
				type: "string",
				description: "An ordinary application property",
			},
		},
	})
	const hints = new Hints()
	const document = TextDocument.create(
		uri,
		"json",
		1,
		'{"$schema":"https://must-not-fetch.invalid", "name":"ok", ""}',
	)
	const completions = await hints.complete(engine, document, {
		line: 0,
		character: document.getText().length - 2,
	})
	expect(completions?.items.map((i) => i.label)).toContain("color")
	expect(
		JSON.stringify(
			await hints.hover(engine, document, { line: 0, character: 3 }),
		),
	).toContain("An ordinary application property")
	expect(
		(
			await engine.validate(
				path.join(engine.project.root, "data/test.json"),
				'{"$schema":"https://must-not-fetch.invalid","name":"ok"}',
			)
		).diagnostics,
	).toEqual([])
})

test("hint service supports association fragments and referenced property descriptions", async () => {
	const { engine, root, uri } = await setup({
		$ref: "defs.json#/definitions/config",
	})
	await put(root, "defs.json", { definitions: { config: sampleSchema } })
	const document = TextDocument.create(uri, "json", 1, '{"name":"x"}')
	expect(
		JSON.stringify(
			await new Hints().hover(engine, document, { line: 0, character: 3 }),
		),
	).toContain("The project name")
})

test("unsaved documents use the same diagnostics as the CLI core", async () => {
	const { engine, root, uri, file } = await setup()
	await put(root, "data/test.json", { name: "valid on disk" })
	const document = TextDocument.create(
		uri,
		"json",
		2,
		'{"name":2,"extra":true}',
	)
	const workspace = workspaceFor([root])
	workspace.open(document)
	expect((await workspace.validate(document)).diagnostics).toEqual(
		(await engine.validate(file, document.getText())).diagnostics,
	)
})

test("unsaved schemas refresh validation and hints; executable configs only change on save", async () => {
	const { root, uri } = await setup()
	const workspace = workspaceFor([root])
	const document = TextDocument.create(uri, "json", 1, '{"name":"x"}')
	workspace.open(document)
	expect((await workspace.validate(document)).diagnostics).toEqual([])
	const schemaUri = pathToFileURL(path.join(root, "schema.json")).href
	workspace.open(
		TextDocument.create(
			schemaUri,
			"json",
			2,
			JSON.stringify({
				...sampleSchema,
				properties: { name: { type: "number", description: "A number now" } },
			}),
		),
	)
	expect((await workspace.validate(document)).diagnostics[0]?.code).toBe(
		"schema/type",
	)
	expect(
		JSON.stringify(
			await new Hints().hover(await workspace.engineFor(uri), document, {
				line: 0,
				character: 3,
			}),
		),
	).toContain("A number now")
	workspace.close(schemaUri)
	expect((await workspace.validate(document)).diagnostics).toEqual([])
	const configUri = pathToFileURL(path.join(root, "correctly.config.ts")).href
	workspace.open(
		TextDocument.create(
			configUri,
			"typescript",
			2,
			configSource({ associations: [] }),
		),
	)
	expect((await workspace.validate(document)).coverage).toBe("schema")
	await put(root, "correctly.config.ts", { associations: [] })
	workspace.invalidate()
	expect((await workspace.validate(document)).coverage).toBe("syntax-only")
	workspace.close(configUri)
	expect((await workspace.validate(document)).coverage).toBe("syntax-only")
})

test("schema changes on disk take effect after invalidation", async () => {
	const { root, uri } = await setup()
	const workspace = workspaceFor([root])
	const document = TextDocument.create(uri, "json", 1, '{"name":"x"}')
	expect((await workspace.validate(document)).diagnostics).toEqual([])
	await put(root, "schema.json", { type: "number" })
	workspace.invalidate()
	expect((await workspace.validate(document)).diagnostics[0]?.code).toBe(
		"schema/type",
	)
})

test("multi-root workspaces and nested configs keep their own schemas", async () => {
	const first = await setup()
	const second = await setup({ type: "number" })
	const workspace = workspaceFor([first.root, second.root])
	const document = (uri: string) =>
		TextDocument.create(uri, "json", 1, '{"name":"x"}')
	expect((await workspace.validate(document(first.uri))).diagnostics).toEqual(
		[],
	)
	expect(
		(await workspace.validate(document(second.uri))).diagnostics[0]?.code,
	).toBe("schema/type")
	await put(first.root, "nested/correctly.config.ts", {
		associations: [{ files: ["**/*.json"], schema: "../schema.json" }],
	})
	const nested = pathToFileURL(path.join(first.root, "nested/data.json")).href
	expect((await workspace.validate(document(nested))).diagnostics).toEqual([])
	const outside = await temp()
	expect(
		(
			await workspace.validate(
				document(pathToFileURL(path.join(outside, "data.json")).href),
			)
		).failures[0]?.code,
	).toBe("config")
})

test("missing configs and invalid saved configs fail visibly", async () => {
	const root = await temp()
	const uri = pathToFileURL(path.join(root, "data.json")).href
	const document = TextDocument.create(uri, "json", 1, "{}")
	const workspace = workspaceFor([root])
	expect((await workspace.validate(document)).failures[0]?.code).toBe("config")
	await put(root, "correctly.config.ts", { associations: [] })
	workspace.open(
		TextDocument.create(
			pathToFileURL(path.join(root, "correctly.config.ts")).href,
			"json",
			1,
			"{",
		),
	)
	expect((await workspace.validate(document)).failures).toEqual([])
	await put(root, "correctly.config.ts", "{")
	workspace.invalidate()
	expect((await workspace.validate(document)).failures[0]?.code).toBe("config")
})

test("explicit syntax-only associations provide no external hints", async () => {
	const { project, uri } = await setup(sampleSchema, {
		associations: [{ files: ["**/*.json"], schema: null }],
	})
	const document = TextDocument.create(
		uri,
		"json",
		1,
		'{"$schema":"https://must-not-fetch.invalid",""}',
	)
	expect(
		(
			await new Hints().complete(new Engine(project), document, {
				line: 0,
				character: 41,
			})
		)?.items,
	).toEqual([])
})

test("new executable configs are discovered only after saving", async () => {
	const root = await temp()
	const workspace = workspaceFor([root])
	workspace.open(
		TextDocument.create(
			pathToFileURL(path.join(root, "correctly.config.ts")).href,
			"json",
			1,
			'{"associations":[]}',
		),
	)
	const document = TextDocument.create(
		pathToFileURL(path.join(root, "data.json")).href,
		"json",
		1,
		"{}",
	)
	expect((await workspace.validate(document)).failures[0]?.code).toBe("config")
	await put(root, "correctly.config.ts", { associations: [] })
	workspace.invalidate()
	expect(await workspace.validate(document)).toMatchObject({
		diagnostics: [],
		failures: [],
		coverage: "syntax-only",
	})
})
