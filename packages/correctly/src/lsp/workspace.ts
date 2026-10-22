import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { TextDocument } from "vscode-languageserver-textdocument"
import picomatch from "picomatch"
import {
	contains,
	discoverConfig,
	CONFIG_NAME,
	modeFor,
} from "../core/config.ts"
import { ProjectSession } from "../runtime/session.ts"
import { CorrectlyError, failure, type FileResult } from "../core/types.ts"
import { diagnostic } from "../core/parse.ts"

export class Workspace {
	onSchema: ((uri: string) => void) | undefined
	roots: string[]
	readonly documents = new Map<string, TextDocument>()
	private readonly engines = new Map<string, ProjectSession>()
	generation = 0
	constructor(roots: string[]) {
		this.roots = roots
	}

	invalidate() {
		this.generation++
		for (const session of this.engines.values()) void session.dispose()
		this.engines.clear()
	}

	open(document: TextDocument): boolean {
		this.documents.set(document.uri, document)
		const resource =
			this.isSchema(document.uri) && !this.moduleUris.has(document.uri)
		if (resource) this.invalidate()
		return resource
	}
	close(uri: string): boolean {
		const resource = this.isSchema(uri) && !this.moduleUris.has(uri)
		this.documents.delete(uri)
		if (resource) this.invalidate()
		return resource
	}
	private readonly schemaUris = new Set<string>()
	private isSchema(uri: string): boolean {
		if (this.schemaUris.has(uri)) return true
		for (const resource of this.schemaUris) {
			const url = new URL(resource)
			const pattern = url.searchParams.get("correctly-glob")
			if (pattern && uri.startsWith("file:")) {
				const relative = path
					.relative(fileURLToPath(url), fileURLToPath(uri))
					.split(path.sep)
					.join("/")
				if (picomatch(pattern, { dot: true })(relative)) return true
			}
		}
		return false
	}
	private readonly moduleUris = new Set<string>()
	resourceChanged(uri: string): boolean {
		return (
			uri.endsWith(`/${CONFIG_NAME}`) ||
			uri.endsWith("/.gitignore") ||
			this.isSchema(uri) ||
			this.moduleUris.has(uri) ||
			/\/(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(
				uri,
			)
		)
	}

	async engineFor(uri: string): Promise<ProjectSession> {
		const file = fileURLToPath(uri)
		const root = this.roots
			.filter((r) => contains(r, file))
			.sort((a, b) => b.length - a.length)[0]
		if (this.roots.length && !root)
			throw new CorrectlyError(
				"config",
				`Document is outside the editor workspace: ${file}`,
			)
		const configPath = await discoverConfig(path.dirname(file), root)
		let session = this.engines.get(configPath)
		if (!session) {
			session = new ProjectSession(configPath, {
				buffers: [...this.documents].map(([uri, document]) => [
					uri,
					document.getText(),
				]),
				onDependency: (dependency, kind) => {
					;(kind === "module" ? this.moduleUris : this.schemaUris).add(
						dependency,
					)
					this.onSchema?.(dependency)
				},
			})
			this.engines.set(configPath, session)
		}
		await session.ready
		return session
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
			if (
				problem.code === "config" &&
				problem.message.startsWith(`No ${CONFIG_NAME} found`) &&
				!["json", "jsonc", "yaml", "toml", "pkl"].includes(document.languageId)
			)
				return {
					file: fileURLToPath(document.uri),
					mode: document.languageId,
					association: null,
					coverage: "excluded",
					diagnostics: [],
					failures: [],
				}

			return {
				file: fileURLToPath(document.uri),
				mode: modeFor(fileURLToPath(document.uri)),
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
