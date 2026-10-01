import { existsSync } from "node:fs"
import { cp, readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
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
		expect(manifest.main).toBe("./dist/extension.mjs")
		expect(manifest.version).toBe("0.0.1")
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
	})
})
