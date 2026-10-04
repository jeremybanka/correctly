import type { Diagnostic } from "./types.ts"
import type { ParsedDocument } from "./parse.ts"
import type { ReadText, RemoteOptions } from "./config.ts"

export type Parser = {
	id: string
	/** The parsed value representation, not the source file extension. */
	valueModel: string
	editorLanguage?: "json" | "jsonc"
	parse(
		text: string,
		context: { file: string; signal?: AbortSignal },
	): ParsedDocument | Promise<ParsedDocument>
}
export type ValidationContext = {
	root: string
	configPath: string
	remote?: RemoteOptions
	read: ReadText
	fetch?: typeof fetch
	signal?: AbortSignal
	/** Project-scoped services; use a versioned Symbol.for key for cross-package sharing. */
	services: Map<symbol, unknown>
	/** Register a file or URI which affects this adapter's prepared state. */
	watch(uri: string): void
}
export type ValidationInput = {
	file: string
	text: string
	parsed: ParsedDocument
	signal?: AbortSignal
}
export type JsonSchemaEditorSupport = {
	kind: "json-schema"
	uri: string
	readSchema(uri: string): Promise<string>
}
export type PreparedValidator = {
	validate(input: ValidationInput): Diagnostic[] | Promise<Diagnostic[]>
	editor?: JsonSchemaEditorSupport
	dispose?(): void | Promise<void>
}
export type Validator = {
	id: string
	accepts: readonly string[]
	/** Optional JSON Schema location for coverage reporting. */
	schema?: string
	extensions?: readonly { readonly id: string }[]
	/** Register resources before any association is prepared (e.g. schema IDs). */
	register?(context: ValidationContext): void | Promise<void>
	prepare(
		context: ValidationContext,
	): PreparedValidator | Promise<PreparedValidator>
}
