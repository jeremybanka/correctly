import {
	Ajv,
	type ErrorObject,
	type ValidateFunction,
	type SchemaObject,
} from "ajv"
import { Ajv2020 } from "ajv/dist/2020.js"
import addFormats from "ajv-formats"
import { schemaUri } from "../core/config.ts"
import { diagnostic, pointer, type ParsedDocument } from "../core/parse.ts"
import { DIALECTS, SchemaStore } from "../core/schemas.ts"
import { validationContexts } from "../core/diagnostics.ts"
import {
	knownExtensions,
	installExtensions,
	assertFormats,
	type AjvExtension,
} from "../core/extensions.ts"
import {
	CorrectlyError,
	isCorrectlyError,
	type Diagnostic,
} from "../core/types.ts"
import type { Validator, ValidationContext } from "../core/adapters.ts"

const ANNOTATIONS = [
	"markdownDescription",
	"enumDescriptions",
	"markdownEnumDescriptions",
	"defaultSnippets",
	"errorMessage",
	"patternErrorMessage",
	"deprecationMessage",
	"suggestSortText",
	"doNotSuggest",
	"allowComments",
	"allowTrailingCommas",
	"deprecated",
	"$vocabulary",
]

function registerRootAnchors(ajv: Ajv, schema: unknown, uri: string) {
	if (typeof schema !== "object" || schema === null) return
	const object = schema as SchemaObject
	for (const anchor of [object.$anchor, object.$dynamicAnchor]) {
		if (typeof anchor === "string")
			ajv.refs[new URL(`#${anchor}`, object.$id ?? uri).href] =
				object.$id ?? uri
	}
}

function validationMessage(error: ErrorObject): string {
	if (error.keyword === "anyOf")
		return "must match at least one alternative; none matched"
	if (
		error.keyword === "if" &&
		["then", "else"].includes(error.params.failingKeyword as string)
	)
		return `must satisfy the ${error.params.failingKeyword} branch of the conditional schema`
	if (error.keyword === "uniqueItems") {
		const { i, j } = error.params
		if (Number.isInteger(i) && Number.isInteger(j))
			return `duplicates item at ${error.instancePath}${pointer([Math.min(i, j)])}; array items must be unique`
	}
	if (error.keyword === "enum" && Array.isArray(error.params.allowedValues))
		return `must be one of: ${error.params.allowedValues.map((value: unknown) => JSON.stringify(value)).join(", ")}`
	if (error.keyword === "const" && Object.hasOwn(error.params, "allowedValue"))
		return `must equal ${JSON.stringify(error.params.allowedValue)}`
	if (error.keyword === "oneOf") {
		if (error.params.passingSchemas === null)
			return "must match exactly one alternative; none matched"
		if (Array.isArray(error.params.passingSchemas))
			return `must match exactly one alternative; multiple matched (alternatives ${error.params.passingSchemas.map((index: number) => index + 1).join(", ")})`
	}
	return error.message ?? "Schema violation"
}

function validationDiagnostic(
	text: string,
	parsed: ParsedDocument,
	error: ErrorObject,
): Diagnostic {
	let jsonPointer = error.instancePath
	if (
		error.keyword === "uniqueItems" &&
		Number.isInteger(error.params.i) &&
		Number.isInteger(error.params.j)
	)
		jsonPointer += pointer([Math.max(error.params.i, error.params.j)])
	const property: unknown =
		error.params.additionalProperty ??
		error.params.unevaluatedProperty ??
		error.params.missingProperty ??
		error.params.propertyName ??
		error.propertyName
	if (typeof property === "string") jsonPointer += pointer([property])
	const node = parsed.locate(
		jsonPointer,
		error.keyword === "additionalProperties" ||
			error.keyword === "unevaluatedProperties" ||
			error.keyword === "propertyNames" ||
			typeof error.propertyName === "string",
	)
	const rangeNode =
		error.keyword === "required" && error.propertyName === undefined
			? parsed.locate(error.instancePath)
			: node
	const length =
		error.keyword === "required" && error.propertyName === undefined
			? 1
			: rangeNode?.length
	return diagnostic(
		text,
		`schema/${error.keyword}`,
		`${jsonPointer || "/"}: ${validationMessage(error)}`,
		jsonPointer,
		rangeNode?.offset ?? 0,
		length ?? 1,
	)
}

