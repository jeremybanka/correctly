import { parseTOML, ParseError, type AST } from "toml-eslint-parser"
import { diagnostic, pointer, type ParsedDocument } from "./parse.ts"
import { Locations } from "./locations.ts"
import type { Diagnostic } from "./types.ts"

export function parseToml(text: string): ParsedDocument {
	const locations = new Locations()
	locations.values.set("", { offset: 0, length: text.length })
	const diagnostics: Diagnostic[] = []
	const numbers = new Map<string, string>()
	let ast: AST.TOMLProgram
	try {
		ast = parseTOML(text, { tomlVersion: "1.0.0" })
	} catch (error) {
		if (!(error instanceof ParseError)) throw error
		const duplicate =
			error.message === "Defining a key multiple times is invalid"
		return {
			value: undefined,
			diagnostics: [
				diagnostic(
					text,
					duplicate ? "duplicate-key" : "syntax",
					error.message,
					"",
					error.index,
				),
			],
			locate: locations.locate,
		}
	}
	const root: Record<string, unknown> = {}
	function span(node: AST.TOMLNode) {
		return { offset: node.range[0], length: node.range[1] - node.range[0] }
	}
	function assign(
		object: Record<string, unknown>,
		keys: string[],
		result: unknown,
	) {
		let current = object
		for (const key of keys.slice(0, -1)) {
			if (!Object.hasOwn(current, key))
				Object.defineProperty(current, key, {
					value: {},
					enumerable: true,
					writable: true,
					configurable: true,
				})
			current = current[key] as Record<string, unknown>
		}
		Object.defineProperty(current, keys.at(-1)!, {
			value: result,
			enumerable: true,
			writable: true,
			configurable: true,
		})
	}
	function keyNames(key: AST.TOMLKey) {
		return key.keys.map((part) =>
			part.type === "TOMLBare" ? part.name : part.value,
		)
	}
	function keyLocations(key: AST.TOMLKey, base: (string | number)[]) {
		const keys = keyNames(key)
		key.keys.forEach((part, index) => {
			const path = pointer([...base, ...keys.slice(0, index + 1)])
			locations.keys.set(path, span(part))
			if (!locations.values.has(path)) locations.values.set(path, span(part))
		})
		return keys
	}
	function properties(
		body: AST.TOMLKeyValue[],
		parts: (string | number)[],
		object: Record<string, unknown> = {},
	): Record<string, unknown> {
		for (const property of body) {
			const keys = keyLocations(property.key, parts)
			assign(object, keys, value(property.value, [...parts, ...keys]))
		}
		return object
	}
	function value(
		node: AST.TOMLContentNode,
		parts: (string | number)[],
	): unknown {
		const path = pointer(parts)
		locations.values.set(path, span(node))
		if (node.type === "TOMLArray")
			return node.elements.map((child, index) =>
				value(child, [...parts, index]),
			)
		if (node.type === "TOMLInlineTable") return properties(node.body, parts)
		if ("datetime" in node) return node.datetime
		if (typeof node.value === "number")
			numbers.set(path, text.slice(node.range[0], node.range[1]))
		if (
			typeof node.value === "number" &&
			(!Number.isFinite(node.value) ||
				(node.kind === "integer" && !Number.isSafeInteger(node.value)))
		) {
			diagnostics.push(
				diagnostic(
					text,
					"syntax",
					node.kind === "integer"
						? "Integer exceeds the supported safe range"
						: "Number exceeds the supported finite range",
					path,
					node.range[0],
					node.range[1] - node.range[0],
				),
			)
		}
		return node.value
	}
	for (const entry of ast.body[0].body) {
		if (entry.type === "TOMLKeyValue") {
			const keys = keyLocations(entry.key, [])
			assign(root, keys, value(entry.value, keys))
			continue
		}
		const parts = entry.resolvedKey
		let current: Record<string | number, unknown> = root
		for (const [index, part] of parts.entries()) {
			if (!Object.hasOwn(current, part))
				Object.defineProperty(current, part, {
					value: typeof parts[index + 1] === "number" ? [] : {},
					enumerable: true,
					writable: true,
					configurable: true,
				})
			current = current[part] as Record<string | number, unknown>
			const path = pointer(parts.slice(0, index + 1))
			if (!locations.values.has(path))
				locations.values.set(path, span(entry.key))
		}
		// resolvedKey includes array indices for nested arrays of tables.
		locations.values.set(pointer(parts), span(entry.key))
		const stringParts = parts
			.map((part, i) => ({ part, i }))
			.filter(({ part }) => typeof part === "string")
		entry.key.keys.forEach((key, index) => {
			const end = stringParts[index]!.i + 1
			locations.keys.set(pointer(parts.slice(0, end)), span(key))
		})
		properties(entry.body, parts, current)
	}
	return {
		value: root,
		diagnostics,
		locate: locations.locate,
		rawNumber: (path) => numbers.get(path),
	}
}
