import { readFile } from "node:fs/promises"
import path from "node:path"
import { glob } from "tinyglobby"
import {
	discoverConfig,
	exclusions,
	isIncluded,
	loadProject,
} from "../core/config.ts"
import { Engine } from "../core/engine.ts"
import { failure, type Report } from "../core/types.ts"

export type CheckOptions = {
	cwd?: string
	config?: string
	offline?: boolean
	files?: string[]
	onRead?: (file: string, text: string) => void
}
export async function check(options: CheckOptions = {}): Promise<Report> {
	const report: Report = {
		reportVersion: 1,
		config: null,
		files: [],
		failures: [],
		summary: {
			checked: 0,
			schemaCovered: 0,
			syntaxOnly: 0,
			invalid: 0,
			failures: 0,
		},
		exitCode: 0,
	}
	try {
		const cwd = path.resolve(options.cwd ?? process.cwd())
		const configPath = options.config
			? path.resolve(cwd, options.config)
			: await discoverConfig(cwd)
		report.config = configPath
		const project = await loadProject(configPath)
		const engine = new Engine(
			project,
			options.offline === undefined ? {} : { offline: options.offline },
		)
		await engine.prepare()
		const files = options.files?.length
			? options.files.map((f) => path.resolve(cwd, f))
			: await glob(project.config.files ?? ["**/*.json", "**/*.jsonc"], {
					cwd: project.root,
					ignore: exclusions(project),
					absolute: true,
					dot: true,
					onlyFiles: true,
				})
		for (const file of [...new Set(files)].sort()) {
			try {
				const included = isIncluded(project, file)
				const text = included ? await readFile(file, "utf8") : ""
				if (included) options.onRead?.(file, text)
				report.files.push(await engine.validate(file, text))
			} catch (error) {
				report.failures.push(failure(error, file))
			}
		}
	} catch (error) {
		report.failures.push(failure(error))
	}
	const checked = report.files.filter((f) => f.coverage !== "excluded")
	report.summary = {
		checked: checked.length,
		schemaCovered: checked.filter((f) => f.coverage === "schema").length,
		syntaxOnly: checked.filter((f) => f.coverage === "syntax-only").length,
		invalid: checked.filter((f) => f.diagnostics.length > 0).length,
		failures:
			report.failures.length +
			report.files.reduce((n, f) => n + f.failures.length, 0),
	}
	report.exitCode = report.summary.failures ? 2 : report.summary.invalid ? 1 : 0
	return report
}

export { readableReport } from "./readable.ts"
