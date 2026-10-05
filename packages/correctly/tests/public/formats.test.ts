import path from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { TextDocument } from "vscode-languageserver-textdocument"
import { expect, test } from "vite-plus/test"
import {
	yaml,
	toml,
	defineConfig,
	GITIGNORE,
	Engine,
	diagnostic,
	type ParsedDocument,
	type Validator,
} from "../../src/core/index.ts"
import { modeFor } from "../../src/core/config.ts"
import { check } from "../../src/cli/check.ts"
import { setup, put, sampleSchema, temp, configSource } from "./helpers.ts"
import { lspClient } from "./lsp-client.ts"
import { Hints } from "../../src/lsp/hints.ts"
import { Workspace } from "../../src/lsp/workspace.ts"

function parseFormat(text: string, mode: "yaml" | "toml"): ParsedDocument {
	const parsed = (mode === "yaml" ? yaml() : toml()).parse(text, {
		file: `data.${mode}`,
	})
	if (parsed instanceof Promise)
		throw new Error("Built-in parsers are synchronous")
	return parsed
}

test.each([
	["config.yaml", "yaml"],
	["config.yml", "yaml"],
	["config.toml", "toml"],
	["config.YAML", "yaml"],
	["config.TOML", "toml"],
	["config.jsonc", "jsonc"],
])("%s selects %s", (file, mode) => {
	expect(modeFor(file)).toBe(mode)
})

test("YAML core scalars, block strings, flow collections, and aliases become JSON values", () => {
	const source =
		"name: app\nenabled: true\ncount: 0x10\nempty:\ntext: |\n  hello\n  world\nvalues: [null, false, 1.5, yes, 2026-10-02]\nbase: &base {color: blue}\ncopy: *base\n"
	const parsed = parseFormat(source, "yaml")
	expect(parsed.diagnostics).toEqual([])
	expect(parsed.value).toEqual({
		name: "app",
		enabled: true,
		count: 16,
		empty: null,
		text: "hello\nworld\n",
		values: [null, false, 1.5, "yes", "2026-10-02"],
		base: { color: "blue" },
		copy: { color: "blue" },
	})
	expect(parsed.locate("/copy/color")).toEqual({
		offset: source.indexOf("*base"),
		length: 5,
	})
})

test("TOML tables, dotted keys, inline tables, arrays, and dates become JSON values", () => {
	const source =
		'name = "app"\n"a/b"."~key" = [0x10, 1.5, true]\ndate = 2026-10-02\ntime = 07:32:00\nstamp = 1979-05-27T07:32:00-08:00\ninline = { nested.value = "x" }\n[owner]\nname = "jem"\n[[products]]\nname = "first"\n[[products]]\nname = "second"\n[products.details]\ncount = 42\n'
	const parsed = parseFormat(source, "toml")
	expect(parsed.diagnostics).toEqual([])
	expect(parsed.value).toEqual({
		name: "app",
		"a/b": { "~key": [16, 1.5, true] },
		date: "2026-10-02",
		time: "07:32:00",
		stamp: "1979-05-27T07:32:00-08:00",
		inline: { nested: { value: "x" } },
		owner: { name: "jem" },
		products: [{ name: "first" }, { name: "second", details: { count: 42 } }],
	})
	expect(parsed.locate("/a~1b/~0key/1")).toEqual({
		offset: source.indexOf("1.5"),
		length: 3,
	})
	expect(parsed.locate("/products/1/details/count")).toEqual({
		offset: source.indexOf("42"),
		length: 2,
	})
	expect(parsed.locate("/products/1/name", true)).toEqual({
		offset: source.indexOf('name = "second"'),
		length: 4,
	})
})

test.each([
	["yaml", 'outer:\n  name: x\n  "name": y\n', "/outer/name", "name"],
	["toml", 'name = "x"\nname = "y"\n', "", "name"],
])(
	"%s rejects duplicate keys at the later key",
	(mode, source, pointer, key) => {
		const parsed = parseFormat(source, mode as "yaml" | "toml")
		expect(parsed.diagnostics).toHaveLength(1)
		expect(parsed.diagnostics[0]).toMatchObject({
			code: "duplicate-key",
			pointer,
			range: { start: { line: mode === "yaml" ? 2 : 1 } },
		})
		expect(source.slice(parsed.diagnostics[0]!.offset)).toContain(key)
	},
)