async function compile(
	store: SchemaStore,
	uri: string,
	extensions: readonly AjvExtension[],
): Promise<ValidateFunction> {
	try {
		const resource = await store.load(uri)
		const options = {
			allErrors: true,
			strictSchema: true,
			strictTypes: false,
			strictTuples: false,
			strictRequired: false,
			coerceTypes: false,
			useDefaults: false,
			removeAdditional: false,
			validateSchema: true,
			loadSchema: async (ref: string) => {
				const loaded = await store.load(ref, resource.dialect)
				if (loaded.dialect !== resource.dialect)
					throw new CorrectlyError(
						"unsupported-dialect",
						`Mixed schema dialects: ${uri} references ${ref}`,
					)
				assertFormats(
					ajv,
					loaded.schema,
					loaded.uri,
					knownExtensions,
					loaded.pointer,
				)
				registerRootAnchors(ajv, loaded.schema, loaded.uri)
				return loaded.schema as SchemaObject
			},
		}
		const ajv =
			resource.dialect === "2020-12" ? new Ajv2020(options) : new Ajv(options)
		// CommonJS package exports retain a callable default at runtime.
		const formats = addFormats as unknown as (instance: Ajv) => void
		formats(ajv)
		// ajv-formats also ships OpenAPI numeric names. Their width semantics
		// belong to an explicitly selected extension, not the baseline.
		for (const name of ["int32", "int64", "float", "double"])
			delete ajv.formats[name]
		for (const keyword of ANNOTATIONS)
			if (!ajv.RULES.keywords[keyword]) ajv.addKeyword({ keyword, valid: true })
		// Ajv indexes plain anchors during reference resolution, but does not
		// register the annotation keyword in its strict vocabulary.
		if (resource.dialect === "2020-12")
			ajv.addKeyword({
				keyword: "$anchor",
				schemaType: "string",
				valid: true,
			})
		installExtensions(ajv, extensions)
		assertFormats(
			ajv,
			resource.schema,
			resource.uri,
			knownExtensions,
			resource.pointer,
		)
		ajv.addSchema(resource.schema, resource.uri)
		registerRootAnchors(ajv, resource.schema, resource.uri)
		const validate = await ajv.compileAsync({
			$schema: DIALECTS[resource.dialect],
			$ref: uri,
		})
		return validate as ValidateFunction
	} catch (error) {
		if (isCorrectlyError(error)) throw error
		throw new CorrectlyError(
			"schema",
			`Cannot compile schema ${uri}: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

const storeKey = Symbol.for("correctly/ajv/schema-store@1")
function schemaStore(context: ValidationContext): SchemaStore {
	let store = context.services.get(storeKey) as SchemaStore | undefined
	if (!store) {
		store = new SchemaStore(
			{
				root: context.root,
				config: context.remote ? { remote: context.remote } : {},
			},
			{
				read: context.read,
				...(context.fetch ? { fetch: context.fetch } : {}),
				...(context.signal ? { signal: context.signal } : {}),
			},
		)
		context.services.set(storeKey, store)
	}
	return store
}
export type AjvOptions = {
	schema: string
	extensions?: readonly AjvExtension[]
}
export function ajv(options: AjvOptions): Validator {
	const extensions = [...(options.extensions ?? [])]
	return {
		id: "ajv",
		accepts: ["json"],
		schema: options.schema,
		extensions,
		register: async (context) => {
			await schemaStore(context).load(schemaUri(options.schema, context.root))
		},
		prepare: async (context) => {
			const store = schemaStore(context)
			const uri = schemaUri(options.schema, context.root)
			const validate = await compile(store, uri, extensions)
			return {
				validate: ({ text, parsed }) =>
					validate(parsed.value)
						? []
						: validationContexts(
								validate.errors ?? [],
								(validate.errors ?? []).map((error) =>
									validationDiagnostic(text, parsed, error),
								),
							),
				editor: {
					kind: "json-schema",
					uri,
					readSchema: async (uri) =>
						JSON.stringify((await store.load(uri)).schema),
				},
			}
		},
	}
}
export type { AjvExtension } from "../core/extensions.ts"
