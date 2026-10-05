import { pointer } from "./parse.ts"

/** Only schema positions: defaults, enums, examples and other data stay opaque. */
export function* schemaChildren(
	schema: Record<string, unknown>,
): Generator<[string, unknown]> {
	for (const key of [
		"additionalItems",
		"additionalProperties",
		"contains",
		"propertyNames",
		"not",
		"if",
		"then",
		"else",
		"unevaluatedProperties",
		"unevaluatedItems",
		"contentSchema",
	]) {
		if (schema[key] !== undefined) yield [pointer([key]), schema[key]]
	}
	for (const key of [
		"properties",
		"patternProperties",
		"definitions",
		"$defs",
		"dependentSchemas",
		"dependencies",
	]) {
		const map = schema[key]
		if (typeof map === "object" && map !== null && !Array.isArray(map))
			for (const [name, child] of Object.entries(map))
				yield [pointer([key, name]), child]
	}
	for (const key of ["allOf", "anyOf", "oneOf", "prefixItems", "items"]) {
		const children = schema[key]
		if (Array.isArray(children)) {
			for (const [index, child] of children.entries())
				yield [pointer([key, index]), child]
		} else if (key === "items" && children !== undefined)
			yield [pointer([key]), children]
	}
}
