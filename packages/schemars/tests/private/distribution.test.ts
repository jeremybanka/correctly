import { execFileSync, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { cp, mkdir, readFile, symlink } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, test } from "vite-plus/test"
import { temp, put } from "../../../correctly/tests/public/helpers.ts"
import { lspClient } from "../../../correctly/tests/public/lsp-client.ts"

const packageRoot = fileURLToPath(new URL("../../", import.meta.url))
const coreRoot = path.resolve(packageRoot, "../correctly")
const stage = path.resolve(packageRoot, "../../artifacts/.correctly-vsix")
describe.runIf(
	existsSync(path.join(packageRoot, "dist/index.mjs")) &&
		existsSync(path.join(packageRoot, "dist/ajv.mjs")) &&
		existsSync(stage),
)("published extension boundary", () => {
	test(
		"the packed plugin is installed by the project and shared by CLI and isolated VSIX",
		{ timeout: 20_000 },
		async () => {
			const root = await temp()
			await mkdir(path.join(root, "node_modules"))
			await symlink(coreRoot, path.join(root, "node_modules/correctly"), "dir")
			const config = (enabled: boolean) => `
import { defineConfig } from "correctly"
import { ajv } from "correctly/validators/ajv"
${enabled ? 'import { schemars } from "@correctlyjs/schemars/ajv"' : ""}
export default defineConfig({ files: ["data.json"], associations: [{ files: ["data.json"], validate: ajv({schema:"schema.json", extensions: [${enabled ? 'schemars({version:">=0.8.15 <=0.8.22"})' : ""}]}) }] })`
			await put(root, "correctly.config.ts", config(false))
			await put(root, "schema.json", {
				type: "object",
				properties: {
					limit: {
						type: "integer",
						format: "uint16",
						description: "Configured limit",
					},
				},
			})
			await put(root, "data.json", { limit: 65536 })
			const run = () =>
				spawnSync(
					process.execPath,
					[path.join(coreRoot, "dist/cli.mjs"), "check", "--format=json"],
					{ cwd: root, encoding: "utf8" },
				)
			const missing = run()
			expect(missing.status).toBe(2)
			expect(JSON.parse(missing.stdout).failures[0]).toMatchObject({
				code: "extension-required",
				details: { suggestedExtension: "@correctlyjs/schemars" },
			})
			expect(
				existsSync(path.join(root, "node_modules/@correctlyjs/schemars")),
			).toBe(false)
			const isolated = await temp()
			await cp(stage, path.join(isolated, "extension"), { recursive: true })
			const client = await lspClient(
				[root],
				path.join(isolated, "extension/dist/server.mjs"),
				isolated,
			)
			const uri = pathToFileURL(path.join(root, "data.json")).href
			await client.open(uri, '{"limit":65536}')
			expect((await client.wait(uri, 1)).diagnostics[0]?.code).toBe(
				"extension-required",
			)

			const packed = JSON.parse(
				execFileSync(
					"npm",
					["pack", "--ignore-scripts", "--json", "--pack-destination", root],
					{
						cwd: packageRoot,
						encoding: "utf8",
						stdio: ["ignore", "pipe", "pipe"],
					},
				),
			)[0] as { filename: string; files: { path: string }[] }
			expect(
				packed.files.some(
					(file) =>
						file.path.startsWith("tests/") || file.path.endsWith("Cargo.lock"),
				),
			).toBe(false)
			const installed = path.join(root, "node_modules/@correctlyjs/schemars")
			await mkdir(installed, { recursive: true })
			execFileSync("tar", [
				"-xzf",
				path.join(root, packed.filename),
				"--strip-components=1",
				"-C",
				installed,
			])
			const manifest = JSON.parse(
				await readFile(path.join(installed, "package.json"), "utf8"),
			)
			expect(manifest).toMatchObject({
				name: "@correctlyjs/schemars",
				peerDependencies: { correctly: "^0.1.0" },
				publishConfig: { access: "public" },
			})
			expect(manifest.dependencies).toBeUndefined()
			const exports = JSON.parse(
				execFileSync(
					process.execPath,
					[
						"--input-type=module",
						"--eval",
						`import * as catalog from "@correctlyjs/schemars";
import * as backend from "@correctlyjs/schemars/ajv";
console.log(JSON.stringify({ root: Object.keys(catalog), ajv: Object.keys(backend), versions: catalog.schemarsEras.flatMap(era => era.versions) }));`,
					],
					{ cwd: root, encoding: "utf8" },
				),
			)
			expect(exports).toMatchObject({
				root: ["schemarsEras"],
				ajv: ["schemars"],
			})
			expect(exports.versions).toContain("0.8.22")
			await put(root, "package.json", { type: "module" })
			await cp(
				new URL("../public/config-types.ts", import.meta.url),
				path.join(root, "config-types.ts"),
			)
			await put(root, "tsconfig.json", {
				compilerOptions: {
					strict: true,
					noEmit: true,
					skipLibCheck: true,
					module: "NodeNext",
					target: "ES2024",
					types: [],
				},
				files: ["config-types.ts"],
			})
			const types = spawnSync(
				process.execPath,
				[
					fileURLToPath(
						new URL("bin/tsc", import.meta.resolve("typescript/package.json")),
					),
					"-p",
					root,
				],
				{ cwd: root, encoding: "utf8", timeout: 10_000 },
			)
			expect(types.error).toBeUndefined()
			expect(types.status, types.stdout + types.stderr).toBe(0)
			const core = JSON.parse(
				await readFile(path.join(coreRoot, "package.json"), "utf8"),
			)
			expect(core.dependencies[manifest.name]).toBeUndefined()
			expect(core.exports["./extensions/schemars"]).toBeUndefined()
			await put(root, "correctly.config.ts", config(true))
			const invalid = run()
			expect(invalid.status).toBe(1)
			expect(JSON.parse(invalid.stdout).files[0].diagnostics[0].code).toBe(
				"schema/format",
			)
			const count = client.notifications.length
			await client.connection.sendNotification(
				"workspace/didChangeWatchedFiles",
				{
					changes: [
						{
							uri: pathToFileURL(path.join(root, "correctly.config.ts")).href,
							type: 2,
						},
					],
				},
			)
			expect((await client.wait(uri, 1, count)).diagnostics[0]?.code).toBe(
				"schema/format",
			)
			await put(root, "data.json", { limit: 65535 })
			expect(run().status).toBe(0)
			await client.change(uri, '{"limit":65535}', 2)
			expect((await client.wait(uri, 2)).diagnostics).toEqual([])
			expect(
				JSON.stringify(
					await client.request("textDocument/hover", uri, {
						line: 0,
						character: 3,
					}),
				),
			).toContain("Configured limit")
		},
	)
})
