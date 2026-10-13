import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, test } from "vite-plus/test"
import { correctlyCli } from "../../src/cli/definition.ts"
import { put, temp } from "./helpers.ts"

const entry = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))

test("CLI completion shares command routes, option choices, and filesystem hints with parsing", async () => {
	const commands = await correctlyCli.complete({ words: [""] })
	expect(commands.candidates.map(({ value }) => value)).toEqual(
		expect.arrayContaining(["check", "schemas", "completion"]),
	)
	expect(commands.diagnostics).toEqual([])
	for (const words of [
		["check", "--format", "j"],
		["--format=j"],
		["check", "data.json", "--format=j"],
		["schemas", "pull", "--format=j"],
	]) {
		const result = await correctlyCli.complete({ words })
		expect(result.candidates.map(({ value }) => value)).toEqual(["json"])
		expect(result.fileSystem).toBe("none")
		expect(result.diagnostics).toEqual([])
	}
	const inline = correctlyCli.interpret({
		words: ["check", "--format=junk", "ignored.json"],
		cursor: { word: 1, offset: 10 },
	})
	expect(inline.replacement).toEqual({ word: 1, start: 9, end: 13 })
	for (const words of [
		["check", "--config", ""],
		["schemas", "pull", "--config", ""],
		["check", ""],
		["check", "data.json", ""],
		["check", "--", "-file"],
	]) {
		const result = await correctlyCli.complete({ words })
		expect(result.fileSystem).toBe("files")
		expect(result.diagnostics).toEqual([])
	}
	const supplied = await correctlyCli.complete({
		words: ["check", "--format=json", "--"],
	})
	expect(supplied.candidates.map(({ value }) => value)).not.toContain(
		"--format",
	)
	const afterDelimiter = await correctlyCli.complete({
		words: ["check", "--", "--"],
	})
	expect(afterDelimiter.candidates).toEqual([])
	const schemas = await correctlyCli.complete({ words: ["schemas", ""] })
	expect(schemas.candidates.map(({ value }) => value)).toContain("pull")
	expect(
		(await correctlyCli.complete({ words: ["schemas", "pull", ""] }))
			.fileSystem,
	).toBe("none")
	for (const words of [
		["completion", ""],
		["completion", "install", ""],
	]) {
		const result = await correctlyCli.complete({ words })
		expect(result.candidates.map(({ value }) => value)).toEqual(
			expect.arrayContaining(["bash", "zsh", "fish", "nushell", "carapace"]),
		)
	}
})

test("completion transports produce protocol responses without executing project configuration", async () => {
	const root = await temp()
	await put(
		root,
		"correctly.config.ts",
		'throw new Error("Configuration must not execute during completion"); export default {}',
	)
	const invoke = (args: string[]) =>
		spawnSync(process.execPath, [entry, ...args], {
			cwd: root,
			encoding: "utf8",
		})
	const cobra = invoke(["__complete", "check", "--format", "j"])
	expect(cobra.status).toBe(0)
	expect(cobra.stderr).toBe("")
	expect(cobra.stdout).toBe("json\n:4\n")
	const shell = invoke(["_comline", "complete", "check", "--format=j"])
	expect(shell.status).toBe(0)
	expect(shell.stderr).toBe("")
	expect(shell.stdout).toBe("prefix:--format=\njson\n:4\n")
	const carapace = invoke([
		"_carapace",
		"export",
		"bash",
		"check",
		"--format=j",
	])
	expect(carapace.status).toBe(0)
	expect(carapace.stderr).toBe("")
	expect(JSON.parse(carapace.stdout)).toMatchObject({
		messages: [],
		values: [{ value: "--format=json", display: "json" }],
	})
	const nu = invoke(["_comline", "nushell", "check", "--format=j"])
	expect(nu.status).toBe(0)
	expect(nu.stderr).toBe("")
	expect(JSON.parse(nu.stdout)).toMatchObject([{ display: "json" }])
	const noDescriptions = invoke(["__completeNoDesc", "ch"])
	expect(noDescriptions.status).toBe(0)
	expect(noDescriptions.stdout).toBe("check\n:4\n")
})

test.each(["bash", "zsh", "fish", "nushell", "carapace"])(
	"completion %s prints a setup artifact without loading configuration",
	async (target) => {
		const root = await temp()
		await put(
			root,
			"correctly.config.ts",
			'throw new Error("Configuration must not execute during script generation"); export default {}',
		)
		const result = spawnSync(process.execPath, [entry, "completion", target], {
			cwd: root,
			encoding: "utf8",
		})
		expect(result.status).toBe(0)
		expect(result.stderr).toBe("")
		expect(result.stdout).toContain("correctly")
		expect(result.stdout.length).toBeGreaterThan(100)
	},
)
