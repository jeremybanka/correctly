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
	config?: ProjectConfig,
) {
	const root = await temp()
	const configPath = await put(
		root,
		"correctly.config.json",
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
