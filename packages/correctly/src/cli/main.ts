#!/usr/bin/env node
import path from "node:path"
import {
	completionResponse,
	help,
	interpretArguments,
	logWarnings,
	parseBooleanOption,
	type CliWarning,
} from "comline"
import { correctlyCli } from "./definition.ts"
import { failure, type Report } from "../core/types.ts"
import type { buildVsix, installVscodeExtension } from "./vsix.ts"

type CliEnvironment = {
	buildVsix?: typeof buildVsix
	installVscodeExtension?: typeof installVscodeExtension
}

export async function run(
	args: string[],
	cwd = process.cwd(),
	environment: CliEnvironment = {},
): Promise<{ output: string; exitCode: number; warnings?: CliWarning[] }> {
	let json = false
	let warnings: CliWarning[] = []
	try {
		const argv = [process.execPath, "correctly", ...args]
		const context = interpretArguments(correctlyCli.definition, args)
		const rawValue = (key: string) =>
			context.options
				.filter((option) => option.key === key)
				.map((option) => option.value)
				.join(",")
		json = rawValue("format") === "json"
		const helpRequested =
			context.options.some((option) => option.key === "help") &&
			parseBooleanOption(rawValue("help"))
		if (!context.error && helpRequested)
			return {
				output: help(correctlyCli.definition),
				exitCode: 0,
				warnings: context.warnings,
			}
		const completion = await completionResponse(correctlyCli.definition, argv)
		if (completion !== undefined) return { output: completion, exitCode: 0 }
		const parsed = correctlyCli(argv)
		warnings = parsed.warnings
		const { inputs } = parsed
		if (inputs.case === "")
			return { output: help(correctlyCli.definition), exitCode: 0, warnings }
		if (inputs.case === "vsix") {
			const values = inputs.opts
			const vsix = await import("./vsix.ts")
			const build = environment.buildVsix ?? vsix.buildVsix
			const destination = await build(
				vsix.defaultPackageRoot(),
				path.resolve(cwd, values.outdir),
			)
			const output = `correctly vsix: built ${destination}.`
			if (values["build-only"]) return { output, exitCode: 0, warnings }
			const install =
				environment.installVscodeExtension ?? vsix.installVscodeExtension
			const result = await install({
				cwd,
				editorCommand: values.target,
				vsixPath: destination,
			})
			return {
				output: `${output}\ncorrectly vsix: ${
					result.error ??
					(result.exitCode === 0
						? `installed ${destination} with ${values.target}.`
						: `${values.target} exited with code ${result.exitCode}.`)
				}`,
				exitCode: result.exitCode,
				warnings,
			}
		}
		if (inputs.case === "schemas/pull") {
			const values = inputs.opts
			json = values.format === "json"
			if (values.offline) throw new Error("Schema pull requires online mode")
			if (values.all && values.association !== undefined)
				throw new Error("Use --all or --association, not both")
			const { discoverConfig, loadProject } = await import("../core/config.ts")
			const { pullSchemas } = await import("../core/pull.ts")
			const configPath = values.config
				? path.resolve(cwd, values.config)
				: await discoverConfig(cwd)
			const lock = await pullSchemas(
				await loadProject(configPath),
				values.association === undefined
					? {}
					: {
							// Preserve individual values: Comline combines repeated strings with commas.
							associations: context.options
								.filter((option) => option.key === "association")
								.map((option) => option.value),
						},
			)
			return {
				output: json
					? JSON.stringify(lock, null, 2)
					: `Vendored ${Object.keys(lock.schemas).length} schema resources in .correctly/; wrote .correctly/correctly.lock`,
				exitCode: 0,
				warnings,
			}
		}
		if (inputs.case !== "check" && inputs.case !== "check/$...files")
			throw new Error(
				"Expected a check, schemas pull, vsix, or completion command",
			)
		const values = inputs.opts
		json = values.format === "json"
		const { check, readableReport } = await import("./check.ts")
		const sources = new Map<string, string>()
		const report = await check({
			cwd,
			...(inputs.case === "check/$...files"
				? { files: inputs.params.files }
				: {}),
			...(values.config ? { config: values.config } : {}),
			...(values.offline === undefined ? {} : { offline: values.offline }),
			...(json
				? {}
				: {
						onRead: (file: string, text: string) => {
							sources.set(file, text)
						},
					}),
		})
		return {
			output: json
				? JSON.stringify(report, null, 2)
				: readableReport(report, { cwd, sources }),
			exitCode: report.exitCode,
			warnings,
		}
	} catch (error) {
		const report: Report = {
			reportVersion: 2,
			config: null,
			files: [],
			failures: [failure(error)],
			summary: {
				checked: 0,
				validated: 0,
				schemaCovered: 0,
				syntaxOnly: 0,
				invalid: 0,
				failures: 1,
			},
			exitCode: 2,
		}
		const { readableReport } = await import("./check.ts")
		return {
			output: json
				? JSON.stringify(report, null, 2)
				: readableReport(report, { cwd }),
			exitCode: 2,
			warnings,
		}
	}
}

if (import.meta.main) {
	const result = await run(process.argv.slice(2))
	logWarnings(result.warnings ?? [])
	process.stdout.write(
		result.output.endsWith("\n") ? result.output : `${result.output}\n`,
	)
	process.exitCode = result.exitCode
}