test.each([
	["yaml", "name: ["],
	["yaml", "---\na: 1\n---\na: 2"],
	["yaml", "a: *missing"],
	["yaml", "a: &a [*a]"],
	["yaml", "1: value"],
	["yaml", "? [a, b]\n: value"],
	["yaml", "a: !custom value"],
	["yaml", "%YAML 1.1\n---\na: yes"],
	["yaml", "a: .inf"],
	["yaml", "a: .nan"],
	["yaml", "a: 9007199254740993"],
	["toml", 'name = "'],
	["toml", "a = inf"],
	["toml", "a = nan"],
	["toml", "a = 9007199254740993"],
	["toml", "a = { b = 1, }"],
])("%s rejects unsupported or malformed input %s", (mode, source) => {
	const parsed = parseFormat(source, mode as "yaml" | "toml")
	expect(parsed.diagnostics.length).toBeGreaterThan(0)
	expect(parsed.diagnostics.every((d) => d.code === "syntax")).toBe(true)
	expect(
		parsed.diagnostics.every((d) => d.offset >= 0 && d.offset <= source.length),
	).toBe(true)
})

test("empty YAML is null; empty TOML is an object", () => {
	expect(parseFormat("# empty\n", "yaml")).toMatchObject({
		value: null,
		diagnostics: [],
	})
	expect(parseFormat("# empty\n", "toml")).toMatchObject({
		value: {},
		diagnostics: [],
	})
})

test.each(["yaml", "toml"] as const)(
	"%s preserves numeric lexemes without using ancestor locations",
	(mode) => {
		const source =
			mode === "yaml"
				? '"a/b~": [0x10, 1.250e+2, -0]\ntext: "42"\nbase: &number 1.25\ncopy: *number\n'
				: '"a/b~" = [0x10, 1.250e+2, -0]\ntext = "42"\nbase = 1_000\n'
		const parsed = parseFormat(source, mode)
		expect(parsed.diagnostics).toEqual([])
		expect(parsed.rawNumber?.("/a~1b~0/0")).toBe("0x10")
		expect(parsed.rawNumber?.("/a~1b~0/1")).toBe("1.250e+2")
		expect(parsed.rawNumber?.("/a~1b~0/2")).toBe("-0")
		expect(parsed.rawNumber?.("/a~1b~0/0/missing")).toBeUndefined()
		expect(parsed.rawNumber?.("/a~1b~0/4")).toBeUndefined()
		expect(parsed.rawNumber?.("/text")).toBeUndefined()
		if (mode === "yaml") {
			expect(parsed.rawNumber?.("/copy")).toBe("1.25")
			expect(parsed.locate("/copy")).toEqual({
				offset: source.indexOf("*number"),
				length: 7,
			})
		} else expect(parsed.rawNumber?.("/base")).toBe("1_000")
	},
)

test.each(["yaml", "toml"] as const)(
	"%s preserves root numeric lexemes",
	(mode) => {
		const parsed = parseFormat(
			mode === "yaml" ? "1.250e+2" : "value = 1.250e+2",
			mode,
		)
		expect(parsed.rawNumber?.(mode === "yaml" ? "" : "/value")).toBe("1.250e+2")
		expect(parsed.rawNumber?.("/missing")).toBeUndefined()
	},
)

test.each(["yaml", "toml"] as const)(
	"%s composes with a custom validator and supplies numeric lexemes",
	async (mode) => {
		const root = await temp()
		let preparations = 0
		const validate: Validator = {
			id: "custom-json",
			accepts: ["json"],
			prepare: () => {
				preparations++
				return {
					validate: ({ parsed, text }) => {
						expect(parsed.value).toEqual({ value: 125 })
						expect(parsed.rawNumber?.("/value")).toBe("1.250e+2")
						const span = parsed.locate("/value")!
						return [
							diagnostic(
								text,
								"custom",
								"A custom validator diagnostic",
								"/value",
								span.offset,
								span.length,
							),
						]
					},
				}
			},
		}
		const engine = new Engine({
			root,
			configPath: path.join(root, "correctly.config.ts"),
			config: defineConfig({
				files: ["*.conf"],
				associations: [
					{
						files: ["*.conf"],
						parse: mode === "yaml" ? yaml() : toml(),
						validate,
					},
				],
			}),
		})
		await engine.prepare()
		const file = path.join(root, "app.conf")
		const source = mode === "yaml" ? "value: 1.250e+2" : "value = 1.250e+2"
		expect(await engine.validate(file, source)).toMatchObject({
			mode,
			coverage: "validated",
			association: { validator: "custom-json", schema: null },
			failures: [],
			diagnostics: [
				{
					code: "custom",
					pointer: "/value",
					offset: source.indexOf("1.250e+2"),
					length: 8,
				},
			],
		})
		expect(await engine.editor(file)).toBeUndefined()
		expect(preparations).toBe(1)
		await engine.dispose()
	},
)

