import { existsSync } from "node:fs"
import { cp, readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, test } from "vite-plus/test"
import type { CompletionList, Hover } from "vscode-languageserver/node"
import { setup, temp, put } from "../public/helpers.ts"
import { lspClient } from "../public/lsp-client.ts"

const packageRoot = fileURLToPath(new URL("../../", import.meta.url))
const repoRoot = path.resolve(packageRoot, "../..")
const stage = path.join(repoRoot, "artifacts/.correctly-vsix")
describe.runIf(
	existsSync(stage) && existsSync(path.join(packageRoot, "dist/cli.mjs")),
)("bundled distribution", () => {
	test("VSIX stages a thin client and a fully bundled stdio server", async () => {
		const { root, uri } = await setup()
		const isolated = await temp()
		await cp(stage, path.join(isolated, "extension"), { recursive: true })
		const manifest = JSON.parse(
			await readFile(path.join(isolated, "extension/package.json"), "utf8"),
		) as { main: string; version: string }
		const pkg = JSON.parse(
			await readFile(path.join(packageRoot, "package.json"), "utf8"),
		) as { version: string }
		expect(manifest.main).toBe("./dist/extension.mjs")
		expect(manifest.version).toBe(pkg.version)
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
	test("built CLI runs and emits a pure JSON report", async () => {
		const { root } = await setup()
		await put(root, "data/test.json", { name: "ok" })
		const result = spawnSync(
			process.execPath,
			[path.join(packageRoot, "dist/cli.mjs"), "check", "--format=json"],
			{ cwd: root, encoding: "utf8" },
		)
		expect(result.status).toBe(0)
		expect(result.stderr).toBe("")
		expect(JSON.parse(result.stdout)).toMatchObject({
			reportVersion: 1,
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
})
