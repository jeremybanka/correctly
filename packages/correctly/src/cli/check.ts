import { readFile } from "node:fs/promises"
import path from "node:path"
import { glob } from "tinyglobby"
import { discoverConfig, exclusions, isIncluded } from "../core/config.ts"
import { ProjectSession } from "../runtime/session.ts"
import { Engine } from "../core/engine.ts"
import { failure, type Report } from "../core/types.ts"

export type CheckOptions = {
	cwd?: string
	config?: string
	offline?: boolean
	files?: string[]
	onRead?: (file: string, text: string) => void
}
function emptyReport(): Report {
	const report: Report = {
		reportVersion: 2,
		config: null,
		files: [],
		failures: [],
		summary: {
			checked: 0,
			validated: 0,
			schemaCovered: 0,
			syntaxOnly: 0,
			invalid: 0,
			failures: 0,
		},
		exitCode: 0,
	}
	return report
}
export async function check(options: CheckOptions = {}): Promise<Report> {
	const report = emptyReport()
	let session: ProjectSession | undefined
	try {
		const cwd = path.resolve(options.cwd ?? process.cwd())
		const configPath = options.config
			? path.resolve(cwd, options.config)
			: await discoverConfig(cwd)
		report.config = configPath
		session = new ProjectSession(
			configPath,
			options.offline === undefined ? {} : { offline: options.offline },
		)
		const result = await session.check({
			cwd,
			...(options.files ? { files: options.files } : {}),
			sources: Boolean(options.onRead),
		})
		for (const [file, text] of result.sources) options.onRead?.(file, text)
		return result.report
	} catch (error) {
		report.failures.push(failure(error))
		report.summary.failures = 1
		report.exitCode = 2
		return report
	} finally {
		await session?.dispose()
	}
}
export async function checkProject(
	engine: Engine,
	options: CheckOptions,
): Promise<Report> {
	const report = emptyReport()
	const project = engine.project
	report.config = project.configPath

	try {
		const cwd = path.resolve(options.cwd ?? process.cwd())
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
		validated: checked.filter(
			(f) => f.coverage === "schema" || f.coverage === "validated",
		).length,
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
