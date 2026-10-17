import path from "node:path"
import { expect, test, vi } from "vite-plus/test"
import { run } from "../../src/cli/main.ts"
import { put, temp } from "./helpers.ts"

test("vsix builds from the installed package and installs with code without loading configuration", async () => {
	const root = await temp()
	await put(
		root,
		"correctly.config.ts",
		'throw new Error("Must not load config")',
	)
	const destination = path.join(root, "dist/Correctly-0.3.0.vsix")
	const buildVsix = vi.fn().mockResolvedValue(destination)
	const installVscodeExtension = vi.fn().mockResolvedValue({ exitCode: 0 })
	const result = await run(["vsix"], root, {
		buildVsix,
		installVscodeExtension,
	})
	expect(result.exitCode).toBe(0)
	expect(buildVsix).toHaveBeenCalledExactlyOnceWith(
		expect.stringMatching(/[/\\]packages[/\\]correctly$/),
		path.join(root, "dist"),
	)
	expect(installVscodeExtension).toHaveBeenCalledExactlyOnceWith({
		cwd: root,
		editorCommand: "code",
		vsixPath: destination,
	})
	expect(result.output).toContain(`installed ${destination} with code.`)
})

test("vsix accepts editor and output overrides and preserves the editor exit status", async () => {
	const root = await temp()
	const destination = path.join(root, "my extensions/Correctly.vsix")
	const buildVsix = vi.fn().mockResolvedValue(destination)
	const installVscodeExtension = vi.fn().mockResolvedValue({ exitCode: 7 })
	const result = await run(
		["vsix", "-o", "my extensions", "-t", "code-insiders"],
		root,
		{ buildVsix, installVscodeExtension },
	)
	expect(buildVsix).toHaveBeenCalledWith(
		expect.any(String),
		path.join(root, "my extensions"),
	)
	expect(installVscodeExtension).toHaveBeenCalledWith({
		cwd: root,
		editorCommand: "code-insiders",
		vsixPath: destination,
	})
	expect(result.exitCode).toBe(7)
	expect(result.output).toContain("code-insiders exited with code 7.")
})

test("vsix build-only skips installation and accepts an absolute output directory", async () => {
	const root = await temp()
	const destination = path.join(root, "Correctly.vsix")
	const buildVsix = vi.fn().mockResolvedValue(destination)
	const installVscodeExtension = vi.fn()
	const result = await run(["vsix", "--build-only", "--outdir", root], root, {
		buildVsix,
		installVscodeExtension,
	})
	expect(result).toMatchObject({
		exitCode: 0,
		output: `correctly vsix: built ${destination}.`,
	})
	expect(buildVsix).toHaveBeenCalledWith(expect.any(String), root)
	expect(installVscodeExtension).not.toHaveBeenCalled()
})

test("vsix honors an explicitly disabled build-only option and reports installation errors", async () => {
	const root = await temp()
	const result = await run(["vsix", "--build-only=false"], root, {
		buildVsix: vi.fn().mockResolvedValue(path.join(root, "Correctly.vsix")),
		installVscodeExtension: vi.fn().mockResolvedValue({
			exitCode: 1,
			error: "code was not found on PATH.",
		}),
	})
	expect(result.exitCode).toBe(1)
	expect(result.output).toContain("code was not found on PATH.")
})

test("vsix build failures and invalid options fail before installation", async () => {
	const root = await temp()
	const buildVsix = vi.fn().mockRejectedValue(new Error("VSCE failed"))
	const installVscodeExtension = vi.fn()
	const result = await run(["vsix"], root, {
		buildVsix,
		installVscodeExtension,
	})
	expect(result.exitCode).toBe(2)
	expect(result.output).toContain("VSCE failed")
	expect(installVscodeExtension).not.toHaveBeenCalled()
	buildVsix.mockClear()
	for (const args of [
		["vsix", "--target"],
		["vsix", "--outdir"],
	]) {
		expect(
			(await run(args, root, { buildVsix, installVscodeExtension })).exitCode,
		).toBe(2)
	}
	expect(buildVsix).not.toHaveBeenCalled()
})
