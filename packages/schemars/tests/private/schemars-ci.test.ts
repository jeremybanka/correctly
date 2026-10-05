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

// Model a coalesced Renovate update with independent generator output for each
// release and deterministic registry responses. No external services are used.
test.each([
	{ scenario: "complete sequence", code: undefined },
	{ scenario: "missing release", code: "SCHEMARS_RELEASES_SKIPPED" },
	{ scenario: "missing changeset", code: "SCHEMARS_CHANGESET_REQUIRED" },
	{ scenario: "wrong intermediate era", code: "SCHEMARS_CONTRACT_DRIFT" },
	{ scenario: "rewritten history", code: "SCHEMARS_HISTORY_CHANGED" },
	{ scenario: "old probe", code: "SCHEMARS_CANDIDATE_REQUIRED" },
])("a batch review checks $scenario", async ({ scenario, code }) => {
	const root = await temp()
	const put = async (file: string, text: string) => {
		await mkdir(path.dirname(path.join(root, file)), { recursive: true })
		await writeFile(path.join(root, file), text)
	}
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: root, stdio: "pipe" })
	for (const file of [
		"scripts/check-schemars.ts",
		"scripts/schemars-contract.ts",
		"packages/schemars/src/select-era.ts",
	]) {
		await put(file, "")
		await copyFile(
			new URL(`../../../../${file}`, import.meta.url),
			path.join(root, file),
		)
	}
	const manifest = (version: string) =>
		`schemars = { version = "=${version}" }\n`
	const lock = (version: string) =>
		["schemars", "schemars_derive"]
			.map((name) => `[[package]]\nname = "${name}"\nversion = "${version}"\n`)
			.join("\n")
	const pin = async (version: string) => {
		await put(`${FIXTURES}/versions/${version}/Cargo.toml`, manifest(version))
		await put(`${FIXTURES}/versions/${version}/Cargo.lock`, lock(version))
	}
	const legacy = { schemas: { Value: { type: "string" } } }
	const modern = { schemas: { Value: { type: "number" } } }
	const catalog = async (eras: { since: string; versions: string[] }[]) =>
		put(CATALOG, `export const schemarsEras = ${JSON.stringify(eras)} as const`)
	await put("package.json", '{"type":"module"}')
	await put("packages/schemars/package.json", '{"version":"0.0.0"}')
	await catalog([{ since: "0.8.22", versions: ["0.8.22"] }])
	await put(`${FIXTURES}/eras/0.8.22.rs`, "// frozen")
	await put(`${FIXTURES}/eras/0.8.22.json`, JSON.stringify(legacy))
	await pin("0.8.22")
	await put(PROBE, manifest("0.8.22"))
	await put(path.join(path.dirname(PROBE), "Cargo.lock"), lock("0.8.22"))
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
	const versions =
		scenario === "missing release" ? ["1.0.0"] : ["0.9.0", "1.0.0"]
	const wrong = scenario === "wrong intermediate era"
	await catalog(
		wrong
			? [
					{ since: "0.8.22", versions: ["0.8.22", "0.9.0"] },
					{ since: "1.0.0", versions: ["1.0.0"] },
				]
			: [
					{ since: "0.8.22", versions: ["0.8.22"] },
					{ since: versions[0]!, versions },
				],
	)
	await put(
		`${FIXTURES}/eras/${wrong ? "1.0.0" : versions[0]}.rs`,
		"// new generator",
	)
	await put(
		`${FIXTURES}/eras/${wrong ? "1.0.0" : versions[0]}.json`,
		JSON.stringify(modern),
	)
	for (const version of versions) {
		await pin(version)
		if (scenario === "missing changeset" && version === "0.9.0") continue
		await put(
			`.changeset/review-${version}.md`,
			`---\n"@correctlyjs/schemars": patch\n---\n\nReview Schemars ${version}.\n`,
		)
	}
	if (scenario === "rewritten history")
		await put(`${FIXTURES}/eras/0.8.22.rs`, "// rewritten")
	const candidate = scenario === "old probe" ? "0.9.0" : "1.0.0"
	await put(PROBE, manifest(candidate))
	await put(path.join(path.dirname(PROBE), "Cargo.lock"), lock(candidate))
	await put("legacy.json", JSON.stringify(legacy))
	await put("modern.json", JSON.stringify(modern))
	await put(
		"bin/cargo",
		'#!/bin/sh\ncase "$*" in *versions/0.8.22/*) exec cat "$SCHEMARS_TEST_ROOT/legacy.json";; *) exec cat "$SCHEMARS_TEST_ROOT/modern.json";; esac\n',
	)
	await chmod(path.join(root, "bin/cargo"), 0o755)
	await put(
		"registry.ts",
		`globalThis.fetch = async (url: string | URL | Request) => new Response(String(url).includes("registry.npmjs.org") ? "{}" : ${JSON.stringify(["0.8.22", "0.9.0", "1.0.0"].map((vers) => JSON.stringify({ vers })).join("\n"))})`,
	)
	git("add", ".")
	const result = spawnSync(
		process.execPath,
		["--import", path.join(root, "registry.ts"), "scripts/check-schemars.ts"],
		{
			cwd: root,
			encoding: "utf8",
			timeout: 10_000,
			env: {
				...process.env,
				SCHEMARS_BASE_REF: "HEAD",
				SCHEMARS_TEST_ROOT: root,
				PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`,
			},
		},
	)
	expect(result.error).toBeUndefined()
	if (code) {
		expect(result.status).toBe(1)
		expect(result.stderr).toContain(code)
	} else {
		expect(result.status, result.stderr).toBe(0)
		expect(result.stdout).toContain("Schemars 0.9.0: reproduced era 0.9.0")
		expect(result.stdout).toContain("Schemars 1.0.0: reproduced era 0.9.0")
	}
})
