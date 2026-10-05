import { spawn } from "node:child_process"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { bundleEditor } from "./editor-bundle.ts"

async function run(command: string, args: string[], cwd: string) {
	const child = spawn(command, args, { cwd, stdio: "inherit" })
	const code = await new Promise<number | null>((resolve, reject) => {
		child.on("error", reject)
		child.on("close", resolve)
	})
	if (code !== 0) throw new Error(`${command} failed with exit code ${code}`)
}

export async function buildZed(
	packageRoot: string,
	outdir: string,
): Promise<string> {
	const source = path.join(packageRoot, "src/zed")
	const buildRoot = path.join(outdir, ".correctly-zed")
	await rm(buildRoot, { force: true, recursive: true })
	await mkdir(path.join(buildRoot, "dist"), { recursive: true })
	for (const entry of ["Cargo.toml", "Cargo.lock", "src"])
		await cp(path.join(source, entry), path.join(buildRoot, entry), {
			recursive: true,
		})
	await bundleEditor(
		packageRoot,
		path.join(buildRoot, "dist"),
		[
			["lsp/server", "server"],
			["runtime/worker", "worker"],
		],
		false,
	)
	const { version } = JSON.parse(
		await readFile(path.join(packageRoot, "package.json"), "utf8"),
	) as { version: string }
	await writeFile(path.join(buildRoot, "dist/version.txt"), version)
	const target = path.join(outdir, ".correctly-zed-target")
	await run(
		"cargo",
		[
			"build",
			"--locked",
			"--release",
			"--target",
			"wasm32-wasip2",
			"--target-dir",
			target,
		],
		buildRoot,
	)
	const directory = path.join(outdir, `Correctly-${version}.zed`)
	await rm(directory, { force: true, recursive: true })
	await mkdir(directory, { recursive: true })
	await cp(
		path.join(target, "wasm32-wasip2/release/correctly_zed.wasm"),
		path.join(directory, "extension.wasm"),
	)
	const manifest = await readFile(path.join(source, "extension.toml"), "utf8")
	await writeFile(
		path.join(directory, "extension.toml"),
		manifest.replace('version = "0.0.0"', `version = "${version}"`),
	)
	await cp(path.join(packageRoot, "LICENSE"), path.join(directory, "LICENSE"))
	await cp(path.join(source, "README.md"), path.join(directory, "README.md"))
	const archive = `${directory}.tar.gz`
	await run(
		"tar",
		["-czf", archive, "-C", outdir, path.basename(directory)],
		outdir,
	)
	return archive
}

if (
	process.argv[1] &&
	pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
	const packageRoot = fileURLToPath(new URL("../../", import.meta.url))
	const output = await buildZed(
		packageRoot,
		path.resolve(packageRoot, "../../artifacts"),
	)
	process.stdout.write(`${output}\n`)
}
