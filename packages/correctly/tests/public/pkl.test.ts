import path from "node:path"
import { pathToFileURL } from "node:url"
import { readFile } from "node:fs/promises"
import { expect, test } from "vite-plus/test"
import { defineConfig, pkl as parsePkl, modeFor } from "../../src/core/index.ts"
import { pkl } from "../../src/validators/pkl.ts"
import { ajv } from "../../src/validators/ajv.ts"
import { Engine } from "../../src/core/engine.ts"
import { check } from "../../src/cli/check.ts"
import { temp, put, onCleanup } from "./helpers.ts"
import { lspClient } from "./lsp-client.ts"
import type { PklOptions } from "../../src/validators/pkl.ts"
import type { EngineOptions } from "../../src/core/engine.ts"

const core = new URL("../../src/core/index.ts", import.meta.url).href
const adapter = new URL("../../src/validators/pkl.ts", import.meta.url).href
async function project(
	options: PklOptions = {},
	engineOptions: EngineOptions = {},
) {
	const root = await temp()
	const engine = new Engine(
		{
			root,
			configPath: path.join(root, "correctly.config.ts"),
			config: defineConfig({
				files: ["data.pkl"],
				associations: [{ files: ["*.pkl"], validate: pkl(options) }],
			}),
		},
		engineOptions,
	)
	onCleanup(() => engine.dispose())
	return { root, engine, file: path.join(root, "data.pkl") }
}

test("PKL discovery, syntax-only parsing and UTF-16 syntax locations", async () => {
	expect(modeFor("config.PKL")).toBe("pkl")
	const root = await temp()
	await put(
		root,
		"correctly.config.ts",
		`import {defineConfig} from ${JSON.stringify(core)}; export default defineConfig({associations:[]})`,
	)
	await put(root, "data.pkl", 'port: Int = "wrong"')
	expect(await check({ cwd: root })).toMatchObject({
		exitCode: 0,
		files: [{ mode: "pkl", coverage: "syntax-only", diagnostics: [] }],
	})
	const text = 'name = "💡"\r\nbroken = @'
	const parsed = await parsePkl().parse(text, {
		file: path.join(root, "data.pkl"),
	})
	expect(parsed.diagnostics).toMatchObject([
		{
			code: "syntax",
			offset: text.indexOf("@"),
			range: { start: { line: 1, character: 9 } },
		},
	])
	await put(root, "data.pkl", text)
	expect(await check({ cwd: root })).toMatchObject({
		exitCode: 1,
		files: [{ diagnostics: [{ code: "syntax" }] }],
	})
})

test.each([
	['name: String = "app"\nport: Int(this > 0 && this < 65536) = 8080', true],
	['port: Int = "oops"', false],
	["port: Int(this > 0) = -1", false],
	['class Person { name: String }\nperson = new Person { name = "Ada" }', true],
	["class Person { name: String }\nperson = new Person { name = 1 }", false],
	["typealias Port = Int(this > 0)\nport: Port = 12", true],
	["typealias Port = Int(this > 0)\nport: Port = -1", false],
	[
		"local function double(x: Int): Int = x * 2\nresult = List(1,2,3).map((x) -> double(x))",
		true,
	],
	[
		'name = "Ada"\ngreeting = "Hello, \\(name)!"\nitems = new Listing { for (x in List(1,2,3)) { x * 2 } }',
		true,
	],
	["x = nonexistent", false],
	["x = 1 / 0", false],
	["x = new Dynamic { value = 2 }", true],
])("native types, constraints and expressions: %s", async (source, valid) => {
	const { engine, file } = await project()
	const result = await engine.validate(file, source)
	expect(result.failures).toEqual([])
	expect(result.coverage).toBe("validated")
	if (valid) expect(result.diagnostics).toEqual([])
	else expect(result.diagnostics).toMatchObject([{ code: "pkl/evaluation" }])
})

