import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { TextDocument } from "vscode-languageserver-textdocument"
import {
	contains,
	discoverConfig,
	loadProject,
	readText,
	type ReadText,
} from "../core/config.ts"
import { Engine } from "../core/engine.ts"
import { CorrectlyError, failure, type FileResult } from "../core/types.ts"
import { diagnostic } from "../core/parse.ts"

export class Workspace {
	onSchema: ((uri: string) => void) | undefined
	roots: string[]
	private readonly read: ReadText
	readonly documents = new Map<string, TextDocument>()
	private readonly engines = new Map<string, Promise<Engine>>()
	private controller = new AbortController()
	generation = 0
	constructor(roots: string[], read: ReadText = readText) {
		this.roots = roots
		this.read = read
	}

	invalidate() {
		this.generation++
		this.controller.abort()
		this.controller = new AbortController()
		this.engines.clear()
	}

	open(document: TextDocument): boolean {
		this.documents.set(document.uri, document)
		const resource =
			path.basename(fileURLToPath(document.uri)) === "correctly.config.json" ||
			this.isSchema(document.uri)
		if (resource) this.invalidate()
		return resource
	}
	close(uri: string): boolean {
		const resource =
			uri.endsWith("/correctly.config.json") || this.isSchema(uri)
		this.documents.delete(uri)
		if (resource) this.invalidate()
		return resource
	}
	private readonly schemaUris = new Set<string>()
	private isSchema(uri: string): boolean {
		return this.schemaUris.has(uri)
	}
	resourceChanged(uri: string): boolean {
		return uri.endsWith("/correctly.config.json") || this.isSchema(uri)
	}
	private readonly readBuffer: ReadText = (uri) => {
		const document = this.documents.get(uri)
		return document ? Promise.resolve(document.getText()) : this.read(uri)
	}

	async engineFor(uri: string): Promise<Engine> {
		const file = fileURLToPath(uri)
		const root = this.roots
			.filter((r) => contains(r, file))
			.sort((a, b) => b.length - a.length)[0]
		if (this.roots.length && !root)
			throw new CorrectlyError(
				"config",
				`Document is outside the editor workspace: ${file}`,
			)
		const virtualConfigs = new Set(
			[...this.documents.keys()]
				.filter((key) => key.endsWith("/correctly.config.json"))
				.map((key) => fileURLToPath(key)),
		)
		const configPath = await discoverConfig(
			path.dirname(file),
			root,
			virtualConfigs,
		)
		let promise = this.engines.get(configPath)
		if (!promise) {
			const signal = this.controller.signal
			promise = (async () => {
				const project = await loadProject(configPath, this.readBuffer)
				const readSchema: ReadText = async (schema) => {
					this.schemaUris.add(schema)
					this.onSchema?.(schema)
					return this.readBuffer(schema)
				}
				const engine = new Engine(project, { read: readSchema, signal })
				await engine.prepare()
				for (const resource of engine.store.resources.values())
					this.schemaUris.add(resource.uri)
				signal.throwIfAborted()
				return engine
			})()
			this.engines.set(configPath, promise)
		}
		return promise
	}

	async validate(document: TextDocument): Promise<FileResult> {
		try {
			const engine = await this.engineFor(document.uri)
			return await engine.validate(
				fileURLToPath(document.uri),
				document.getText(),
			)
		} catch (error) {
			const problem = failure(error, fileURLToPath(document.uri))
			return {
				file: fileURLToPath(document.uri),
				mode: document.languageId === "jsonc" ? "jsonc" : "json",
				association: null,
				coverage: "syntax-only",
				diagnostics: [
					diagnostic(document.getText(), problem.code, problem.message),
				],
				failures: [problem],
			}
		}
	}

	documentPath(uri: string): string {
		return fileURLToPath(uri)
	}
	rootUris(): string[] {
		return this.roots.map((root) => pathToFileURL(root).href)
	}
}
