import path from "node:path"
import { fileURLToPath } from "node:url"
import { styleText } from "node:util"
import type { Diagnostic, Failure, FileResult, Report } from "../core/types.ts"
import { diagnosticViews, type DiagnosticView } from "../core/diagnostics.ts"

export type ReadableOptions = {
	cwd?: string
	sources?: ReadonlyMap<string, string>
	color?: boolean
}

// Node's automatic color detection respects the output stream and NO_COLOR,
// NODE_DISABLE_COLORS, and FORCE_COLOR. Use the same palette as Lasertag.
function createStyler(color?: boolean) {
	const apply = (format: Parameters<typeof styleText>[0], text: string) =>
		color === false
			? text
			: styleText(format, text, {
					stream: process.stdout,
					...(color === true ? { validateStream: false } : {}),
				})
	return {
		bold: (text: string) => apply("bold", text),
		bad: (text: string) => apply(["bold", "red"], text),
		caret: (text: string) => apply(["bold", "yellow"], text),
		code: (text: string) => apply("cyan", text),
		dim: (text: string) => apply("dim", text),
		success: (text: string) => apply(["bold", "green"], text),
		warning: (text: string) => apply(["bold", "yellow"], text),
	}
}
type Styler = ReturnType<typeof createStyler>

function displayPath(cwd: string, file: string): string {
	const relative = path.relative(cwd, file)
	return relative &&
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
		? relative
		: file
}

function displaySchema(cwd: string, uri: string): string {
	const url = new URL(uri)
	if (url.protocol !== "file:") return uri
	return `${displayPath(cwd, fileURLToPath(url))}${url.hash}`
}

function countLabel(count: number, label: string): string {
	return `${count} ${label}${count === 1 ? "" : "s"}`
}

function lastSelectedLine(diagnostic: Diagnostic): number {
	const { start, end } = diagnostic.range
	return Math.max(
		start.line,
		end.line - (end.line > start.line && end.character === 0 ? 1 : 0),
	)
}

// Like Lasertag, keep one context line on either side and collapse long ranges
// to their first/last lines. Tabs are expanded equally in source and carets.
function excerpt(
	source: string[],
	diagnostic: Diagnostic,
	diagnosedLines: ReadonlySet<number>,
	styler: Styler,
) {
	const start = diagnostic.range.start.line
	const end = Math.min(lastSelectedLine(diagnostic), source.length - 1)
	if (start < 0 || start >= source.length) return undefined
	const visible: (number | undefined)[] = []
	if (start > 0 && !diagnosedLines.has(start - 1)) visible.push(start - 1)
	visible.push(start)
	if (end > start + 1) visible.push(undefined)
	if (end > start) visible.push(end)
	if (
		end + 1 < source.length &&
		!diagnosedLines.has(end + 1) &&
		(end + 1 < source.length - 1 || source[end + 1] !== "")
	)
		visible.push(end + 1)
	const width = Math.max(
		...visible.map((line) =>
			line === undefined ? 1 : String(line + 1).length,
		),
	)
	const output: string[] = []
	for (const line of visible) {
		if (line === undefined) {
			output.push(styler.dim(`${" ".repeat(width)} │ …`))
			continue
		}
		const text = source[line]!
		const selected = line >= start && line <= end
		const expanded = text.replaceAll("\t", "    ").trimEnd()
		output.push(
			`${styler.dim(`${String(line + 1).padStart(width)} │`)} ${selected ? expanded : styler.dim(expanded)}`,
		)
		if (!selected) continue
		const from = line === start ? diagnostic.range.start.character : 0
		const to =
			line === diagnostic.range.end.line
				? diagnostic.range.end.character
				: text.length
		const caretStart = text.slice(0, from).replaceAll("\t", "    ").length
		const caretWidth = Math.max(
			1,
			text.slice(from, to).replaceAll("\t", "    ").length,
		)
		output.push(
			`${styler.dim(`${" ".repeat(width)} │`)} ${" ".repeat(caretStart)}${styler.caret("^".repeat(caretWidth))}`,
		)
	}
	return { lines: output, width }
}

function renderFailure(
	error: Failure,
	styler: Styler,
	prefix = "",
	continuation = "",
): string {
	const [title, ...details] = error.message.split("\n")
	return [
		`${prefix}${styler.bad(error.code)}: ${title}`,
		...details.map((line) => `${styler.dim(continuation + "│")} ${line}`),
	].join("\n")
}

type FileGroup = { file: string; result?: FileResult; failures: Failure[] }

