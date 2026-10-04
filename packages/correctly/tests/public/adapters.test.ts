import path from "node:path"
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { expect, test } from "vite-plus/test"
import { TextDocument } from "vscode-languageserver-textdocument"
import {
	Engine,
	defineConfig,
	json,
	diagnostic,
	loadProject,
	type Validator,
} from "../../src/core/index.ts"
import { Hints } from "../../src/lsp/hints.ts"
import { Workspace } from "../../src/lsp/workspace.ts"
import { ProjectSession } from "../../src/runtime/session.ts"
import { check } from "../../src/cli/check.ts"
import { temp, put, onCleanup } from "./helpers.ts"

const core = new URL("../../src/core/index.ts", import.meta.url).href
const adapter = new URL("../../src/validators/ajv.ts", import.meta.url).href

test("parser and validator compose with a different value model, source ranges and no implicit hints", async () => {
	const root = await temp()
	let preparations = 0
	let disposals = 0
	const validator: Validator = {
		id: "bigint",
		accepts: ["bigint"],
		prepare: () => {
			preparations++
			return {
				validate: ({ parsed, text }) =>
					parsed.value === 18446744073709551615n
						? []
						: [
								diagnostic(
									text,
									"integer",
									"Expected u64 max",
									"",
									0,
									text.length,
								),
							],
				dispose: () => {
					disposals++
				},
			}
		},
	}
	const config = defineConfig({
		files: ["*.txt"],
		associations: [
			{
				files: ["*.txt"],
				parse: {
					id: "decimal",
					valueModel: "bigint",
					parse: (text: string) => ({
						value: BigInt(text),
						diagnostics: [],
						locate: () => ({ offset: 0, length: text.length }),
					}),
				},
				validate: validator,
			},
		],
	})
	const engine = new Engine({
		root,
		configPath: path.join(root, "correctly.config.ts"),
		config,
	})
	await engine.prepare()
	const file = path.join(root, "value.txt")
	expect(await engine.validate(file, "18446744073709551615")).toMatchObject({
		coverage: "validated",
		diagnostics: [],
		failures: [],
		association: { validator: "bigint" },
	})
	expect(
		(await engine.validate(file, "18446744073709551616")).diagnostics,
	).toMatchObject([{ code: "integer", length: 20 }])
	expect(preparations).toBe(1)
	expect(
		(
			await new Hints().complete(
				engine,
				TextDocument.create(pathToFileURL(file).href, "plaintext", 1, "1"),
				{ line: 0, character: 0 },
			)
		)?.items,
	).toEqual([])
	await engine.dispose()
	expect(disposals).toBe(1)
})

test("validator identity, not display ID, scopes prepared state", async () => {
	const root = await temp()
	let preparations = 0
	const provider = (message: string): Validator => ({
		id: "same",
		accepts: ["json"],
		prepare: () => {
			preparations++
			return { validate: ({ text }) => [diagnostic(text, "custom", message)] }
		},
	})
	const config = defineConfig({
		associations: [
			{ files: ["a.json"], validate: provider("first") },
			{ files: ["b.json"], validate: provider("second") },
		],
	})
	const engine = new Engine({
		root,
		configPath: path.join(root, "correctly.config.ts"),
		config,
	})
	await engine.prepare()
	for (const [file, message] of [
		["a.json", "first"],
		["b.json", "second"],
		["a.json", "first"],
	])
		expect(
			(await engine.validate(path.join(root, file!), "{}")).diagnostics[0]
				?.message,
		).toBe(message)
	expect(preparations).toBe(2)
})

test("incompatible value models fail before validation, including the default parser", async () => {
	const root = await temp()
	const engine = new Engine({
		root,
		configPath: "correctly.config.ts",
		config: defineConfig({
			associations: [
				{
					files: ["*.json"],
					validate: {
						id: "exact",
						accepts: ["bigint"],
						prepare: () => {
							throw new Error("must not prepare")
						},
					},
				},
			],
		}),
	})
	await expect(engine.prepare()).rejects.toMatchObject({
		code: "adapter-incompatible",
	})
})

test("JSON preserves numeric lexemes separately from rounded values and maps nested array locations", () => {
	const source = '{"a/b~":[18446744073709551615,1.250e+2],"0":-0}'
	const parsed = json().parse(source, { file: "data.json" })
	if (parsed instanceof Promise) throw new Error("JSON parser is synchronous")
	expect(parsed.rawNumber?.("/a~1b~0/0")).toBe("18446744073709551615")
	expect(parsed.rawNumber?.("/a~1b~0/1")).toBe("1.250e+2")
	expect(parsed.rawNumber?.("/0")).toBe("-0")
	expect(parsed.rawNumber?.("/0/missing")).toBeUndefined()
	expect(parsed.rawNumber?.("/a~1b~0/4")).toBeUndefined()
	const span = parsed.locate("/a~1b~0/1")!
	expect(source.slice(span.offset, span.offset + span.length)).toBe("1.250e+2")
})

