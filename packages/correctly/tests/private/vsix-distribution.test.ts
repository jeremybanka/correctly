import { execFileSync, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, realpath, symlink } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vite-plus/test"
import { put, temp } from "../public/helpers.ts"
import { installVscodeExtension } from "../../src/cli/vsix.ts"

const packageRoot = fileURLToPath(new URL("../../", import.meta.url))

test(
	"the packed CLI builds a version-matched VSIX using only declared production dependencies",
	{ timeout: 60_000 },
	async () => {
		const root = await temp()
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
		)[0] as { filename: string }
		const installed = path.join(root, "node_modules/correctly")
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
		) as { version: string; dependencies: Record<string, string> }
		// Link exactly the packed package's production dependencies, never the workspace's node_modules.
		for (const dependency of Object.keys(manifest.dependencies)) {
			const destination = path.join(installed, "node_modules", dependency)
			await mkdir(path.dirname(destination), { recursive: true })
			await symlink(
				await realpath(path.join(packageRoot, "node_modules", dependency)),
				destination,
				"dir",
			)
		}
		await put(
			root,
			"correctly.config.ts",
			'throw new Error("VSIX builds must not evaluate configuration")',
		)
		const bin = path.join(root, "node_modules/.bin/correctly")
		await mkdir(path.dirname(bin), { recursive: true })
		await symlink(path.join(installed, "dist/cli.mjs"), bin)
		const outdir = path.join(root, "my extensions")
		const built = spawnSync(
			process.execPath,
			[bin, "vsix", "--build-only", "-o", "my extensions"],
			{ cwd: root, encoding: "utf8", timeout: 40_000 },
		)
		expect(built.error).toBeUndefined()
		expect(built.status, built.stdout + built.stderr).toBe(0)
		const destination = path.join(outdir, `Correctly-${manifest.version}.vsix`)
		expect(built.stdout).toContain(`correctly vsix: built ${destination}.`)
		expect(existsSync(destination)).toBe(true)
		const stage = path.join(outdir, ".correctly-vsix")
		expect(
			JSON.parse(await readFile(path.join(stage, "package.json"), "utf8")),
		).toMatchObject({
			version: manifest.version,
			main: "./dist/extension.mjs",
		})
		for (const entry of ["extension", "server", "worker"])
			expect(existsSync(path.join(stage, `dist/${entry}.mjs`))).toBe(true)
		expect(existsSync(path.join(installed, "tests"))).toBe(false)
		expect(existsSync(path.join(installed, "node_modules/@types/vscode"))).toBe(
			false,
		)
	},
)

test(
	"the installer passes the VSIX path as one argument and preserves the editor's exit status",
	{ skip: process.platform === "win32" },
	async () => {
		const root = await temp()
		const executable = await put(
			root,
			"fake editor",
			`#!${process.execPath}\nimport {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(path.join(root, "args.json"))}, JSON.stringify(process.argv.slice(2))); process.exitCode = 7;\n`,
		)
		await put(root, "package.json", { type: "module" })
		await chmod(executable, 0o755)
		const vsixPath = path.join(root, "my extensions/Correctly.vsix")
		expect(
			await installVscodeExtension({
				cwd: root,
				editorCommand: executable,
				vsixPath,
			}),
		).toEqual({ exitCode: 7 })
		expect(
			JSON.parse(await readFile(path.join(root, "args.json"), "utf8")),
		).toEqual(["--install-extension", vsixPath, "--force"])
	},
)

test("the installer explains when the editor command is missing", async () => {
	const root = await temp()
	const result = await installVscodeExtension({
		cwd: root,
		editorCommand: path.join(root, "missing-editor"),
		vsixPath: path.join(root, "Correctly.vsix"),
	})
	expect(result.exitCode).toBe(1)
	expect(result.error).toContain("was not found on PATH")
	expect(result.error).toContain("--build-only")
})
