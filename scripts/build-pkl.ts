import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const crate = new URL("compatibility/pklr/", root)
const upstream = new URL("artifacts/pklr-source/", root)
const revision = "5084552234a7e5f8a691df61d80b4141cea84f4f"
const sourceHash =
	"c8feacc200ea0cac7eb16fb83f60affd3072a0aae79ce337ae156f6c05da0932"
function command(name: string, args: string[]): void {
	const result = spawnSync(name, args, {
		cwd: fileURLToPath(upstream),
		encoding: "utf8",
	})
	if (result.error) throw result.error
	if (result.status !== 0) throw new Error(result.stderr)
}
await mkdir(upstream, { recursive: true })
const archive = new URL("artifacts/pklr-source.tar.gz", root)
let source: Buffer
try {
	source = await readFile(archive)
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
	const response = await fetch(
		`https://codeload.github.com/jdx/pklr/tar.gz/${revision}`,
	)
	if (!response.ok)
		throw new Error(`Cannot download pklr source: HTTP ${response.status}`)
	source = Buffer.from(await response.arrayBuffer())
}
if (createHash("sha256").update(source).digest("hex") !== sourceHash)
	throw new Error("pklr source checksum mismatch")
await writeFile(archive, source)
// Only generated sources are modified. The patch stays reviewable in Git.
command("tar", ["-xzf", fileURLToPath(archive), "--strip-components=1"])
command("patch", [
	"--batch",
	"-p1",
	"-i",
	fileURLToPath(new URL("inherited-types.patch", crate)),
])
const cargoHome = process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo")
const env = {
	...process.env,
	CARGO_TARGET_DIR: fileURLToPath(new URL("artifacts/pklr-target", root)),
	RUSTC_WRAPPER: fileURLToPath(new URL("scripts/pkl-rustc.ts", root)),
	RUSTFLAGS: `${process.env.RUSTFLAGS ?? ""} --remap-path-prefix=${fileURLToPath(root)}=/correctly/ --remap-path-prefix=${cargoHome}=/cargo`,
}
const result = spawnSync(
	"cargo",
	["build", "--locked", "--release", "--target", "wasm32-unknown-unknown"],
	{ cwd: fileURLToPath(crate), stdio: "inherit", env },
)
if (result.error) throw result.error
if (result.status !== 0) throw new Error("pklr WASM build failed")
const bytes = await readFile(
	new URL(
		"artifacts/pklr-target/wasm32-unknown-unknown/release/correctly_pklr.wasm",
		root,
	),
)
const destination = new URL("packages/correctly/src/core/pklr.wasm", root)
const metadata = spawnSync(
	"cargo",
	["metadata", "--locked", "--format-version", "1"],
	{ cwd: fileURLToPath(crate), encoding: "utf8", env },
)
if (metadata.status !== 0) throw new Error(metadata.stderr)
const packages = (
	JSON.parse(metadata.stdout) as {
		packages: {
			name: string
			version: string
			license: string
			manifest_path: string
		}[]
	}
).packages
let licenses = "Bundled pklr WASM dependencies\n\n"
for (const pkg of packages.sort((a, b) => a.name.localeCompare(b.name))) {
	if (pkg.name === "correctly-pklr") continue
	const directory = path.dirname(pkg.manifest_path)
	licenses += `\n${pkg.name} ${pkg.version} (${pkg.license})\n${"=".repeat(60)}\n`
	for (const file of (await readdir(directory))
		.filter((name) => /^(?:licen[sc]e|copying)(?:[.-]|$)/i.test(name))
		.sort()) {
		const entry = path.join(directory, file)
		if ((await stat(entry)).isFile())
			licenses += `\n${file}\n${await readFile(entry, "utf8")}\n`
	}
}
const licenseFile = new URL("packages/correctly/src/core/pklr.LICENSE", root)
if (process.argv.includes("--check")) {
	if (!bytes.equals(await readFile(destination)))
		throw new Error("pklr.wasm is stale; run pnpm build:pkl")
	if (licenses !== (await readFile(licenseFile, "utf8")))
		throw new Error("pklr.LICENSE is stale; run pnpm build:pkl")
} else {
	await writeFile(destination, bytes)
	await writeFile(licenseFile, licenses)
}
console.log(`pklr WASM: ${bytes.length} bytes`)