test("local imports, import expressions, amends, extends and resource dependencies", async () => {
	const dependencies = new Set<string>()
	const { root, engine, file } = await project(
		{},
		{ onDependency: (uri) => dependencies.add(uri) },
	)
	await put(root, "base.pkl", 'name: String = "base"\nport: Int(this > 0) = 80')
	await put(root, "name.txt", "from-file")
	for (const source of [
		'amends "base.pkl"\nport = 8080',
		'extends "base.pkl"\nextra = true',
		'import "base.pkl" as Base\nname = Base.name\nport = Base.port',
		'port = import("base.pkl").port\nname = read("name.txt")',
		`port = import(${JSON.stringify(pathToFileURL(path.join(root, "base.pkl")).href)}).port`,
	])
		expect(await engine.validate(file, source)).toMatchObject({
			diagnostics: [],
			failures: [],
		})
	expect(dependencies).toContain(
		pathToFileURL(path.join(root, "base.pkl")).href,
	)
	expect(dependencies).toContain(
		pathToFileURL(path.join(root, "name.txt")).href,
	)
	expect(
		await engine.validate(file, 'amends "base.pkl"\nport = -1'),
	).toMatchObject({ diagnostics: [{ code: "pkl/evaluation" }], failures: [] })
	await put(root, "middle.pkl", 'amends "base.pkl"\nport = 100')
	expect(
		await engine.validate(file, 'amends "middle.pkl"\nport = -1'),
	).toMatchObject({ diagnostics: [{ code: "pkl/evaluation" }], failures: [] })
	expect(
		await engine.validate(file, 'extends "base.pkl"\nport = "wrong"'),
	).toMatchObject({ diagnostics: [{ code: "pkl/evaluation" }], failures: [] })
	await put(root, "fixed.pkl", "fixed port: Int = 80")
	expect(
		await engine.validate(file, 'amends "fixed.pkl"\nport = 90'),
	).toMatchObject({ diagnostics: [{ code: "pkl/evaluation" }], failures: [] })
	expect(
		await engine.validate(
			file,
			'import "missing.pkl" as Missing\nx = Missing.value',
		),
	).toMatchObject({ diagnostics: [{ code: "pkl/evaluation" }], failures: [] })
	for (const source of [
		'amends "missing.pkl"\nx = 1',
		'extends "missing.pkl"\nx = 1',
	])
		expect(await engine.validate(file, source)).toMatchObject({
			diagnostics: [{ code: "pkl/evaluation" }],
			failures: [],
		})
	await put(root, "base.pkl", "name = @")
	expect(
		await engine.validate(file, 'import "base.pkl" as Base\nx = Base.name'),
	).toMatchObject({
		diagnostics: [
			{
				code: "syntax",
				offset: 0,
				message: expect.stringContaining("base.pkl"),
			},
		],
		failures: [],
	})
})

test("glob imports and explicit environment/properties", async () => {
	const { root, engine, file } = await project({
		environment: { APP_NAME: "demo" },
		properties: { stage: "test" },
	})
	await put(root, "modules/a.pkl", 'value = "one"')
	await put(root, "modules/b.pkl", 'value = "two"')
	expect(
		await engine.validate(
			file,
			'import* "modules/*.pkl" as Modules\nx = Modules.length\nname = read("env:APP_NAME")\nstage = read("prop:stage")',
		),
	).toMatchObject({ diagnostics: [], failures: [] })
	expect(
		await engine.validate(file, 'x = read("env:UNCONFIGURED")'),
	).toMatchObject({ diagnostics: [{ code: "pkl/evaluation" }], failures: [] })
})

test("evaluated JSON composes with Ajv and preserves exact numeric lexemes", async () => {
	const { root, engine, file } = await project({
		validate: ajv({ schema: "schema.json" }),
	})
	await put(root, "schema.json", {
		type: "object",
		properties: { port: { type: "integer", minimum: 100 } },
		required: ["port"],
	})
	expect(await engine.validate(file, "port = 20 * 10")).toMatchObject({
		coverage: "schema",
		diagnostics: [],
		failures: [],
	})
	expect(await engine.validate(file, "port = 20")).toMatchObject({
		coverage: "schema",
		diagnostics: [{ code: "schema/minimum", pointer: "/port", offset: 0 }],
		failures: [],
	})
	let observed: unknown
	const exact = await project({
		validate: {
			id: "exact",
			accepts: ["json"],
			prepare: () => ({
				validate: ({ parsed }) => {
					observed = parsed.rawNumber?.("/number")
					return []
				},
			}),
		},
	})
	expect(
		await exact.engine.validate(exact.file, "number = 9223372036854775807"),
	).toMatchObject({ diagnostics: [], failures: [] })
	expect(observed).toBe("9223372036854775807")
})

test("remote imports resolve relative URLs, use bounded requests and reuse offline caches", async () => {
	const requested: string[] = []
	const request: typeof fetch = async (input) => {
		const uri =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url
		requested.push(uri)
		return new Response(
			uri.endsWith("base.pkl")
				? 'import "./child.pkl" as Child\nvalue = Child.value'
				: "value = 42",
		)
	}
	const { engine, file } = await project({}, { fetch: request })
	const source =
		'import "https://example.test/base.pkl" as Base\nvalue = Base.value'
	expect(await engine.validate(file, source)).toMatchObject({
		diagnostics: [],
		failures: [],
	})
	expect(requested).toEqual([
		"https://example.test/base.pkl",
		"https://example.test/child.pkl",
	])
	const offline = new Engine(engine.project, {
		offline: true,
		fetch: () => {
			throw new Error("unexpected network")
		},
	})
	onCleanup(() => offline.dispose())
	expect(await offline.validate(file, source)).toMatchObject({
		diagnostics: [],
		failures: [],
	})
	expect(
		await offline.validate(
			file,
			'x = import("https://example.test/missing.pkl").value',
		),
	).toMatchObject({ failures: [{ code: "pkl-offline" }] })
	const limited = new Engine(
		{
			...engine.project,
			config: { ...engine.project.config, remote: { maxBytes: 8 } },
		},
		{ fetch: request },
	)
	onCleanup(() => limited.dispose())
	expect(await limited.validate(file, source)).toMatchObject({
		failures: [{ code: "pkl-limit" }],
	})
})