test.each(["yaml", "toml"] as const)(
	"%s preserves special property names without changing prototypes",
	(mode) => {
		const source =
			mode === "yaml"
				? "__proto__: {polluted: true}\nconstructor: {name: safe}\n"
				: '__proto__.polluted = true\nconstructor.name = "safe"\n'
		const parsed = parseFormat(source, mode)
		expect(parsed.diagnostics).toEqual([])
		expect(parsed.value).toEqual(
			JSON.parse(
				'{"__proto__":{"polluted":true},"constructor":{"name":"safe"}}',
			),
		)
		expect(Object.getPrototypeOf(parsed.value)).toBe(Object.prototype)
		expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false)
	},
)

test.each(["yaml", "toml"] as const)(
	"%s schema errors retain pointers and exact key/value ranges",
	async (mode) => {
		const { engine, root } = await setup(sampleSchema, {
			associations: [{ files: ["data/**"], schema: "schema.json" }],
		})
		const source =
			mode === "yaml" ? 'name: 42\nextra: "😀"\n' : 'name = 42\nextra = "😀"\n'
		const result = await engine.validate(
			path.join(root, `data/test.${mode}`),
			source,
		)
		expect(result.failures).toEqual([])
		expect(
			result.diagnostics.find((d) => d.code === "schema/type"),
		).toMatchObject({
			pointer: "/name",
			offset: source.indexOf("42"),
			length: 2,
		})
		expect(
			result.diagnostics.find((d) => d.code === "schema/additionalProperties"),
		).toMatchObject({
			pointer: "/extra",
			offset: source.indexOf("extra"),
			length: 5,
		})
	},
)

test.each(["yaml", "toml"] as const)(
	"%s locates missing properties, propertyNames, and duplicate array items",
	async (mode) => {
		const { engine, root } = await setup(
			{
				type: "object",
				required: ["required"],
				propertyNames: { pattern: "^[a-z]+$" },
				properties: { items: { type: "array", uniqueItems: true } },
			},
			{ associations: [{ files: ["data/**"], schema: "schema.json" }] },
		)
		const source =
			mode === "yaml"
				? '"bad/key": true\nitems: ["same", "same"]\n'
				: '"bad/key" = true\nitems = ["same", "same"]\n'
		const result = await engine.validate(
			path.join(root, `data/test.${mode}`),
			source,
		)
		expect(
			result.diagnostics.find((d) => d.code === "schema/required"),
		).toMatchObject({ pointer: "/required", offset: 0, length: 1 })
		expect(
			result.diagnostics.find((d) => d.code === "schema/propertyNames"),
		).toMatchObject({ pointer: "/bad~1key", offset: 0, length: 9 })
		expect(
			result.diagnostics.find((d) => d.code === "schema/uniqueItems"),
		).toMatchObject({
			pointer: "/items/1",
			offset: source.lastIndexOf('"same"'),
			length: 6,
		})
	},
)

test("CLI defaults discover all formats, including dotfiles, and respect exclusions", async () => {
	const { root } = await setup(sampleSchema, {
		exclude: ["ignored/**"],
		associations: [{ files: ["data/**"], schema: "schema.json" }],
	})
	await put(root, "data/app.yaml", "name: app")
	await put(root, "data/.app.yml", "name: app")
	await put(root, "data/app.toml", 'name = "app"')
	await put(root, "other.yml", "other: true")
	await put(root, "ignored/bad.yaml", "a: [")
	const report = await check({ cwd: root })
	expect(report.exitCode).toBe(0)
	expect(report.reportVersion).toBe(2)
	expect(report.summary).toMatchObject({ validated: 3, schemaCovered: 3 })
	expect(
		report.files.filter((f) => f.coverage === "schema").map((f) => f.mode),
	).toEqual(["yaml", "toml", "yaml"])
	expect(report.files.find((f) => f.file.endsWith("other.yml"))?.coverage).toBe(
		"syntax-only",
	)
	expect(report.files.some((f) => f.file.includes("ignored/"))).toBe(false)
})

