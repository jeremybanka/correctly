import type { Ajv, FormatDefinition } from "ajv"
import { CorrectlyError } from "./types.ts"
import { schemaChildren } from "./schema-walk.ts"

/** Synchronous assertions and annotation-only keywords. Registration is explicit. */
export type AjvExtension = {
	id: string
	formats?: Readonly<
		Record<string, FormatDefinition<string> | FormatDefinition<number>>
	>
	annotations?: readonly string[]
}

type ExtensionSuggestion = {
	id: string
	formats: readonly string[]
	guidance: string
}
// Discovery metadata only: implementations are installed by the consuming project.
export const knownExtensions: readonly ExtensionSuggestion[] = [
	{
		id: "@correctlyjs/schemars",
		formats: [
			"int",
			"uint",
			"int8",
			"uint8",
			"int16",
			"uint16",
			"int32",
			"uint32",
			"int64",
			"uint64",
			"int128",
			"uint128",
			"float",
			"double",
			"ip",
			"phone",
			"partial-date-time",
		],
		guidance: `For a Schemars-generated schema, install @correctlyjs/schemars and import { schemars } from "@correctlyjs/schemars/ajv". Select the schema's reviewed Schemars version with schemars({ version: "..." }) in this Ajv validator's extensions in correctly.config.ts.`,
	},
]

export function installExtensions(
	ajv: Ajv,
	extensions: readonly AjvExtension[],
): void {
	const formats = new Set<string>(),
		annotations = new Set<string>()
	const identifiers = new Set<string>()
	for (const extension of extensions) {
		if (
			!extension ||
			typeof extension !== "object" ||
			typeof extension.id !== "string" ||
			!extension.id
		)
			throw new CorrectlyError(
				"extension",
				"Pass extension implementations to ajv({ extensions: [...] }); string identifiers are not implementations.",
			)
		const id = extension.id
		if (identifiers.has(id))
			throw new CorrectlyError(
				"extension",
				`Duplicate extension identifier: ${id}`,
			)
		identifiers.add(id)
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
	registry: readonly ExtensionSuggestion[],
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
		const extension = registry.find((entry) => entry.formats.includes(format))
		const hint =
			extension?.guidance ??
			`Pass an extension implementing ${JSON.stringify(format)} to this Ajv validator's extensions in correctly.config.ts.`
		throw new CorrectlyError(
			"extension-required",
			`This schema needs an extension.\nFormat ${JSON.stringify(format)} has no enabled validator; validation cannot proceed.\nSchema: ${uri}#${location}/format\n${hint}`,
			{
				schemaUri: uri,
				schemaPointer: `${location}/format`,
				format,
				...(extension ? { suggestedExtension: extension.id } : {}),
			},
		)
	}
	for (const [path, child] of schemaChildren(object))
		assertFormats(ajv, child, uri, registry, location + path)
}
