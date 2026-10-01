import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { AnySchema, SchemaObject } from "ajv"
import { parseDocument } from "./parse.ts"
import { readText, type Project, type ReadText } from "./config.ts"
import { CorrectlyError } from "./types.ts"

export type Dialect = "draft7" | "2020-12"
export const DIALECTS = {
	draft7: "http://json-schema.org/draft-07/schema#",
	"2020-12": "https://json-schema.org/draft/2020-12/schema",
} as const
const VOCABULARIES = new Set(
	[
		"core",
		"applicator",
		"unevaluated",
		"validation",
		"meta-data",
		"format-annotation",
		"content",
	].map((name) => `https://json-schema.org/draft/2020-12/vocab/${name}`),
)
const SINGLE_SCHEMAS = [
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
]
const MAP_SCHEMAS = [
	"properties",
	"patternProperties",
	"definitions",
	"$defs",
	"dependentSchemas",
	"dependencies",
]
const ARRAY_SCHEMAS = ["allOf", "anyOf", "oneOf", "prefixItems"]

function isObject(value: unknown): value is SchemaObject {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
function dialect(value: unknown, inherited: Dialect): Dialect {
	if (value === undefined) return inherited
	if (typeof value !== "string")
		throw new CorrectlyError("schema", "Schema $schema must be a string")
	const id = value.replace(/#$/, "")
	if (
		id === "http://json-schema.org/draft-07/schema" ||
		id === "https://json-schema.org/draft-07/schema"
	)
		return "draft7"
	if (id === DIALECTS["2020-12"]) return "2020-12"
	throw new CorrectlyError(
		"unsupported-dialect",
		`Unsupported schema dialect: ${value}; supported: draft 7, draft 2020-12`,
	)
}

export type SchemaResource = {
	uri: string
	schema: AnySchema
	dialect: Dialect
}
type CacheEntry = {
	uri: string
	text: string
	etag?: string
	lastModified?: string
}
export type StoreOptions = {
	offline?: boolean
	read?: ReadText
	fetch?: typeof fetch
	signal?: AbortSignal
}

export class SchemaStore {
	private readonly options: StoreOptions
	readonly resources = new Map<string, SchemaResource>()
	private readonly pending = new Map<string, Promise<SchemaResource>>()
	private readonly cacheDir: string
	private readonly offline: boolean
	private readonly timeoutMs: number
	private readonly maxBytes: number
	private readonly maxRequests: number
	private readonly read: ReadText
	private readonly request: typeof fetch
	private requests = 0
	constructor(project: Project, options: StoreOptions = {}) {
		this.options = options
		const remote = project.config.remote
		this.cacheDir = path.resolve(
			project.root,
			remote?.cacheDir ?? ".correctly-cache",
		)
		this.offline = options.offline ?? remote?.offline ?? false
		this.timeoutMs = remote?.timeoutMs ?? 5000
		this.maxBytes = remote?.maxBytes ?? 2 * 1024 * 1024
		this.maxRequests = remote?.maxRequests ?? 64
		this.read = options.read ?? readText
		this.request = options.fetch ?? fetch
	}

	async load(
		value: string,
		inherited: Dialect = "draft7",
	): Promise<SchemaResource> {
		this.options.signal?.throwIfAborted()
		const url = new URL(value)
		url.hash = ""
		const uri = url.href
		const known = this.resources.get(uri)
		if (known) return known
		let promise = this.pending.get(uri)
		if (!promise) {
			promise = this.loadResource(uri, inherited)
			this.pending.set(uri, promise)
		}
		return promise
	}

	private async loadResource(
		uri: string,
		inherited: Dialect,
	): Promise<SchemaResource> {
		if (++this.requests > this.maxRequests)
			throw new CorrectlyError(
				"schema-limit",
				`Schema resource limit (${this.maxRequests}) exceeded`,
			)
		let text: string
		const url = new URL(uri)
		try {
			if (url.protocol === "file:") text = await this.read(uri)
			else if (url.protocol === "https:" || url.protocol === "http:")
				text = await this.remote(uri)
			else
				throw new CorrectlyError(
					"schema",
					`Unsupported schema protocol: ${url.protocol}`,
				)
		} catch (error) {
			if (error instanceof CorrectlyError) throw error
			throw new CorrectlyError(
				"schema-load",
				`Cannot load schema ${uri}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
		this.options.signal?.throwIfAborted()
		if (Buffer.byteLength(text) > this.maxBytes)
			throw new CorrectlyError(
				"schema-limit",
				`Schema ${uri} exceeds ${this.maxBytes} bytes`,
			)
		const parsed = parseDocument(text, "json")
		if (parsed.diagnostics.length) {
			const d = parsed.diagnostics[0]!
			throw new CorrectlyError(
				"schema",
				`Invalid schema JSON at ${uri}:${d.range.start.line + 1}:${d.range.start.character + 1}: ${d.message}`,
			)
		}
		if (typeof parsed.value !== "boolean" && !isObject(parsed.value))
			throw new CorrectlyError(
				"schema",
				`Schema must be an object or boolean: ${uri}`,
			)
		const rootDialect = dialect(
			isObject(parsed.value) ? parsed.value.$schema : undefined,
			inherited,
		)
		const schema = parsed.value as AnySchema
		const resource: SchemaResource = { uri, schema, dialect: rootDialect }
		// Normalize schema identifiers only, never document data or annotation values.
		this.normalize(schema, uri, rootDialect, resource)
		if (isObject(schema) && schema.$id === undefined) schema.$id = uri
		this.register(uri, resource)
		return resource
	}

	private register(uri: string, resource: SchemaResource) {
		const previous = this.resources.get(uri)
		if (previous && previous.schema !== resource.schema)
			throw new CorrectlyError("schema", `Duplicate schema identifier: ${uri}`)
		this.resources.set(uri, resource)
	}

	private normalize(
		schema: unknown,
		base: string,
		expected: Dialect,
		root: SchemaResource,
	) {
		if (!isObject(schema)) return
		const ownDialect = dialect(schema.$schema, expected)
		if (ownDialect !== expected)
			throw new CorrectlyError(
				"unsupported-dialect",
				`Mixed schema dialects at ${base} are not supported`,
			)
		if (schema.$schema !== undefined) schema.$schema = DIALECTS[ownDialect]
		if (schema.$async !== undefined)
			throw new CorrectlyError(
				"schema",
				`Asynchronous data validation is not supported: ${base}`,
			)
		if (schema.$vocabulary !== undefined) {
			if (!isObject(schema.$vocabulary))
				throw new CorrectlyError(
					"schema",
					`$vocabulary must be an object: ${base}`,
				)
			for (const [vocabulary, required] of Object.entries(schema.$vocabulary)) {
				if (typeof required !== "boolean")
					throw new CorrectlyError(
						"schema",
						`$vocabulary values must be boolean: ${base}`,
					)
				if (required && !VOCABULARIES.has(vocabulary))
					throw new CorrectlyError(
						"unsupported-vocabulary",
						`Unsupported required vocabulary: ${vocabulary}`,
					)
			}
		}
		let scope = base
		if (schema.$id !== undefined) {
			if (typeof schema.$id !== "string")
				throw new CorrectlyError("schema", `$id must be a string: ${base}`)
			scope = new URL(schema.$id, base).href
			schema.$id = scope
			this.register(scope.replace(/#$/, ""), { ...root, schema })
		}
		for (const anchor of [schema.$anchor, schema.$dynamicAnchor]) {
			if (typeof anchor === "string")
				this.register(new URL(`#${anchor}`, scope).href, { ...root, schema })
		}
		for (const key of SINGLE_SCHEMAS)
			this.normalize(schema[key], scope, expected, root)
		for (const key of MAP_SCHEMAS) {
			if (isObject(schema[key]))
				for (const child of Object.values(
					schema[key] as Record<string, unknown>,
				))
					this.normalize(child, scope, expected, root)
		}
		for (const key of [...ARRAY_SCHEMAS, "items"]) {
			const children: unknown = schema[key]
			if (Array.isArray(children))
				for (const child of children)
					this.normalize(child, scope, expected, root)
			else if (key === "items") this.normalize(children, scope, expected, root)
		}
	}

	private async remote(uri: string): Promise<string> {
		const cacheFile = path.join(
			this.cacheDir,
			`${createHash("sha256").update(uri).digest("hex")}.json`,
		)
		let cached: CacheEntry | undefined
		try {
			const raw = await readFile(cacheFile, "utf8")
			const entry: unknown = JSON.parse(raw)
			if (
				!isObject(entry) ||
				entry.uri !== uri ||
				typeof entry.text !== "string"
			)
				throw new Error("invalid cache entry")
			cached = entry as CacheEntry
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				throw new CorrectlyError(
					"schema-cache",
					`Cannot read schema cache ${cacheFile}: ${String(error)}`,
				)
		}
		if (this.offline) {
			if (!cached)
				throw new CorrectlyError(
					"offline-miss",
					`Schema is not cached in offline mode: ${uri}`,
				)
			return cached.text
		}
		const timeout = AbortSignal.timeout(this.timeoutMs)
		const signal = this.options.signal
			? AbortSignal.any([this.options.signal, timeout])
			: timeout
		const headers: Record<string, string> = {}
		if (cached?.etag) headers["If-None-Match"] = cached.etag
		if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified
		let current = uri
		for (let redirects = 0; redirects <= 5; redirects++) {
			const response = await this.request(current, {
				signal,
				headers,
				redirect: "manual",
			})
			if ([301, 302, 303, 307, 308].includes(response.status)) {
				await response.body?.cancel()
				const location = response.headers.get("location")
				if (!location)
					throw new CorrectlyError(
						"schema-load",
						`Redirect without location: ${current}`,
					)
				current = new URL(location, current).href
				if (!["http:", "https:"].includes(new URL(current).protocol))
					throw new CorrectlyError(
						"schema-load",
						`Unsupported redirect: ${current}`,
					)
				continue
			}
			if (response.status === 304 && cached) {
				await response.body?.cancel()
				return cached.text
			}
			if (!response.ok || !response.body) {
				await response.body?.cancel()
				throw new CorrectlyError(
					"schema-load",
					`HTTP ${response.status} loading schema ${uri}`,
				)
			}
			const reader = response.body.getReader()
			const chunks: Uint8Array[] = []
			let size = 0
			try {
				while (true) {
					const { value, done } = await reader.read()
					if (done) break
					size += value.byteLength
					if (size > this.maxBytes)
						throw new CorrectlyError(
							"schema-limit",
							`Schema ${uri} exceeds ${this.maxBytes} bytes`,
						)
					chunks.push(value)
				}
			} finally {
				await reader.cancel()
			}
			const text = Buffer.concat(chunks).toString("utf8")
			const entry: CacheEntry = { uri, text }
			const etag = response.headers.get("etag")
			const lastModified = response.headers.get("last-modified")
			if (etag) entry.etag = etag
			if (lastModified) entry.lastModified = lastModified
			signal.throwIfAborted()
			await mkdir(this.cacheDir, { recursive: true })
			const temporary = `${cacheFile}.${randomUUID()}.tmp`
			await writeFile(temporary, JSON.stringify(entry))
			await rename(temporary, cacheFile)
			return text
		}
		throw new CorrectlyError(
			"schema-limit",
			`Too many redirects loading schema ${uri}`,
		)
	}
}

export function localSchemaPath(uri: string): string | undefined {
	const url = new URL(uri)
	return url.protocol === "file:" ? fileURLToPath(url) : undefined
}
