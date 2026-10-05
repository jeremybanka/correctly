import { execFileSync, spawnSync } from "node:child_process"
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vite-plus/test"
import { temp } from "../../../correctly/tests/public/helpers.ts"
import {
	CATALOG,
	FIXTURES,
	PROBE,
} from "../../../../scripts/schemars-contract.ts"

// Exercise the actual CI entry point, Git base comparison, and exit status.
// Cargo's real output is verified separately by test:schemars; here a substitute
// lets us exercise hypothetical upstream releases without network or Rust.
test.each([
	{ changed: false, extended: false, code: "SCHEMARS_ERA_EXTENSION_REQUIRED" },
	{ changed: true, extended: false, code: "SCHEMARS_NEW_ERA_REQUIRED" },
	{ changed: false, extended: true, code: "SCHEMARS_CHANGESET_REQUIRED" },
])("the CI process fails with $code", async ({ changed, extended, code }) => {
	const root = await temp()
	const put = async (file: string, text: string) => {
		await mkdir(path.dirname(path.join(root, file)), { recursive: true })
		await writeFile(path.join(root, file), text)
	}
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: root,
			stdio: "pipe",
		})
	for (const file of [
		"scripts/check-schemars.ts",
		"scripts/schemars-contract.ts",
		"packages/schemars/src/eras.ts",
		"packages/schemars/src/select-era.ts",
	]) {
		await put(file, "")
		await copyFile(
			new URL(`../../../../${file}`, import.meta.url),
			path.join(root, file),
		)
	}
	const corpus = { schemas: { Uint8: { type: "integer", format: "uint8" } } }
	const manifest = (version: string) =>
		`schemars = { version = "=${version}" }\n`
	const lock = (version: string) =>
		["schemars", "schemars_derive"]
			.map((name) => `[[package]]\nname = "${name}"\nversion = "${version}"\n`)
			.join("\n")
	const catalog = { eras: [{ since: "0.8.21", versions: ["0.8.21"] }] }
	await put("package.json", '{"type":"module"}')
	await put(
		CATALOG,
		`export const schemarsEras = ${JSON.stringify(catalog.eras)} as const`,
	)
	await put(`${FIXTURES}/eras/0.8.21.json`, JSON.stringify(corpus))
	await put(`${FIXTURES}/eras/0.8.21.rs`, "// frozen generator")
	await put(`${FIXTURES}/versions/0.8.21/Cargo.toml`, manifest("0.8.21"))
	await put(`${FIXTURES}/versions/0.8.21/Cargo.lock`, lock("0.8.21"))
	await put(PROBE, manifest("0.8.21"))
	await put(path.join(path.dirname(PROBE), "Cargo.lock"), lock("0.8.21"))
	git("init", "--quiet")
	git("add", ".")
	git(
		"-c",
		"user.name=Correctly test",
		"-c",
		"user.email=test@example.com",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--quiet",
		"-m",
		"Reviewed release",
	)
	await put(PROBE, manifest("0.8.22"))
	await put(path.join(path.dirname(PROBE), "Cargo.lock"), lock("0.8.22"))
	if (extended) {
		catalog.eras[0]!.versions.push("0.8.22")
		await put(
			CATALOG,
			`export const schemarsEras = ${JSON.stringify(catalog.eras)} as const`,
		)
	}
	await put(
		"actual.json",
		JSON.stringify(
			changed ? { schemas: { Uint8: { type: "number" } } } : corpus,
		),
	)
	await put("bin/cargo", '#!/bin/sh\nexec cat "$SCHEMARS_TEST_CORPUS"\n')
	await chmod(path.join(root, "bin/cargo"), 0o755)
	const result = spawnSync(process.execPath, ["scripts/check-schemars.ts"], {
		cwd: root,
		encoding: "utf8",
		timeout: 10_000,
		env: {
			...process.env,
			SCHEMARS_BASE_REF: "HEAD",
			SCHEMARS_TEST_CORPUS: path.join(root, "actual.json"),
			PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`,
		},
	})
	expect(result.error).toBeUndefined()
	expect(result.status).toBe(1)
	expect(result.stderr).toContain(code)
})
