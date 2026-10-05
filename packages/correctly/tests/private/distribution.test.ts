import { existsSync } from "node:fs"
import { cp, readFile, symlink } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { beforeAll, describe, expect, test } from "vite-plus/test"
import type { CompletionList, Hover } from "vscode-languageserver/node"
import {
	setup,
	temp,
	put,
	configSource,
	type TestConfig,
} from "../public/helpers.ts"
import { lspClient } from "../public/lsp-client.ts"

const packageRoot = fileURLToPath(new URL("../../", import.meta.url))
const repoRoot = path.resolve(packageRoot, "../..")
async function builtProject(schema?: unknown, config?: TestConfig) {
	const result = await setup(schema, config)
	await put(
		result.root,
		"correctly.config.ts",
		configSource(
			config ?? {
				files: ["data/**"],
				associations: [{ files: ["data/**"], schema: "schema.json" }],
			},
			true,
		),
	)
	return result
}
const stage = path.join(repoRoot, "artifacts/.correctly-vsix")
describe("bundled distribution", () => {
	beforeAll(() => {
		if (
			!existsSync(stage) ||
			!existsSync(path.join(packageRoot, "dist/cli.mjs"))
		)
			throw new Error(
				"Run pnpm run build and pnpm run build:vsix before pnpm run test:distribution.",
			)
	})
	test("VSIX stages a thin client and a fully bundled stdio server", async () => {
		const { root, uri } = await builtProject()
		const isolated = await temp()
		await cp(stage, path.join(isolated, "extension"), { recursive: true })
		const manifest = JSON.parse(
			await readFile(path.join(isolated, "extension/package.json"), "utf8"),
		) as {
			main: string
			version: string
			engines: { vscode: string }
			capabilities: { untrustedWorkspaces: { supported: boolean } }
		}
		const pkg = JSON.parse(
			await readFile(path.join(packageRoot, "package.json"), "utf8"),
		) as { version: string }
		expect(manifest.main).toBe("./dist/extension.mjs")
		expect(manifest.version).toBe(pkg.version)
		expect(manifest.engines.vscode).toBe("^1.105.0")
		expect(manifest.capabilities.untrustedWorkspaces.supported).toBe(false)
		expect(existsSync(path.join(isolated, "extension/dist/worker.mjs"))).toBe(
			true,
		)
		expect(existsSync(path.join(isolated, "extension/node_modules"))).toBe(
			false,
		)
		const client = await lspClient(
			[root],
			path.join(isolated, "extension/dist/server.mjs"),
			isolated,
		)
		await client.open(uri, '{"name":2}')
		expect((await client.wait(uri, 1)).diagnostics[0]?.code).toBe("schema/type")
		await client.change(uri, '{"name":"valid", ""}', 2)
		expect(
			(
				await client.request<CompletionList>("textDocument/completion", uri, {
					line: 0,
					character: 18,
				})
			).items.map((i) => i.label),
		).toContain("color")
		expect(
			JSON.stringify(
				await client.request<Hover>("textDocument/hover", uri, {
					line: 0,
					character: 3,
				}),
			),
		).toContain("The project name")
		await put(root, "schema.json", {
			anyOf: [{ type: "string" }, { type: "number" }],
		})
		await client.connection.sendNotification(
			"workspace/didChangeWatchedFiles",
			{
				changes: [
					{ uri: pathToFileURL(path.join(root, "schema.json")).href, type: 2 },
				],
			},
		)
		await client.change(uri, "false", 3)
		const updated = await client.wait(uri, 3)
		expect(updated.diagnostics).toHaveLength(1)
		expect(updated.diagnostics[0]?.code).toBe("schema/anyOf")
		expect(
			updated.diagnostics[0]?.relatedInformation?.map((d) => d.message),
		).toEqual([
			"Alternative 1: /: must be string",
			"Alternative 2: /: must be number",
		])
	})
	test("project-local package imports and config logging work in CLI and isolated VSIX", async () => {
		const root = await temp()
		await put(root, "node_modules/company-validator/package.json", {
			name: "company-validator",
			type: "module",
			exports: "./index.js",
		})
		await symlink(packageRoot, path.join(root, "node_modules/correctly"), "dir")
		await put(
			root,
			"node_modules/company-validator/index.js",
			`import { diagnostic } from "correctly"; export const validator = { id: "company", accepts: ["json"], prepare: () => ({ validate: ({text,parsed}) => parsed.value === 42 ? [] : [diagnostic(text,"company","Expected 42")] }) }`,
		)
		await put(
			root,
			"correctly.config.ts",
			`import {defineConfig,json} from "correctly"; import {validator} from "company-validator"; console.log("config log"); process.stdout.write("direct log\\n"); export default defineConfig({ files:["*.txt"], associations:[{files:["*.txt"],parse:json(),validate:validator}] })`,
		)
		await put(root, "value.txt", "41")
		const run = spawnSync(
			process.execPath,
			[path.join(packageRoot, "dist/cli.mjs"), "check", "--format=json"],
			{ cwd: root, encoding: "utf8" },
		)
		expect(run.status).toBe(1)
		expect(JSON.parse(run.stdout)).toMatchObject({
			reportVersion: 2,
			summary: { validated: 1, schemaCovered: 0 },
			files: [{ coverage: "validated", diagnostics: [{ code: "company" }] }],
		})
		expect(run.stderr).toContain("config log")
		expect(run.stderr).toContain("direct log")
		const isolated = await temp()
		await cp(stage, path.join(isolated, "extension"), { recursive: true })
		const client = await lspClient(
			[root],
			path.join(isolated, "extension/dist/server.mjs"),
			isolated,
		)
		const uri = pathToFileURL(path.join(root, "value.txt")).href
		await client.open(uri, "41", 1, "plaintext")
		expect((await client.wait(uri, 1)).diagnostics[0]?.code).toBe("company")
		expect(
			(
				await client.request<CompletionList>("textDocument/completion", uri, {
					line: 0,
					character: 0,
				})
			).items,
		).toEqual([])
		await client.change(uri, "42", 2)
		expect((await client.wait(uri, 2)).diagnostics).toEqual([])
	})

	test("built CLI runs and emits a pure JSON report", async () => {
		const { root } = await builtProject()
		await put(root, "data/test.json", { name: "ok" })
		const result = spawnSync(
			process.execPath,
			[path.join(packageRoot, "dist/cli.mjs"), "check", "--format=json"],
			{ cwd: root, encoding: "utf8" },
		)
		expect(result.status).toBe(0)
		expect(result.stderr).toBe("")
		expect(JSON.parse(result.stdout)).toMatchObject({
			reportVersion: 2,
			summary: { checked: 1, schemaCovered: 1 },
		})
		await put(root, "schema.json", {
			anyOf: [{ type: "string" }, { type: "number" }],
		})
		await put(root, "data/test.json", "false")
		const json = spawnSync(
			process.execPath,
			[path.join(packageRoot, "dist/cli.mjs"), "check", "--format=json"],
			{ cwd: root, encoding: "utf8" },
		)
		expect(json.status).toBe(1)
		expect(JSON.parse(json.stdout).files[0].diagnostics).toMatchObject([
			{ code: "schema/type", context: { parent: 2, label: "Alternative 1" } },
			{ code: "schema/type", context: { parent: 2, label: "Alternative 2" } },
			{ code: "schema/anyOf" },
		])
		const readable = spawnSync(
			process.execPath,
			[path.join(packageRoot, "dist/cli.mjs"), "check"],
			{
				cwd: root,
				encoding: "utf8",
				env: { ...process.env, FORCE_COLOR: "0" },
			},
		)
		expect(readable.status).toBe(1)
		expect(readable.stdout).toContain("data/test.json  1 error")
		expect(readable.stdout).toContain("Alternative 1")
		expect(readable.stdout).toContain("Alternative 2")
	})
	test("built CLI and isolated VSIX both ship the opt-in extension catalog", async () => {
		const { root, uri, configPath } = await builtProject({
			type: "integer",
			format: "uint16",
		})
		await put(root, "data/test.json", "65536")
		const run = () =>
			spawnSync(
				process.execPath,
				[path.join(packageRoot, "dist/cli.mjs"), "check", "--format=json"],
				{ cwd: root, encoding: "utf8" },
			)
		const missing = run()
		expect(missing.status).toBe(2)
		expect(JSON.parse(missing.stdout).failures).toMatchObject([
			{
				code: "extension-required",
				details: { suggestedExtension: "@correctlyjs/schemars" },
			},
		])
		const isolated = await temp()
		await cp(stage, path.join(isolated, "extension"), { recursive: true })
		const client = await lspClient(
			[root],
			path.join(isolated, "extension/dist/server.mjs"),
			isolated,
		)
		await client.open(uri, "65536")
		expect((await client.wait(uri, 1)).diagnostics[0]?.code).toBe(
			"extension-required",
		)
		const config = {
			files: ["data/**"],
			associations: [
				{
					files: ["data/**"],
					schema: "schema.json",
					extensions: ["schemars@0.8.22"],
				},
			],
		}
		await put(root, "correctly.config.ts", configSource(config, true))
		const enabled = run()
		expect(enabled.status).toBe(1)
		expect(JSON.parse(enabled.stdout).files[0].diagnostics[0].code).toBe(
			"schema/format",
		)
		const count = client.notifications.length
		await client.connection.sendNotification(
			"workspace/didChangeWatchedFiles",
			{ changes: [{ uri: pathToFileURL(configPath).href, type: 2 }] },
		)
		expect((await client.wait(uri, 1, count)).diagnostics[0]?.code).toBe(
			"schema/format",
		)
		await client.change(uri, "65535", 2)
		expect((await client.wait(uri, 2)).diagnostics).toEqual([])
	})
})
