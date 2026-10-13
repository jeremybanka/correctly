#!/usr/bin/env node
import { parseArgs } from "node:util"
import path from "node:path"
import { discoverConfig, loadProject } from "../core/config.ts"
import { pullSchemas } from "../core/pull.ts"
import { check, readableReport } from "./check.ts"
import { cliHelp } from "./help.ts"
import { failure, type Report } from "../core/types.ts"

export async function run(
	args: string[],
	cwd = process.cwd(),
): Promise<{ output: string; exitCode: number }> {
	let json =
		args.includes("--format=json") ||
		args.some((arg, i) => arg === "--format" && args[i + 1] === "json")
	try {
		const { values, positionals } = parseArgs({
			args,
			allowPositionals: true,
			strict: true,
			options: {
				config: { type: "string", short: "c" },
				offline: { type: "boolean" },
				format: { type: "string", default: "readable" },
				help: { type: "boolean", short: "h" },
			},
		})
		json = values.format === "json"
		if (values.help || positionals.length === 0)
			return { output: cliHelp(), exitCode: 0 }
		if (values.format !== "json" && values.format !== "readable")
			throw new Error(`Unknown report format: ${values.format}`)
		if (positionals[0] === "schemas") {
			if (positionals.length !== 2 || positionals[1] !== "pull")
				throw new Error(
					"Usage: correctly schemas pull [--config path] [--format readable|json]",
				)
			if (values.offline) throw new Error("Schema pull requires online mode")
			const configPath = values.config
				? path.resolve(cwd, values.config)
				: await discoverConfig(cwd)
			const lock = await pullSchemas(await loadProject(configPath))
			return {
				output: json
					? JSON.stringify(lock, null, 2)
					: `Vendored ${Object.keys(lock.schemas).length} schema resources in .correctly/`,
				exitCode: 0,
			}
		}
		if (positionals[0] !== "check")
			throw new Error(`Unknown command: ${positionals[0]}`)
		const sources = new Map<string, string>()
		const report = await check({
			cwd,
			files: positionals.slice(1),
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
		return {
			output: json
				? JSON.stringify(report, null, 2)
				: readableReport(report, { cwd }),
			exitCode: 2,
		}
	}
}

const result = await run(process.argv.slice(2))
process.stdout.write(`${result.output}\n`)
process.exitCode = result.exitCode
