import { isAlias, isMap, isScalar, isSeq, parseDocument, type Node } from "yaml"
import {
	diagnostic,
	pointer,
	type ParsedDocument,
	type SourceSpan,
} from "./parse.ts"
import { Locations } from "./locations.ts"
import type { Diagnostic } from "./types.ts"

export function parseYaml(text: string): ParsedDocument {
	const document = parseDocument(text, {
		version: "1.2",
		schema: "core",
		uniqueKeys: false,
		intAsBigInt: true,
		prettyErrors: false,
	})
	const diagnostics: Diagnostic[] = [
		...document.errors,
		...document.warnings,
	].map((error) =>
		diagnostic(
			text,
			"syntax",
			error.message,
			"",
			error.pos[0],
			error.pos[1] - error.pos[0],
		),
	)
	if (document.directives?.yaml.version !== "1.2")
		diagnostics.push(diagnostic(text, "syntax", "Only YAML 1.2 is supported"))
	const locations = new Locations()
	locations.values.set("", { offset: 0, length: text.length })
	const active = new Set<Node>()
	const numbers = new Map<string, string>()
	let aliases = 0
	function value(
		node: unknown,
		parts: (string | number)[],
		origin?: SourceSpan,
	): unknown {
		const path = pointer(parts)
		const range =
			isScalar(node) || isMap(node) || isSeq(node) || isAlias(node)
				? node.range
				: undefined
		const span =
			origin ??
			(range
				? { offset: range[0], length: range[1] - range[0] }
				: locations.locate(path))
		if (span) locations.values.set(path, span)
		const problem = (message: string) =>
			diagnostics.push(
				diagnostic(text, "syntax", message, path, span?.offset, span?.length),
			)
		if (isAlias(node)) {
			const target = node.resolve(document)
			if (!target) {
				problem(`Unresolved alias ${node.source}`)
				return null
			}
			if (++aliases > 100 || active.has(target)) {
				problem("Cyclic or excessive YAML aliases are not supported")
				return null
			}
			return value(target, parts, span)
		}
		if (isMap(node)) {
			active.add(node)
			const entries: [string, unknown][] = []
			const keys = new Set<string>()
			for (const pair of node.items) {
				if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
					const keyRange =
						isScalar(pair.key) || isMap(pair.key) || isSeq(pair.key)
							? pair.key.range
							: undefined
					diagnostics.push(
						diagnostic(
							text,
							"syntax",
							"YAML mapping keys must be strings",
							path,
							keyRange?.[0],
							keyRange ? keyRange[1] - keyRange[0] : 1,
						),
					)
					continue
				}
				const key = pair.key.value
				const childParts = [...parts, key]
				const childPath = pointer(childParts)
				const keyRange = pair.key.range
				const keySpan =
					origin ??
					(keyRange
						? { offset: keyRange[0], length: keyRange[1] - keyRange[0] }
						: span)
				if (keySpan) {
					locations.keys.set(childPath, keySpan)
					if (pair.value === null)
						locations.values.set(childPath, {
							offset: keySpan.offset + keySpan.length + 1,
							length: 0,
						})
				}
				if (keys.has(key))
					diagnostics.push(
						diagnostic(
							text,
							"duplicate-key",
							`Duplicate key ${JSON.stringify(key)}`,
							childPath,
							keySpan?.offset,
							keySpan?.length,
						),
					)
				keys.add(key)
				entries.push([key, value(pair.value, childParts, origin)])
			}
			active.delete(node)
			return Object.fromEntries(entries)
		}
		if (isSeq(node)) {
			active.add(node)
			const result = node.items.map((child, index) =>
				value(child, [...parts, index], origin),
			)
			active.delete(node)
			return result
		}
		if (isScalar(node)) {
			const scalar: unknown = node.value
			if ((typeof scalar === "number" || typeof scalar === "bigint") && range)
				numbers.set(path, text.slice(range[0], range[1]))
			if (typeof scalar === "bigint") {
				const number = Number(scalar)
				if (!Number.isSafeInteger(number))
					problem("Integer exceeds the supported safe range")
				return number
			}
			if (typeof scalar === "number" && !Number.isFinite(scalar))
				problem("Number exceeds the supported finite range")
			return scalar
		}
		return null
	}
	return {
		value: value(document.contents, []),
		diagnostics,
		locate: locations.locate,
		rawNumber: (path) => numbers.get(path),
	}
}