test("format overrides and last matching associations also apply to YAML and TOML", async () => {
	const { root, engine } = await setup(sampleSchema, {
		files: ["data/**"],
		associations: [
			{ files: ["data/**"], schema: "schema.json", mode: "yaml" },
			{ files: ["**/*.toml"], schema: null, mode: "toml" },
		],
	})
	expect(
		await engine.validate(path.join(root, "data/app.conf"), "name: app"),
	).toMatchObject({ mode: "yaml", diagnostics: [], coverage: "schema" })
	expect(
		await engine.validate(path.join(root, "data/app.toml"), "any = true"),
	).toMatchObject({
		mode: "toml",
		diagnostics: [],
		coverage: "syntax-only",
		association: { index: 1 },
	})
})

test.each(["yaml", "toml"] as const)(
	"%s default discovery and explicit validation respect opt-in gitignore exclusions",
	async (mode) => {
		const { root, engine } = await setup(sampleSchema, {
			exclude: [GITIGNORE],
			associations: [{ files: ["data/**"], schema: "schema.json" }],
		})
		await put(root, ".gitignore", `data/ignored.${mode}\n`)
		const ignored = await put(root, `data/ignored.${mode}`, "[")
		const included = await put(
			root,
			`data/included.${mode}`,
			mode === "yaml" ? "name: valid" : 'name = "valid"',
		)
		const discovered = await check({ cwd: root })
		expect(discovered.exitCode).toBe(0)
		expect(discovered.files.some((file) => file.file === ignored)).toBe(false)
		expect(
			discovered.files.find((file) => file.file === included),
		).toMatchObject({
			mode,
			coverage: "schema",
			diagnostics: [],
		})
		const explicit = await check({ cwd: root, files: [ignored] })
		expect(explicit.exitCode).toBe(0)
		expect(explicit.files).toMatchObject([
			{ file: ignored, coverage: "excluded", diagnostics: [], failures: [] },
		])
		expect(await engine.validate(ignored, "[")).toMatchObject({
			coverage: "excluded",
			diagnostics: [],
			failures: [],
		})
		expect(await engine.editor(ignored)).toBeUndefined()
	},
)

test.each(["yaml", "toml"] as const)(
	"%s reports missing editor configuration with the correct parser ID",
	async (mode) => {
		const root = await temp()
		const document = TextDocument.create(
			pathToFileURL(path.join(root, `app.${mode}`)).href,
			mode,
			1,
			"name",
		)
		expect(await new Workspace([root]).validate(document)).toMatchObject({
			mode,
			failures: [{ code: "config" }],
			diagnostics: [{ code: "config" }],
		})
	},
)

test("saved parser selections reload in the LSP; unsaved executable configuration stays inactive", async () => {
	const { root } = await setup(sampleSchema, {
		files: ["data/**"],
		associations: [{ files: ["data/**"], schema: "schema.json", mode: "yaml" }],
	})
	const uri = pathToFileURL(path.join(root, "data/app.conf")).href
	const configUri = pathToFileURL(path.join(root, "correctly.config.ts")).href
	const client = await lspClient([root])
	await client.open(uri, "name: valid", 1, "yaml")
	expect((await client.wait(uri, 1)).diagnostics).toEqual([])
	const nextConfig = {
		files: ["data/**"],
		associations: [
			{ files: ["data/**"], schema: "schema.json", mode: "toml" as const },
		],
	}
	await client.open(configUri, configSource(nextConfig), 1, "typescript")
	await client.change(uri, "name: still-valid", 2)
	expect((await client.wait(uri, 2)).diagnostics).toEqual([])
	await put(root, "correctly.config.ts", nextConfig)
	const after = client.notifications.length
	await client.connection.sendNotification("textDocument/didSave", {
		textDocument: { uri: configUri },
	})
	expect((await client.wait(uri, 2, after)).diagnostics[0]?.code).toBe("syntax")
	await client.change(uri, 'name = "valid"', 3)
	expect((await client.wait(uri, 3)).diagnostics).toEqual([])
	await put(root, "data/app.conf", 'name = "valid"')
	const report = await check({ cwd: root, files: ["data/app.conf"] })
	expect(report.exitCode).toBe(0)
	expect(report.files[0]?.mode).toBe("toml")
})

