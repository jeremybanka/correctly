import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Diagnostic, Failure, FileResult, Report } from "../core/types.ts"

export type ReadableOptions = {
	cwd?: string
	sources?: ReadonlyMap<string, string>
}

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
			output.push(`${" ".repeat(width)} │ …`)
			continue
		}
		const text = source[line]!
		output.push(
			`${String(line + 1).padStart(width)} │ ${text.replaceAll("\t", "    ").trimEnd()}`,
		)
		if (line < start || line > end) continue
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
			`${" ".repeat(width)} │ ${" ".repeat(caretStart)}${"^".repeat(caretWidth)}`,
		)
	}
	return { lines: output, width }
}

type FileGroup = { file: string; result?: FileResult; failures: Failure[] }
function fileSection(group: FileGroup, options: ReadableOptions): string {
	const cwd = options.cwd ?? process.cwd()
	const diagnostics = (group.result?.diagnostics ?? []).toSorted(
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
	const output = [`${displayPath(cwd, group.file)}  ${status}`]
	if (group.result) {
		const { mode, coverage, association } = group.result
		output.push(
			`  ${mode}; ${coverage}${association ? `; ${association.name}${association.schema ? ` → ${displaySchema(cwd, association.schema)}` : ""}` : ""}`,
		)
	}
	const text = options.sources?.get(group.file)
	const source = text === undefined ? undefined : text.split(/\r\n|\r|\n/)
	const diagnosedLines = new Set<number>()
	if (source)
		for (const diagnostic of diagnostics) {
			for (
				let line = diagnostic.range.start.line;
				line <= Math.min(lastSelectedLine(diagnostic), source.length - 1);
				line++
			)
				diagnosedLines.add(line)
		}
	const issues: (Diagnostic | Failure)[] = [...diagnostics, ...group.failures]
	for (const [index, issue] of issues.entries()) {
		const last = index === issues.length - 1
		const branch = last ? "└─" : "├─"
		const continuation = last ? "   " : "│  "
		if ("range" in issue) {
			output.push(
				`${branch} ${issue.range.start.line + 1}:${issue.range.start.character + 1}  ${issue.code}`,
			)
			const region = source ? excerpt(source, issue, diagnosedLines) : undefined
			if (region)
				output.push(...region.lines.map((line) => `${continuation}${line}`))
			output.push(
				`${continuation}${" ".repeat(region ? region.width + 1 : 0)}╰─ ${issue.message}`,
			)
		} else output.push(`${branch} ${issue.code}: ${issue.message}`)
		if (!last) output.push("│")
	}
	return output.join("\n")
}

export function readableReport(
	report: Report,
	options: ReadableOptions = {},
): string {
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
		.map((group) => fileSection(group, options))
	for (const error of globalFailures)
		output.push(`${error.code}: ${error.message}`)
	const errors = report.files.reduce(
		(count, file) => count + file.diagnostics.length,
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
			"─".repeat(56),
			"",
			status,
			"",
			`${s.checked} checked, ${s.schemaCovered} schema-covered, ${s.syntaxOnly} syntax-only, ${s.invalid} invalid, ${s.failures} failures`,
		].join("\n"),
	)
	return output.join("\n\n")
}