test("Comline loads a typed module with imported adapters; legacy JSON is rejected", async () => {
	const root = await temp()
	await put(
		root,
		"adapter.ts",
		`import type { Validator } from ${JSON.stringify(core)}; export const validator: Validator = { id: "custom", accepts: ["json"], prepare: () => ({ validate: () => [] }) }`,
	)
	const config = await put(
		root,
		"correctly.config.ts",
		`import { defineConfig } from ${JSON.stringify(core)}; import { validator } from "./adapter.ts"; export default defineConfig({associations:[{files:["*.json"],validate:validator}]})`,
	)
	await put(root, "data.json", "{}")
	expect(await check({ cwd: root })).toMatchObject({
		exitCode: 0,
		summary: { validated: 1, schemaCovered: 0 },
	})
	expect((await loadProject(config)).config.associations[0]?.validate?.id).toBe(
		"custom",
	)
	const legacy = await put(root, "correctly.config.json", { associations: [] })
	await expect(loadProject(legacy)).rejects.toThrow("TypeScript .ts module")
})

test("imported extension edits reload validation and hints, and broken imports disable stale validation", async () => {
	const root = await temp()
	const extension = (valid: boolean) =>
		`export default { id: "custom", formats: { company: { type: "string", validate: () => ${valid} } } }`
	const modulePath = await put(root, "extension.ts", extension(true))
	const configPath = await put(
		root,
		"correctly.config.ts",
		`import {defineConfig,json} from ${JSON.stringify(core)}; import {ajv} from ${JSON.stringify(adapter)}; import extension from "./extension.ts"; export default defineConfig({ files:["data.json"], associations:[{files:["data.json"],parse:json(),validate:ajv({schema:"schema.json",extensions:[extension]})}]})`,
	)
	await put(root, "schema.json", {
		type: "string",
		format: "company",
		description: "Original",
	})
	const uri = pathToFileURL(path.join(root, "data.json")).href
	const document = TextDocument.create(uri, "json", 1, '"value"')
	const workspace = new Workspace([root])
	onCleanup(async () => {
		workspace.invalidate()
	})
	expect((await workspace.validate(document)).diagnostics).toEqual([])
	const moduleUri = pathToFileURL(modulePath).href
	expect(workspace.resourceChanged(moduleUri)).toBe(true)
	workspace.open(
		TextDocument.create(moduleUri, "typescript", 2, extension(false)),
	)
	expect((await workspace.validate(document)).diagnostics).toEqual([])
	await put(root, "extension.ts", extension(false))
	workspace.invalidate()
	expect((await workspace.validate(document)).diagnostics[0]?.code).toBe(
		"schema/format",
	)
	await put(root, "schema.json", {
		type: "string",
		format: "company",
		description: "Updated",
	})
	workspace.invalidate()
	expect(
		JSON.stringify(
			await new Hints().hover(await workspace.engineFor(uri), document, {
				line: 0,
				character: 2,
			}),
		),
	).toContain("Updated")
	const config = await readFile(configPath, "utf8")
	await put(
		root,
		"correctly.config.ts",
		config.replace("./extension.ts", "./missing.ts"),
	)
	workspace.invalidate()
	expect((await workspace.validate(document)).failures[0]?.code).toBe("config")
	expect(
		workspace.resourceChanged(
			pathToFileURL(path.join(root, "missing.ts")).href,
		),
	).toBe(true)
	await put(root, "missing.ts", extension(true))
	workspace.invalidate()
	expect((await workspace.validate(document)).failures).toEqual([])
	expect((await workspace.validate(document)).diagnostics).toEqual([])
})

test("session disposal invokes adapter cleanup and provides an aborted signal", async () => {
	const root = await temp()
	const config = await put(
		root,
		"correctly.config.ts",
		`import {writeFileSync} from "node:fs"; export default { associations: [{ files: ["*.json"], validate: { id:"cleanup",accepts:["json"], prepare(context) { return { validate: () => [], dispose() { writeFileSync(${JSON.stringify(path.join(root, "disposed"))}, String(context.signal.aborted)) } } } } }] }`,
	)
	const session = new ProjectSession(config)
	onCleanup(() => session.dispose())
	await session.ready
	await session.dispose()
	expect(await readFile(path.join(root, "disposed"), "utf8")).toBe("true")
})
