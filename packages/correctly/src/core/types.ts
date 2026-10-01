export type Mode = "json" | "jsonc"
export type Position = { line: number; character: number }
export type Range = { start: Position; end: Position }
export type Diagnostic = {
	code: string
	message: string
	pointer: string
	offset: number
	length: number
	range: Range
	context?: { parent: number; label: string }
}
export type Failure = { code: string; message: string; file?: string }
export class CorrectlyError extends Error {
	readonly code: string
	constructor(code: string, message: string) {
		super(message)
		this.name = "CorrectlyError"
		this.code = code
	}
}
export function failure(error: unknown, file?: string): Failure {
	return {
		code: error instanceof CorrectlyError ? error.code : "execution",
		message: error instanceof Error ? error.message : String(error),
		...(file === undefined ? {} : { file }),
	}
}
export type Association = {
	index: number
	name: string
	schema: string | null
	mode: Mode
}
export type FileResult = {
	file: string
	mode: Mode
	coverage: "schema" | "syntax-only" | "excluded"
	association: Association | null
	diagnostics: Diagnostic[]
	failures: Failure[]
}
export type Report = {
	reportVersion: 1
	config: string | null
	files: FileResult[]
	failures: Failure[]
	summary: {
		checked: number
		schemaCovered: number
		syntaxOnly: number
		invalid: number
		failures: number
	}
	exitCode: 0 | 1 | 2
}
