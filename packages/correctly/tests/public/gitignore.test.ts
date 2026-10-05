import path from "node:path"
import { describe, expect, test } from "vite-plus/test"
import {
	defineConfig,
	GITIGNORE,
	isIncluded,
	loadProject,
	validateConfig,
} from "../../src/core/index.ts"
import { Engine } from "../../src/core/engine.ts"
import { check } from "../../src/cli/check.ts"
import { configSource, put, setup, temp } from "./helpers.ts"

describe("gitignore exclusions", () => {
	test("exports an opt-in symbol accepted only in exclude", async () => {
		expect(typeof GITIGNORE).toBe("symbol")
		expect(
			defineConfig({ exclude: [GITIGNORE, "generated/**"], associations: [] })
				.exclude,
		).toEqual([GITIGNORE, "generated/**"])
		for (const invalid of [
			{ files: [GITIGNORE], associations: [] },
			{ exclude: [Symbol("GITIGNORE")], associations: [] },
			{ associations: [{ files: [GITIGNORE], validate: null }] },
		])
			expect(() => validateConfig(invalid)).toThrow()
		const root = await temp()
		await put(root, ".gitignore", "ignored.json\n")
		const file = await put(root, "ignored.json", "{")
		const configPath = await put(root, "correctly.config.ts", {
			associations: [],
		})
		expect(isIncluded(await loadProject(configPath), file)).toBe(true)
		const enabledConfigPath = await put(
			root,
			"enabled.config.ts",
			configSource({
				exclude: [GITIGNORE],
				associations: [],
			}),
		)
		expect(isIncluded(await loadProject(enabledConfigPath), file)).toBe(false)
	})
	test("matches Git patterns, nested overrides, and excluded parent directories", async () => {
		const { root, engine } = await setup(
			{},
			{ exclude: [GITIGNORE, "manual/**"], associations: [] },
		)
		await put(
			root,
			".gitignore",
			"# comment\r\n/root.json\r\n*.generated.json\r\n!keep.generated.json\r\nblocked/\r\nparent/*\r\n!parent/open/\r\nbranch/*\r\n\\#literal.json\r\n\\!literal.json\r\nspace.json   \r\ncase.json\r\n",
		)
		await put(
			root,
			"nested/.gitignore",
			"# nested comment\n   \n!rescue.generated.json\n/local.json\nlocal-dir/   \n",
		)
		await put(root, "blocked/.gitignore", "!rescue.json\n")
		await put(root, "parent/open/.gitignore", "hidden.json\n")
		await put(root, "branch/.gitignore", "!open/\n")
		await put(root, "pattern[?]*dir/.gitignore", "/bad.json\n\\#literal.json\n")
		const excluded = [
			"root.json",
			"nested/file.generated.json",
			"nested/local.json",
			"nested/deeper/local-dir/file.json",
			"blocked/rescue.json",
			"parent/closed/rescue.json",
			"parent/open/hidden.json",
			"#literal.json",
			"!literal.json",
			"space.json",
			"case.json",
			"manual/keep.generated.json",
			"node_modules/keep.generated.json",
			"pattern[?]*dir/bad.json",
			"pattern[?]*dir/deep/#literal.json",
		]
		const included = [
			"nested/root.json",
			"keep.generated.json",
			"nested/rescue.generated.json",
			"nested/deeper/local.json",
			"nested/visible.json",
			"parent/open/visible.json",
			"branch/open/visible.json",
			"CASE.json",
			".hidden.json",
			"pattern[?]*dir/deep/bad.json",
			"patternXdir/bad.json",
		]
		for (const relative of excluded) {
			expect(
				await engine.validate(path.join(root, relative), "{"),
				relative,
			).toMatchObject({ coverage: "excluded", diagnostics: [], failures: [] })
			expect(
				await engine.editor(path.join(root, relative)),
				relative,
			).toBeUndefined()
		}
		for (const relative of included)
			expect(
				(await engine.validate(path.join(root, relative), "{}")).coverage,
				relative,
			).toBe("syntax-only")
	})
	test("uses the config directory as the ignore boundary and tolerates missing ignore files", async () => {
		const root = await temp()
		await put(root, ".gitignore", "*.json\n")
		const configPath = await put(root, "project/correctly.config.ts", {
			exclude: [GITIGNORE],
			associations: [],
		})
		const project = await loadProject(configPath)
		const engine = new Engine(project)
		expect(
			(await engine.validate(path.join(project.root, "data/file.json"), "{}"))
				.coverage,
		).toBe("syntax-only")
		expect(
			(await engine.validate(path.join(root, "outside.json"), "{")).coverage,
		).toBe("excluded")
	})
	test("CLI discovery skips ignored files; explicit paths report them as excluded", async () => {
		const root = await temp()
		await put(root, "correctly.config.ts", {
			exclude: [GITIGNORE, "manual/**"],
			associations: [],
		})
		await put(root, ".gitignore", "*.json\n!keep.json\n")
		await put(root, "nested/.gitignore", "!rescue.json\n")
		await put(root, "ignored.json", "{")
		await put(root, "keep.json", {})
		await put(root, "nested/rescue.json", {})
		await put(root, "nested/ignored.json", "{")
		await put(root, "manual/keep.json", "{")
		const report = await check({ cwd: root })
		expect(report.exitCode).toBe(0)
		expect(report.failures).toEqual([])
		expect(report.files.map((file) => path.relative(root, file.file))).toEqual([
			"keep.json",
			"nested/rescue.json",
		])
		const explicit = await check({
			cwd: root,
			files: [
				"ignored.json",
				"nested/ignored.json",
				"missing.json",
				"keep.json",
			],
		})
		expect(explicit.exitCode).toBe(0)
		expect(explicit.summary.checked).toBe(1)
		expect(
			explicit.files.filter((file) => file.coverage === "excluded"),
		).toHaveLength(3)
	})
})
