import {
	findNodeAtLocation,
	getNodePath,
	getNodeValue,
	parseTree,
	printParseErrorCode,
	type Node,
	type ParseError,
} from "jsonc-parser"
import type { Diagnostic, Position } from "./types.ts"

export type SourceSpan = { offset: number; length: number }
export type ParsedDocument = {
	value: unknown
	diagnostics: Diagnostic[]
	locate: (pointer: string, key?: boolean) => SourceSpan | undefined
	/** Exact numeric lexeme when the parser can preserve it. */
	rawNumber?: (pointer: string) => string | undefined
}
export type ParsedJsonDocument = ParsedDocument & { root: Node | undefined }

export function pointer(parts: readonly (string | number)[]): string {
	return parts
		.map((p) => `/${String(p).replace(/~/g, "~0").replace(/\//g, "~1")}`)
		.join("")
}

export function positionAt(text: string, offset: number): Position {
	const end = Math.min(Math.max(0, offset), text.length)
	let line = 0
	let start = 0
	for (let i = 0; i < end; i++) {
		if (text[i] === "\r") {
			if (text[i + 1] === "\n" && i + 1 < end) i++
			line++
			start = i + 1
		} else if (text[i] === "\n") {
			line++
			start = i + 1
		}
	}
	return { line, character: end - start }
}

export function diagnostic(
	text: string,
	code: string,
	message: string,
	jsonPointer = "",
	offset = 0,
	length = 1,
): Diagnostic {
	const start = Math.min(offset, text.length)
	const size = Math.min(Math.max(1, length), text.length - start)
	return {
		code,
		message,
		pointer: jsonPointer,
		offset: start,
		length: size,
		range: {
			start: positionAt(text, start),
			end: positionAt(text, start + size),
		},
	}
}

export function parseDocument(
	text: string,
	mode: "json" | "jsonc",
): ParsedJsonDocument {
	const errors: ParseError[] = []
	const root = parseTree(text, errors, {
		disallowComments: mode === "json",
		allowTrailingComma: mode === "jsonc",
		allowEmptyContent: false,
	})
	const diagnostics = errors.map((e) =>
		diagnostic(
			text,
			"syntax",
			printParseErrorCode(e.error),
			"",
			e.offset,
			e.length,
		),
	)
	function visit(node: Node) {
		if (node.type === "object") {
			const keys = new Set<string>()
			for (const property of node.children ?? []) {
				const key = property.children?.[0]
				if (!key || typeof key.value !== "string") continue
				if (keys.has(key.value)) {
					diagnostics.push(
						diagnostic(
							text,
							"duplicate-key",
							`Duplicate key ${JSON.stringify(key.value)}`,
							pointer([...getNodePath(node), key.value]),
							key.offset,
							key.length,
						),
					)
				}
				keys.add(key.value)
			}
		}
		if (node.type === "number" && !Number.isFinite(node.value)) {
			diagnostics.push(
				diagnostic(
					text,
					"syntax",
					"Number exceeds the supported finite range",
					pointer(getNodePath(node)),
					node.offset,
					node.length,
				),
			)
		}
		for (const child of node.children ?? []) visit(child)
	}
	if (root) visit(root)
	// jsonc-parser's object values have null prototypes. Ajv's deep equality
	// expects ordinary JSON objects; Object.fromEntries safely preserves __proto__.
	function value(node: Node): unknown {
		if (node.type === "object")
			return Object.fromEntries(
				(node.children ?? []).flatMap((property) => {
					const key = property.children?.[0]
					const child = property.children?.[1]
					return key && child ? [[String(key.value), value(child)]] : []
				}),
			)
		if (node.type === "array") return (node.children ?? []).map(value)
		return getNodeValue(node) as unknown
	}
	return {
		root,
		value: root ? value(root) : undefined,
		diagnostics,
		rawNumber: (jsonPointer) => {
			const parts =
				jsonPointer === ""
					? []
					: jsonPointer
							.slice(1)
							.split("/")
							.map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))
			let node = root
			for (const part of parts) {
				if (!node) break
				node = findNodeAtLocation(node, [
					node.type === "array" ? Number(part) : part,
				])
			}
			return node?.type === "number"
				? text.slice(node.offset, node.offset + node.length)
				: undefined
		},
		locate: (jsonPointer, key = false) => {
			const node = locate(root, jsonPointer, key)
			return node ? { offset: node.offset, length: node.length } : undefined
		},
	}
}

export function locate(
	root: Node | undefined,
	jsonPointer: string,
	key = false,
): Node | undefined {
	if (!root) return undefined
	const parts =
		jsonPointer === ""
			? []
			: jsonPointer
					.slice(1)
					.split("/")
					.map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))
	let current = root
	for (const part of parts) {
		const next = findNodeAtLocation(current, [
			current.type === "array" ? Number(part) : part,
		])
		if (!next) break
		current = next
	}
	return key && current.parent?.type === "property"
		? (current.parent.children?.[0] ?? current)
		: current
}
