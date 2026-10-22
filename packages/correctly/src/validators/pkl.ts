import { stat, readFile, mkdir, rename, writeFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { glob } from "tinyglobby"
import type { ValidationContext, Validator } from "../core/adapters.ts"
import { parseDocument } from "../core/parse.ts"
import { CorrectlyError } from "../core/types.ts"
import {
	hostPath,
	pklDiagnostic,
	runPkl,
	wasmPath,
} from "../core/pkl-runtime.ts"

export type PklOptions = {
	/** Validate the evaluated JSON value with another validator, such as ajv(). */
	validate?: Validator
	/** Only these environment variables are visible to read("env:..."). */
	environment?: Record<string, string>
	/** Values visible to read("prop:..."). */
	properties?: Record<string, string>
}

export function pkl(options: PklOptions = {}): Validator {
	if (options.validate && !options.validate.accepts.includes("json"))
		throw new CorrectlyError(
			"adapter-incompatible",
			"The nested Pkl validator must accept JSON values",
		)
	return {
		id: "pkl",
		accepts: ["pkl"],
		...(options.validate?.schema ? { schema: options.validate.schema } : {}),
		...(options.validate?.extensions
			? { extensions: options.validate.extensions }
			: {}),
		register: (context) => options.validate?.register?.(context),
		async prepare(context) {
			const nested = await options.validate?.prepare(context)
			const remote = new PklRemote(context)
			return {
				async validate(input) {
					const resources: Record<string, unknown> = Object.create(
						null,
					) as Record<string, unknown>
					// The source buffer must win even when an import reads the entry module.
					resources[JSON.stringify(["text", wasmPath(input.file)])] = input.text
					resources[JSON.stringify(["exists", wasmPath(input.file)])] = true
					let totalBytes = Buffer.byteLength(input.text)
					for (let attempt = 0; attempt < 256; attempt++) {
						input.signal?.throwIfAborted()
						if (totalBytes > 16 * 1024 * 1024)
							throw new CorrectlyError(
								"pkl-limit",
								"Pkl resources exceed 16 MiB",
							)
						const outcome = await runPkl({
							source: input.text,
							file: wasmPath(input.file),
							evaluate: true,
							resources,
							...(options.environment
								? { environment: options.environment }
								: {}),
							...(options.properties ? { properties: options.properties } : {}),
						})
						input.signal?.throwIfAborted()
						if (outcome.requests?.length) {
							for (const key of outcome.requests) {
								if (Object.hasOwn(resources, key))
									throw new CorrectlyError(
										"pkl-runtime",
										"pklr repeated a resolved resource request",
									)
								if (Object.keys(resources).length >= 512)
									throw new CorrectlyError(
										"pkl-limit",
										"Too many Pkl resources",
									)
								const [kind, argument] = JSON.parse(key) as [string, string]
								const value = await resource(
									context,
									remote,
									kind,
									argument,
									input.signal,
								)
								resources[key] = value
								totalBytes +=
									typeof value === "string"
										? Buffer.byteLength(value)
										: Array.isArray(value)
											? value.length
											: 0
							}
							continue
						}
						if (outcome.error)
							return [pklDiagnostic(input.text, input.file, outcome.error)]
						if (!nested) return []
						if (outcome.json === undefined)
							throw new CorrectlyError(
								"pkl-runtime",
								"pklr returned no evaluated JSON",
							)
						const json = parseDocument(outcome.json, "json")
						return nested.validate({
							...input,
							parsed: {
								value: json.value,
								diagnostics: [],
								rawNumber: json.rawNumber!,
								// pklr does not expose evaluation source maps. Report derived values at the module.
								locate: () => ({ offset: 0, length: input.text.length }),
							},
						})
					}
					throw new CorrectlyError(
						"pkl-limit",
						"Pkl evaluation requires too many resource passes",
					)
				},
				...(nested?.dispose ? { dispose: () => nested.dispose!() } : {}),
			}
		},
	}
}

async function resource(
	context: ValidationContext,
	remote: PklRemote,
	kind: string,
	argument: string,
	signal?: AbortSignal,
): Promise<unknown> {
	signal?.throwIfAborted()
	if (kind === "fetch-text" || kind === "fetch-bytes") {
		const bytes = await remote.load(argument, signal)
		return kind === "fetch-text" ? bytes.toString("utf8") : [...bytes]
	}
	if (kind === "glob") {
		const [base, pattern] = JSON.parse(argument) as [string, string]
		const files = await glob(pattern, {
			cwd: hostPath(base),
			absolute: true,
			dot: true,
		})
		// Watch the glob itself so additions refresh results without watching cache writes.
		const dependency = pathToFileURL(hostPath(base))
		dependency.searchParams.set("correctly-glob", pattern)
		context.watch(dependency.href)
		for (const file of files) context.watch(pathToFileURL(file).href)
		return files.sort().map(wasmPath)
	}
	const file = hostPath(argument)
	const uri = pathToFileURL(file).href
	context.watch(uri)
	try {
		if (kind === "text") return await context.read(uri)
		if (kind === "bytes") return [...(await readFile(file))]
		if (kind === "exists") {
			// context.read also knows about unsaved files which don't exist on disk yet.
			try {
				await context.read(uri)
				return true
			} catch {
				return (await stat(file)).isDirectory()
			}
		}
	} catch (error) {
		if (kind === "exists" && (error as NodeJS.ErrnoException).code === "ENOENT")
			return false
		return { error: `Cannot read ${file}: ${String(error)}` }
	}
	throw new CorrectlyError("pkl-runtime", `Unknown pklr host request: ${kind}`)
}

class PklRemote {
	private readonly context: ValidationContext
	private readonly pending = new Map<string, Promise<Buffer>>()
	private requests = 0
	constructor(context: ValidationContext) {
		this.context = context
	}
	load(uri: string, signal?: AbortSignal): Promise<Buffer> {
		let pending = this.pending.get(uri)
		if (!pending) {
			pending = this.fetch(uri, signal).catch((error: unknown) => {
				this.pending.delete(uri)
				throw error
			})
			this.pending.set(uri, pending)
		}
		return pending
	}
	private async fetch(uri: string, signal?: AbortSignal): Promise<Buffer> {
		const context = this.context
		const remote = context.remote
		const url = new URL(uri)
		if (!["http:", "https:"].includes(url.protocol))
			throw new CorrectlyError(
				"pkl-resource",
				`Unsupported Pkl resource protocol: ${url.protocol}`,
			)
		const maxBytes = remote?.maxBytes ?? 2 * 1024 * 1024
		const directory = path.resolve(
			context.root,
			remote?.cacheDir ?? ".correctly-cache",
			"pkl",
		)
		const cached = path.join(
			directory,
			createHash("sha256").update(uri).digest("hex"),
		)
		if (remote?.offline) {
			try {
				const bytes = await readFile(cached)
				if (bytes.length > maxBytes)
					throw new CorrectlyError(
						"pkl-limit",
						`Cached resource exceeds ${maxBytes} bytes: ${uri}`,
					)
				return bytes
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT")
					throw new CorrectlyError(
						"pkl-offline",
						`Pkl resource is not cached in offline mode: ${uri}`,
					)
				throw error
			}
		}
		const timeout = AbortSignal.timeout(remote?.timeoutMs ?? 5000)
		const combined = AbortSignal.any([
			timeout,
			...(context.signal ? [context.signal] : []),
			...(signal ? [signal] : []),
		])
		let current = uri
		for (let redirects = 0; redirects < 6; redirects++) {
			if (++this.requests > (remote?.maxRequests ?? 64))
				throw new CorrectlyError("pkl-limit", "Too many Pkl remote requests")
			const response = await (context.fetch ?? fetch)(current, {
				redirect: "manual",
				signal: combined,
			})
			if ([301, 302, 303, 307, 308].includes(response.status)) {
				await response.body?.cancel()
				const location = response.headers.get("location")
				if (!location)
					throw new CorrectlyError(
						"pkl-resource",
						`Redirect has no location: ${current}`,
					)
				const next = new URL(location, current)
				if (!["http:", "https:"].includes(next.protocol))
					throw new CorrectlyError(
						"pkl-resource",
						`Unsupported Pkl redirect protocol: ${next.protocol}`,
					)
				current = next.href
				continue
			}
			if (!response.ok || !response.body) {
				await response.body?.cancel()
				throw new CorrectlyError(
					"pkl-resource",
					`Cannot fetch ${current}: HTTP ${response.status}`,
				)
			}
			const reader = response.body.getReader()
			const chunks: Uint8Array[] = []
			let size = 0
			try {
				while (true) {
					const { value, done } = await reader.read()
					if (done) break
					size += value.length
					if (size > maxBytes)
						throw new CorrectlyError(
							"pkl-limit",
							`Pkl resource exceeds ${maxBytes} bytes: ${uri}`,
						)
					chunks.push(value)
				}
			} finally {
				await reader.cancel()
			}
			combined.throwIfAborted()
			const bytes = Buffer.concat(chunks)
			await mkdir(directory, { recursive: true })
			const temporary = `${cached}.${randomUUID()}.tmp`
			await writeFile(temporary, bytes)
			await rename(temporary, cached)
			return bytes
		}
		throw new CorrectlyError("pkl-limit", `Too many redirects loading ${uri}`)
	}
}
