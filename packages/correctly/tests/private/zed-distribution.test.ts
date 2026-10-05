import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { beforeAll, expect, test } from "vite-plus/test"
import type { CompletionList, Hover } from "vscode-languageserver/node"
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser"
import { configSource, put, setup, temp } from "../public/helpers.ts"
import { lspClient } from "../public/lsp-client.ts"

const packageRoot = fileURLToPath(new URL("../../", import.meta.url))
const artifacts = path.resolve(packageRoot, "../../artifacts")
const { version } = JSON.parse(
	await readFile(path.join(packageRoot, "package.json"), "utf8"),
) as { version: string }
const name = `Correctly-${version}.zed`
const archive = path.join(artifacts, `${name}.tar.gz`)

beforeAll(() => {
	if (!existsSync(archive))
		throw new Error("Run pnpm build:zed before pnpm test:distribution.")
})

async function extracted() {
	const root = await temp()
	const result = spawnSync("tar", ["-xzf", archive, "-C", root], {
		encoding: "utf8",
	})
	if (result.error) throw result.error
	expect(result.status, result.stderr).toBe(0)
	return path.join(root, name)
}

async function embeddedServer() {
	const extension = await extracted()
	const wasm = await readFile(path.join(extension, "extension.wasm"))
	const root = await temp()
	// Exercise bytes carried by the distributable WASM, without resolving
	// server dependencies from the repository or copying a staging server.
	for (const name of ["server.mjs", "worker.mjs"]) {
		const bundled = await readFile(
			path.join(artifacts, ".correctly-zed/dist", name),
		)
		const offset = wasm.indexOf(bundled)
		expect(offset, `WASM must embed the complete ${name}`).toBeGreaterThan(-1)
		await put(
			root,
			name,
			wasm.subarray(offset, offset + bundled.length).toString(),
		)
	}
	return { root, entry: path.join(root, "server.mjs") }
}

async function project() {
	const result = await setup()
	await put(
		result.root,
		"correctly.config.ts",
		configSource(
			{
				files: ["data/**"],
				associations: [{ files: ["data/**"], schema: "schema.json" }],
			},
			true,
		),
	)
	return result
}

test("Zed archive sideloads precompiled WASM without a Rust build or new grammar", async () => {
	const directory = await extracted()
	expect((await readdir(directory)).sort()).toEqual([
		"LICENSE",
		"README.md",
		"extension.toml",
		"extension.wasm",
	])
	const manifest = await readFile(
		path.join(directory, "extension.toml"),
		"utf8",
	)
	const parsed = getStaticTOMLValue(parseTOML(manifest))
	expect(parsed).toMatchObject({
		id: "correctly",
		version,
		schema_version: 1,
		language_servers: {
			correctly: {
				languages: ["JSON", "JSONC", "YAML", "TOML"],
				opt_in_languages: ["JSON", "JSONC", "YAML", "TOML"],
				language_ids: {
					JSON: "json",
					JSONC: "jsonc",
					YAML: "yaml",
					TOML: "toml",
				},
			},
		},
	})
	expect(parsed).not.toHaveProperty("lib")
	const wasm = await readFile(path.join(directory, "extension.wasm"))
	expect([...wasm.subarray(0, 8)]).toEqual([0, 97, 115, 109, 13, 0, 1, 0])
	const apiSection = wasm.indexOf(Buffer.from("zed:api-version"))
	expect(apiSection).toBeGreaterThan(-1)
	expect([
		...wasm.subarray(
			apiSection + "zed:api-version".length,
			apiSection + "zed:api-version".length + 6,
		),
	]).toEqual([0, 0, 0, 7, 0, 0])
})

test.each(["json", "jsonc", "yaml", "toml"] as const)(
	"Zed's embedded server and worker validate unsaved %s buffers in isolation",
	async (mode) => {
		const { root } = await project()
		const isolated = await embeddedServer()
		expect(existsSync(path.join(isolated.root, "node_modules"))).toBe(false)
		const client = await lspClient([root], isolated.entry, isolated.root, true)
		const uri = pathToFileURL(path.join(root, `data/test.${mode}`)).href
		const text = (value: string) =>
			mode === "yaml"
				? `name: ${value}`
				: mode === "toml"
					? `name = ${value}`
					: `${mode === "jsonc" ? "// project\n" : ""}{"name":${value}}`
		await client.open(uri, text("42"), 1, mode)
		expect((await client.wait(uri, 1)).diagnostics[0]?.code).toBe("schema/type")
		await client.change(uri, text('"valid"'), 2)
		expect((await client.wait(uri, 2)).diagnostics).toEqual([])
		expect(client.registrations).toContainEqual({
			registrations: [
				expect.objectContaining({
					method: "workspace/didChangeWatchedFiles",
					registerOptions: { watchers: [{ globPattern: "**/*" }] },
				}),
			],
		})
	},
)

test("Zed's embedded server supplies hints and reloads saved schemas and executable config", async () => {
	const { root, uri, configPath } = await project()
	const isolated = await embeddedServer()
	const client = await lspClient([root], isolated.entry, isolated.root, true)
	await client.open(uri, '{"name":"valid", ""}')
	expect(
		(
			await client.request<CompletionList>("textDocument/completion", uri, {
				line: 0,
				character: 18,
			})
		).items.map((item) => item.label),
	).toContain("color")
	expect(
		JSON.stringify(
			await client.request<Hover>("textDocument/hover", uri, {
				line: 0,
				character: 3,
			}),
		),
	).toContain("The project name")
	await client.change(uri, '{"name":"valid"}', 2)
	expect((await client.wait(uri, 2)).diagnostics).toEqual([])
	await put(root, "schema.json", { type: "number" })
	let count = client.notifications.length
	await client.connection.sendNotification("workspace/didChangeWatchedFiles", {
		changes: [
			{ uri: pathToFileURL(path.join(root, "schema.json")).href, type: 2 },
		],
	})
	expect((await client.wait(uri, 2, count)).diagnostics[0]?.code).toBe(
		"schema/type",
	)
	await put(
		root,
		"correctly.config.ts",
		configSource(
			{
				files: ["data/**"],
				associations: [{ files: ["data/**"], schema: null }],
			},
			true,
		),
	)
	count = client.notifications.length
	await client.connection.sendNotification("workspace/didChangeWatchedFiles", {
		changes: [{ uri: pathToFileURL(configPath).href, type: 2 }],
	})
	expect((await client.wait(uri, 2, count)).diagnostics).toEqual([])
})