function renderDiagnostic(
	issue: DiagnosticView,
	prefix: string,
	last: boolean,
	source: string[] | undefined,
	diagnosedLines: ReadonlySet<number>,
	styler: Styler,
	shownRegions = new Set<string>(),
): string[] {
	const branch = last ? "└─" : "├─"
	const continuation = `${prefix}${last ? "   " : "│  "}`
	const output = [
		`${styler.dim(`${prefix}${branch}`)} ${styler.dim(`${issue.range.start.line + 1}:${issue.range.start.character + 1}`)}  ${styler.code(issue.code)}`,
	]
	const region = source
		? excerpt(source, issue, diagnosedLines, styler)
		: undefined
	const regionKey = `${issue.offset}:${issue.length}`
	if (region && !shownRegions.has(regionKey))
		output.push(
			...region.lines.map((line) => `${styler.dim(continuation)}${line}`),
		)
	shownRegions.add(regionKey)
	const indentation = `${continuation}${" ".repeat(region ? region.width + 1 : 0)}`
	output.push(
		`${styler.dim(continuation)}${" ".repeat(region ? region.width + 1 : 0)}${styler.dim("╰─")} ${issue.message}`,
	)
	for (const [index, branch] of issue.branches.entries()) {
		const finalBranch = index === issue.branches.length - 1
		output.push(
			`${styler.dim(`${indentation}${finalBranch ? "└─" : "├─"}`)} ${styler.bold(branch.label)}`,
		)
		const children = branch.diagnostics.toSorted((a, b) => a.offset - b.offset)
		for (const [childIndex, child] of children.entries())
			output.push(
				...renderDiagnostic(
					child,
					`${indentation}${finalBranch ? "   " : "│  "}`,
					childIndex === children.length - 1,
					source,
					diagnosedLines,
					styler,
					shownRegions,
				),
			)
	}
	return output
}

function fileSection(
	group: FileGroup,
	options: ReadableOptions,
	styler: Styler,
): string {
	const cwd = options.cwd ?? process.cwd()
	const diagnostics = diagnosticViews(group.result?.diagnostics ?? []).toSorted(
		(a, b) => a.offset - b.offset,
	)
	const counts = [
		...(diagnostics.length ? [countLabel(diagnostics.length, "error")] : []),
		...(group.failures.length
			? [countLabel(group.failures.length, "failure")]
			: []),
	]
	const status =
		counts.join(", ") ||
		(group.result?.coverage === "excluded" ? "excluded" : "valid")
	const statusColor = counts.length
		? styler.bad
		: group.result?.coverage === "excluded"
			? styler.dim
			: styler.success
	let header = `${styler.bold(displayPath(cwd, group.file))}  ${statusColor(status)}`
	if (group.result) {
		const { mode, coverage, association } = group.result
		const format = mode.toUpperCase()
		const schema = association?.schema
		const description =
			coverage === "excluded"
				? format
				: schema
					? `${format} against ${association.name} (${displaySchema(cwd, schema)})`
					: `${format} syntax only (${association ? `association: ${association.name}` : "no schema association"})`
		header += `  ${styler.dim(`·  ${description}`)}`
	}
	const output = [header]
	const text = options.sources?.get(group.file)
	const source = text === undefined ? undefined : text.split(/\r\n|\r|\n/)
	const diagnosedLines = new Set<number>()
	if (source)
		for (const diagnostic of group.result?.diagnostics ?? []) {
			for (
				let line = diagnostic.range.start.line;
				line <= Math.min(lastSelectedLine(diagnostic), source.length - 1);
				line++
			)
				diagnosedLines.add(line)
		}
	const issues: (DiagnosticView | Failure)[] = [
		...diagnostics,
		...group.failures,
	]
	for (const [index, issue] of issues.entries()) {
		const last = index === issues.length - 1
		const branch = last ? "└─" : "├─"
		if ("range" in issue) {
			output.push(
				...renderDiagnostic(issue, "", last, source, diagnosedLines, styler),
			)
		} else
			output.push(
				renderFailure(
					issue,
					styler,
					`${styler.dim(branch)} `,
					last ? "   " : "│  ",
				),
			)
		if (!last) output.push(styler.dim("│"))
	}
	return output.join("\n")
}

export function readableReport(
	report: Report,
	options: ReadableOptions = {},
): string {
	const styler = createStyler(options.color)
	const groups = new Map<string, FileGroup>()
	for (const result of report.files)
		groups.set(result.file, {
			file: result.file,
			result,
			failures: [...result.failures],
		})
	const globalFailures: Failure[] = []
	for (const error of report.failures) {
		if (!error.file) {
			globalFailures.push(error)
			continue
		}
		let group = groups.get(error.file)
		if (!group) {
			group = { file: error.file, failures: [] }
			groups.set(error.file, group)
		}
		group.failures.push(error)
	}
	const output = [...groups.values()]
		.toSorted((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
		.map((group) => fileSection(group, options, styler))
	for (const error of globalFailures) output.push(renderFailure(error, styler))
	const errors = report.files.reduce(
		(count, file) => count + diagnosticViews(file.diagnostics).length,
		0,
	)
	const s = report.summary
	const status =
		report.exitCode === 2
			? `▲ Check failed with ${countLabel(s.failures, "failure")}`
			: report.exitCode === 1
				? `▲ Check found ${countLabel(errors, "error")} in ${countLabel(s.invalid, "file")}`
				: "✓ Check passed"
	output.push(
		[
			styler.dim("─".repeat(56)),
			"",
			(report.exitCode === 2
				? styler.bad
				: report.exitCode === 1
					? styler.warning
					: styler.success)(status),
			"",
			`${s.checked} checked, ${s.schemaCovered} schema-covered, ${s.syntaxOnly} syntax-only, ${s.invalid} invalid, ${s.failures} failures`,
		].join("\n"),
	)
	return output.join("\n\n")
}
