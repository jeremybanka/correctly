import {
	Ajv,
	type ErrorObject,
	type ValidateFunction,
	type SchemaObject,
} from "ajv"
import { Ajv2020 } from "ajv/dist/2020.js"
import addFormats from "ajv-formats"
import {
	associationFor,
	isIncluded,
	modeFor,
	schemaUri,
	type Project,
} from "./config.ts"
import {
	diagnostic,
	parseDocument,
	pointer,
	type ParsedDocument,
} from "./parse.ts"
import { DIALECTS, SchemaStore, type StoreOptions } from "./schemas.ts"
import { validationContexts } from "./diagnostics.ts"
import {
	CorrectlyError,
	failure,
	type Diagnostic,
	type FileResult,
} from "./types.ts"

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

export class Engine {
	readonly project: Project
	readonly store: SchemaStore
	private readonly compiled = new Map<string, Promise<ValidateFunction>>()
	constructor(project: Project, options: StoreOptions = {}) {
		this.project = project
		this.store = new SchemaStore(project, options)
	}

	validator(uri: string): Promise<ValidateFunction> {
		let compiled = this.compiled.get(uri)
		if (!compiled) {
			compiled = this.compile(uri)
			this.compiled.set(uri, compiled)
		}
		return compiled
	}

	private async compile(uri: string): Promise<ValidateFunction> {
		try {
			const resource = await this.store.load(uri)
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
					const loaded = await this.store.load(ref, resource.dialect)
					if (loaded.dialect !== resource.dialect)
						throw new CorrectlyError(
							"unsupported-dialect",
							`Mixed schema dialects: ${uri} references ${ref}`,
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
			for (const keyword of ANNOTATIONS)
				if (!ajv.RULES.keywords[keyword])
					ajv.addKeyword({ keyword, valid: true })
			// Ajv indexes plain anchors during reference resolution, but does not
			// register the annotation keyword in its strict vocabulary.
			if (resource.dialect === "2020-12")
				ajv.addKeyword({
					keyword: "$anchor",
					schemaType: "string",
					valid: true,
				})
			ajv.addSchema(resource.schema, resource.uri)
			registerRootAnchors(ajv, resource.schema, resource.uri)
			const validate = await ajv.compileAsync({
				$schema: DIALECTS[resource.dialect],
				$ref: uri,
			})
			return validate as ValidateFunction
		} catch (error) {
			if (error instanceof CorrectlyError) throw error
			throw new CorrectlyError(
				"schema",
				`Cannot compile schema ${uri}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	async prepare(): Promise<void> {
		// Register configured resources before compiling references to their IDs.
		for (const association of this.project.config.associations) {
			if (association.schema !== null)
				await this.store.load(schemaUri(association.schema, this.project.root))
		}
		for (const association of this.project.config.associations) {
			if (association.schema !== null)
				await this.validator(schemaUri(association.schema, this.project.root))
		}
	}

	async validate(file: string, text: string): Promise<FileResult> {
		const association = associationFor(this.project, file)
		const mode = association?.mode ?? modeFor(file)
		const result: FileResult = {
			file,
			mode,
			association,
			coverage: "excluded",
			diagnostics: [],
			failures: [],
		}
		if (!isIncluded(this.project, file)) return result
		result.coverage = association?.schema ? "schema" : "syntax-only"
		const parsed = parseDocument(text, mode)
		result.diagnostics.push(...parsed.diagnostics)
		if (association?.schema) {
			try {
				const validate = await this.validator(association.schema)
				if (parsed.diagnostics.length === 0 && !validate(parsed.value)) {
					result.diagnostics.push(
						...validationContexts(
							validate.errors ?? [],
							(validate.errors ?? []).map((e) =>
								validationDiagnostic(text, parsed, e),
							),
						),
					)
				}
			} catch (error) {
				result.failures.push(failure(error, file))
			}
		}
		return result
	}
}