test.each(["yaml", "toml"] as const)(
	"%s keeps embedded $schema ordinary and does not return JSON hints",
	async (mode) => {
		const { root, engine } = await setup(sampleSchema, {
			associations: [{ files: ["data/**"], schema: "schema.json" }],
		})
		const file = path.join(root, `data/app.${mode}`)
		const source =
			mode === "yaml"
				? "$schema: https://must-not-fetch.invalid\nname: app\n"
				: '"$schema" = "https://must-not-fetch.invalid"\nname = "app"\n'
		expect(await engine.validate(file, source)).toMatchObject({
			failures: [],
			diagnostics: [
				{ code: "schema/additionalProperties", pointer: "/$schema" },
			],
		})
		const document = TextDocument.create(
			pathToFileURL(file).href,
			mode,
			1,
			source,
		)
		const hints = new Hints()
		expect(
			await hints.complete(engine, document, { line: 1, character: 2 }),
		).toEqual({ isIncomplete: false, items: [] })
		expect(
			await hints.hover(engine, document, { line: 1, character: 2 }),
		).toBeNull()
	},
)

test.each(["yaml", "toml"] as const)(
	"%s reports UTF-16 ranges in CRLF documents",
	async (mode) => {
		const { root, engine } = await setup(
			{
				type: "object",
				properties: { "😀": { type: "string" }, name: { type: "string" } },
			},
			{ associations: [{ files: ["data/**"], schema: "schema.json" }] },
		)
		const source =
			mode === "yaml"
				? '"😀": 42\r\nname: 42\r\n'
				: '"😀" = 42\r\nname = 42\r\n'
		const result = await engine.validate(
			path.join(root, `data/app.${mode}`),
			source,
		)
		expect(result.diagnostics.map((d) => d.range)).toEqual([
			{
				start: { line: 0, character: mode === "yaml" ? 6 : 7 },
				end: { line: 0, character: mode === "yaml" ? 8 : 9 },
			},
			{
				start: { line: 1, character: mode === "yaml" ? 6 : 7 },
				end: { line: 1, character: mode === "yaml" ? 8 : 9 },
			},
		])
	},
)

test.each(["yaml", "toml"] as const)(
	"%s CLI and stdio LSP agree, including unsaved buffers",
	async (mode) => {
		const { root, engine } = await setup(sampleSchema, {
			associations: [{ files: ["data/**"], schema: "schema.json" }],
		})
		const file = await put(
			root,
			`data/app.${mode}`,
			mode === "yaml" ? "name: valid" : 'name = "valid"',
		)
		const uri = pathToFileURL(file).href
		const client = await lspClient([root])
		const sources =
			mode === "yaml"
				? ["name: 42", "name: x\nname: y", "name: [", "name: valid"]
				: ["name = 42", 'name = "x"\nname = "y"', 'name = "', 'name = "valid"']
		await client.open(uri, sources[0]!, 1, mode)
		for (const [index, source] of sources.entries()) {
			if (index) await client.change(uri, source, index + 1)
			const editor = await client.wait(uri, index + 1)
			const core = await engine.validate(file, source)
			expect(
				editor.diagnostics.map((d) => ({
					code: d.code,
					message: d.message,
					range: d.range,
				})),
			).toEqual(
				core.diagnostics.map((d) => ({
					code: d.code,
					message: d.message,
					range: d.range,
				})),
			)
			await put(root, `data/app.${mode}`, source)
			expect(
				(await check({ cwd: root })).files.find((f) => f.file === file)
					?.diagnostics,
			).toEqual(core.diagnostics)
		}
		await put(root, `data/app.${mode}`, sources[0])
		const cli = spawnSync(
			process.execPath,
			[path.resolve("src/cli/main.ts"), "check", "--format=json"],
			{ cwd: root, encoding: "utf8" },
		)
		expect(cli.status).toBe(1)
		expect(
			JSON.parse(cli.stdout).files.find(
				(f: { file: string }) => f.file === file,
			),
		).toMatchObject({
			mode,
			coverage: "schema",
			diagnostics: [{ code: "schema/type" }],
		})
	},
)
