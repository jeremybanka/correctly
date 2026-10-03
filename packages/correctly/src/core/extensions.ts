import type { Ajv, FormatDefinition } from "ajv"
import { CorrectlyError } from "./types.ts"
import { schemaChildren } from "./schema-walk.ts"
import { schemars } from "./extensions/schemars.ts"

/** Synchronous assertions and annotation-only keywords. Registration is explicit. */
export type SchemaExtension = {
	id: string
	formats?: Readonly<
		Record<string, FormatDefinition<string> | FormatDefinition<number>>
	>
	annotations?: readonly string[]
}

export const builtinExtensions: readonly SchemaExtension[] = [
	schemars,
	{ id: "renovate", annotations: ["x-renovate-version"] },
]

export function extensionKey(
	uri: string,
	extensions: readonly string[] = [],
): string {
	return JSON.stringify([uri, [...new Set(extensions)].sort()])
}

export function installExtensions(
	ajv: Ajv,
	enabled: readonly string[],
	registry: readonly SchemaExtension[],
): void {
	const identifiers = new Set<string>()
	for (const extension of registry) {
		if (identifiers.has(extension.id))
			throw new CorrectlyError(
				"extension",
				`Duplicate extension identifier: ${extension.id}`,
			)
		identifiers.add(extension.id)
	}
	const formats = new Set<string>(),
		annotations = new Set<string>()
	for (const id of new Set(enabled)) {
		const extension = registry.find((entry) => entry.id === id)
		if (!extension)
			throw new CorrectlyError(
				"extension",
				`Unknown extension ${JSON.stringify(id)}. Available extensions: ${registry.map((entry) => entry.id).join(", ")}. Enable an installed extension in this schema's association.`,
			)
		for (const [name, definition] of Object.entries(extension.formats ?? {})) {
			if (formats.has(name))
				throw new CorrectlyError(
					"extension",
					`Enabled extensions both define format ${JSON.stringify(name)}.`,
				)
			if (definition.async || typeof definition.validate !== "function")
				throw new CorrectlyError(
					"extension",
					`Extension ${id} must provide a synchronous validator for format ${JSON.stringify(name)}.`,
				)
			formats.add(name)
			const validate = definition.validate as (
				value: string | number,
			) => unknown
			ajv.addFormat(name, {
				...definition,
				validate: (value: string | number) => {
					const valid = validate(value)
					if (typeof valid !== "boolean")
						throw new CorrectlyError(
							"extension",
							`Extension ${id} returned a non-boolean result for format ${JSON.stringify(name)}. Validators must be synchronous.`,
						)
					return valid
				},
			})
		}
		for (const keyword of extension.annotations ?? []) {
			if (annotations.has(keyword) || ajv.RULES.keywords[keyword])
				throw new CorrectlyError(
					"extension",
					`Extension ${id} conflicts with keyword ${JSON.stringify(keyword)}.`,
				)
			annotations.add(keyword)
			ajv.addKeyword({ keyword, valid: true })
		}
	}
}

export function assertFormats(
	ajv: Ajv,
	schema: unknown,
	uri: string,
	registry: readonly SchemaExtension[],
	location = "",
): void {
	if (typeof schema !== "object" || schema === null || Array.isArray(schema))
		return
	const object = schema as Record<string, unknown>
	if (
		typeof object.format === "string" &&
		(!Object.hasOwn(ajv.formats, object.format) ||
			ajv.formats[object.format] === true)
	) {
		const format = object.format
		const extension = registry.find((entry) =>
			Object.hasOwn(entry.formats ?? {}, format),
		)?.id
		const hint = extension
			? `Add ${JSON.stringify(extension)} to "extensions" in this schema's association in correctly.config.json.`
			: `Enable an extension that validates ${JSON.stringify(format)} in this schema's association. Custom extensions can be registered through the Engine API.`
		throw new CorrectlyError(
			"extension-required",
			`This schema needs an extension.\nFormat ${JSON.stringify(format)} has no enabled validator; validation cannot proceed.\nSchema: ${uri}#${location}/format\n${hint}`,
			{
				schemaUri: uri,
				schemaPointer: `${location}/format`,
				format,
				...(extension ? { suggestedExtension: extension } : {}),
			},
		)
	}
	for (const [path, child] of schemaChildren(object))
		assertFormats(ajv, child, uri, registry, location + path)
}