test("package imports unpack ZIPs in WASM and resolve relative modules", async () => {
	const zip = await readFile(
		new URL("fixtures/pkl/package.zip", import.meta.url),
	)
	const requested: string[] = []
	const { engine, file } = await project(
		{},
		{
			fetch: async (input) => {
				requested.push(
					typeof input === "string"
						? input
						: input instanceof URL
							? input.href
							: input.url,
				)
				return new Response(zip)
			},
		},
	)
	expect(
		await engine.validate(
			file,
			'import "package://example.test/pkg@1.0.0#/Config.pkl" as Config\nvalue = Config.value',
		),
	).toMatchObject({ diagnostics: [], failures: [] })
	expect(requested).toEqual(["https://example.test/pkg@1.0.0.zip"])
	expect(
		await engine.validate(
			file,
			'import "package://example.test/pkg@1.0.0#/Glob.pkl" as Config\nvalue = Config.count',
		),
	).toMatchObject({ diagnostics: [], failures: [] })
	const offline = new Engine(engine.project, {
		offline: true,
		fetch: () => {
			throw new Error("unexpected network")
		},
	})
	onCleanup(() => offline.dispose())
	expect(
		await offline.validate(
			file,
			'amends "package://example.test/pkg@1.0.0#/Config.pkl"\nvalue = 100',
		),
	).toMatchObject({ diagnostics: [], failures: [] })
})

test("CLI and LSP share validation and unsaved imported buffers reload dependents", async () => {
	const root = await temp()
	await put(
		root,
		"correctly.config.ts",
		`import {defineConfig,pkl as parse} from ${JSON.stringify(core)}; import {pkl} from ${JSON.stringify(adapter)}; export default defineConfig({ files:["data.pkl"],associations:[{files:["*.pkl"],parse:parse(),validate:pkl()}]})`,
	)
	const base = await put(root, "base.pkl", "port: Int(this > 0) = 80")
	const file = await put(root, "data.pkl", 'amends "base.pkl"\nport = -1')
	expect(await check({ cwd: root })).toMatchObject({
		exitCode: 1,
		summary: { checked: 1, validated: 1 },
		files: [{ mode: "pkl", diagnostics: [{ code: "pkl/evaluation" }] }],
	})
	const client = await lspClient([root], undefined, undefined, true)
	const uri = pathToFileURL(file).href
	await client.open(uri, 'amends "base.pkl"\nport = -1', 1, "pkl")
	expect((await client.wait(uri, 1)).diagnostics[0]?.code).toBe(
		"pkl/evaluation",
	)
	await client.change(uri, 'amends "base.pkl"\nport = 12', 2)
	expect((await client.wait(uri, 2)).diagnostics).toEqual([])
	const count = client.notifications.length
	await client.open(
		pathToFileURL(base).href,
		"port: Int(this > 100) = 200",
		1,
		"pkl",
	)
	expect((await client.wait(uri, 2, count)).diagnostics[0]?.code).toBe(
		"pkl/evaluation",
	)
	expect(
		await client.request("textDocument/hover", uri, { line: 1, character: 2 }),
	).toBeNull()
})

test("an aborted validation fails without reading resources", async () => {
	const controller = new AbortController()
	const { engine, file } = await project(
		{},
		{
			signal: controller.signal,
			read: () => {
				throw new Error("unexpected read")
			},
		},
	)
	controller.abort()
	expect(await engine.validate(file, 'x = read("file.txt")')).toMatchObject({
		diagnostics: [],
		failures: [{ code: "execution" }],
	})
})

test("glob additions revalidate editor dependents", async () => {
	const root = await temp()
	await put(
		root,
		"correctly.config.ts",
		`import {defineConfig,pkl as parse} from ${JSON.stringify(core)}; import {pkl} from ${JSON.stringify(adapter)}; export default defineConfig({files:["data.pkl"],associations:[{files:["*.pkl"],parse:parse(),validate:pkl()}]})`,
	)
	await put(root, "modules/a.pkl", "value = 1")
	const file = await put(
		root,
		"data.pkl",
		'import* "modules/*.pkl" as Modules\ncount: Int(this == 1) = Modules.length',
	)
	const client = await lspClient([root], undefined, undefined, true)
	const uri = pathToFileURL(file).href
	await client.open(
		uri,
		'import* "modules/*.pkl" as Modules\ncount: Int(this == 1) = Modules.length',
		1,
		"pkl",
	)
	expect((await client.wait(uri, 1)).diagnostics).toEqual([])
	const count = client.notifications.length
	const added = await put(root, "modules/b.pkl", "value = 2")
	await client.connection.sendNotification("workspace/didChangeWatchedFiles", {
		changes: [{ uri: pathToFileURL(added).href, type: 1 }],
	})
	expect((await client.wait(uri, 1, count)).diagnostics[0]?.code).toBe(
		"pkl/evaluation",
	)
})
