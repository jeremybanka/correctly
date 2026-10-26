import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach } from "vite-plus/test"
import { Engine, loadProject } from "../../../correctly/src/core/index.ts"

const temporary: string[] = []
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	)
})
export async function temp(): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "schemars-test-"))
	temporary.push(root)
	return root
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
		typeof value === "string" ? value : JSON.stringify(value, null, 2),
	)
	return destination
}
export type TestConfig = {
	associations: {
		files: string[]
		schema: string
		extensions: string[]
	}[]
}

// Exercise executable configuration against both current workspace packages.
export async function setup(schema: unknown, config: TestConfig) {
	const root = await temp()
	const core = new URL("../../../correctly/src/core/index.ts", import.meta.url)
		.href
	const adapter = new URL(
		"../../../correctly/src/validators/ajv.ts",
		import.meta.url,
	).href
	const extension = new URL("../../src/ajv.ts", import.meta.url).href
	const rules = config.associations.map(
		({ schema, extensions, ...rule }) => `{
		...${JSON.stringify(rule)},
		validate: ajv({ schema: ${JSON.stringify(schema)}, extensions: [${extensions.map((id) => `schemars({ version: ${JSON.stringify(id.slice("schemars@".length))} })`).join(",")}] }),
	}`,
	)
	const configPath = await put(
		root,
		"correctly.config.ts",
		`
import { defineConfig } from ${JSON.stringify(core)}
import { ajv } from ${JSON.stringify(adapter)}
import { schemars } from ${JSON.stringify(extension)}
export default defineConfig({ associations: [${rules.join(",")}] })
`,
	)
	await put(root, "schema.json", schema)
	const project = await loadProject(configPath)
	return {
		engine: new Engine(project),
		file: path.join(root, "data/test.json"),
	}
}
