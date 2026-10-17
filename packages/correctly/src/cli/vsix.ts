import { spawn } from "node:child_process"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { bundleEditor } from "./editor-bundle.ts"

export function defaultPackageRoot(): string {
	const directory = path.dirname(fileURLToPath(import.meta.url))
	return path.resolve(
		directory,
		path.basename(path.dirname(directory)) === "src" ? "../.." : "..",
	)
}

export async function buildVsix(
	packageRoot: string,
	outdir: string,
): Promise<string> {
	const buildRoot = path.join(outdir, ".correctly-vsix")
	await rm(buildRoot, { force: true, recursive: true })
	await mkdir(path.join(buildRoot, "dist"), { recursive: true })
	await bundleEditor(packageRoot, path.join(buildRoot, "dist"), [
		["vscode/extension", "extension"],
		["lsp/server", "server"],
		["runtime/worker", "worker"],
	])
	const pkg = JSON.parse(
		await readFile(path.join(packageRoot, "package.json"), "utf8"),
	) as { version: string }
	const manifest = JSON.parse(
		await readFile(path.join(packageRoot, "src/vscode/package.json"), "utf8"),
	) as { version: string }
	manifest.version = pkg.version
	await writeFile(
		path.join(buildRoot, "package.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	)
	await cp(path.join(packageRoot, "LICENSE"), path.join(buildRoot, "LICENSE"))
	await cp(
		path.join(packageRoot, "src/vscode/README.md"),
		path.join(buildRoot, "README.md"),
	)
	const require = createRequire(import.meta.url)
	const vsceRoot = path.dirname(require.resolve("@vscode/vsce/package.json"))
	const destination = path.join(outdir, `Correctly-${pkg.version}.vsix`)
	const child = spawn(
		process.execPath,
		[
			path.join(vsceRoot, "vsce"),
			"package",
			"--no-dependencies",
			"--allow-missing-repository",
			"--out",
			destination,
		],
		{ cwd: buildRoot, stdio: "inherit" },
	)
	const code = await new Promise<number | null>((resolve, reject) => {
		child.on("error", reject)
		child.on("close", resolve)
	})
	if (code !== 0) throw new Error(`VSCE failed with exit code ${code}`)
	return destination
}

export type VscodeInstallRequest = {
	cwd: string
	editorCommand: string
	vsixPath: string
}
export type VscodeInstallResult = { exitCode: number; error?: string }

export async function installVscodeExtension({
	cwd,
	editorCommand,
	vsixPath,
}: VscodeInstallRequest): Promise<VscodeInstallResult> {
	const child = spawn(
		editorCommand,
		["--install-extension", vsixPath, "--force"],
		{ cwd, stdio: "inherit" },
	)
	return new Promise((resolve) => {
		child.on("error", (error: NodeJS.ErrnoException) => {
			resolve({
				exitCode: 1,
				error:
					error.code === "ENOENT"
						? `${editorCommand} was not found on PATH. Install its shell command or use --target or --build-only.`
						: error.message,
			})
		})
		child.on("close", (exitCode, signal) => {
			resolve(
				signal
					? {
							exitCode: 1,
							error: `${editorCommand} exited from signal ${signal}.`,
						}
					: { exitCode: exitCode ?? 1 },
			)
		})
	})
}
