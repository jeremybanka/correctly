import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach } from "vite-plus/test"
import { loadProject, type ProjectConfig } from "../../src/core/config.ts"
import { Engine } from "../../src/core/engine.ts"

const temporary: string[] = []
const cleanup: (() => Promise<void>)[] = []
export function onCleanup(action: () => Promise<void>) {
	cleanup.push(action)
}
afterEach(async () => {
	for (const action of cleanup.splice(0).reverse()) await action()
	await Promise.all(
		temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })),
	)
})
export async function temp(): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "correctly-test-"))
	temporary.push(root)
	return root
}
export type TestConfig = {
	files?: string[]
	exclude?: string[]
	associations: {
		name?: string
		files: string[]
		schema: string | null
		mode?: "json" | "jsonc"
		extensions?: string[]
	}[]
	remote?: ProjectConfig["remote"]
}
export function configSource(config: TestConfig, built = false): string {
	const source = new URL("../../src/", import.meta.url)
	const core = new URL(
		built ? "../../dist/core.mjs" : "core/index.ts",
		built ? import.meta.url : source,
	).href
	const adapter = new URL(
		built ? "../../dist/ajv.mjs" : "validators/ajv.ts",
		built ? import.meta.url : source,
	).href
	const extension = new URL(
		built ? "../../dist/schemars.mjs" : "extensions/schemars.ts",
		built ? import.meta.url : source,
	).href
	const renovate = new URL(
		built ? "../../dist/renovate.mjs" : "extensions/renovate.ts",
		built ? import.meta.url : source,
	).href
	const rules = config.associations.map(
		({ schema, mode, extensions, ...rule }) => `{
  ...${JSON.stringify(rule)},
  ${mode ? `parse: ${mode}(),` : ""}
  validate: ${schema === null ? "null" : `ajv({ schema: ${JSON.stringify(schema)}, extensions: [${(extensions ?? []).map((id) => (id === "schemars@0.8.22" ? 'schemars({ version: "0.8.22" })' : id === "renovate" ? "renovate()" : JSON.stringify(id))).join(",")}] })`},
 }`,
	)
	const { associations: _rules, ...rest } = config
	return `import { defineConfig, json, jsonc } from ${JSON.stringify(core)}
import { ajv } from ${JSON.stringify(adapter)}
import { schemars } from ${JSON.stringify(extension)}
import { renovate } from ${JSON.stringify(renovate)}
export default defineConfig({ ...${JSON.stringify(rest)}, associations: [${rules.join(",\n")}] })`
}
export async function put(
	root: string,
	file: string,
	value: unknown,
): Promise<string> {
	const destination = path.join(root, file)
	await mkdir(path.dirname(destination), { recursive: true })
	await writeFile(
		destination,
		typeof value === "string"
			? value
			: file.endsWith("correctly.config.ts")
				? configSource(value as TestConfig)
				: JSON.stringify(value, null, 2),
	)
	return destination
}
export const sampleSchema = {
	$schema: "http://json-schema.org/draft-07/schema#",
	type: "object",
	required: ["name"],
	additionalProperties: false,
	properties: {
		name: { type: "string", description: "The project name" },
		color: {
			type: "string",
			enum: ["red", "blue"],
			description: "A primary color",
		},
	},
}
export async function setup(
	schema: unknown = sampleSchema,
	config?: TestConfig,
) {
	const root = await temp()
	const configPath = await put(
		root,
		"correctly.config.ts",
		config ?? {
			files: ["data/**/*.json", "data/**/*.jsonc"],
			associations: [
				{ name: "project", files: ["data/**"], schema: "schema.json" },
			],
		},
	)
	await put(root, "schema.json", schema)
	const project = await loadProject(configPath)
	return {
		root,
		configPath,
		project,
		engine: new Engine(project),
		file: path.join(root, "data/test.json"),
		uri: pathToFileURL(path.join(root, "data/test.json")).href,
	}
}
