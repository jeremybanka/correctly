import { parentPort } from "node:worker_threads"
import { registerHooks } from "node:module"
import { TextDocument } from "vscode-languageserver-textdocument"
import { loadProject, readText } from "../core/config.ts"
import { Engine } from "../core/engine.ts"
import { failure, type Position } from "../core/types.ts"
import { Hints } from "../lsp/hints.ts"
import { checkProject } from "../cli/check.ts"

if (!parentPort) throw new Error("Correctly project runtime requires a worker")
const port = parentPort
let engine: Engine | undefined
const hints = new Hints()
const controller = new AbortController()
const dependencies = new Set<string>()
function dependency(uri: string, kind: "module" | "resource") {
	const key = `${kind}:${uri}`
	if (!uri.startsWith("file:") || dependencies.has(key)) return
	dependencies.add(key)
	port.postMessage({ dependency: { uri, kind } })
}
// Comline owns loading; hooks only observe dependencies, including failed relative imports.
registerHooks({
	resolve(specifier, context, next) {
		if (
			context.parentURL &&
			(specifier.startsWith(".") || specifier.startsWith("file:"))
		)
			dependency(new URL(specifier, context.parentURL).href, "module")
		const result = next(specifier, context)
		dependency(result.url, "module")
		return result
	},
})
port.on(
	"message",
	(message: {
		id: number
		method: string
		params: Record<string, unknown>
	}) => {
		void (async () => {
			const p = message.params
			if (message.method === "dispose") {
				controller.abort()
				await engine?.dispose()
				return
			}
			if (message.method === "init") {
				const buffers = new Map(p.buffers as [string, string][])
				const project = await loadProject(p.configPath as string)
				engine = new Engine(project, {
					signal: controller.signal,
					read: (uri) =>
						buffers.has(uri)
							? Promise.resolve(buffers.get(uri)!)
							: readText(uri),
					...(p.offline === undefined ? {} : { offline: p.offline as boolean }),
					onDependency: (uri) => dependency(uri, "resource"),
				})
				await engine.prepare()
				return
			}
			if (!engine) throw new Error("Project is not initialized")
			if (message.method === "validate")
				return engine.validate(p.file as string, p.text as string)
			if (message.method === "check") {
				const sources: [string, string][] = []
				const report = await checkProject(engine, {
					cwd: p.cwd as string,
					...(p.files ? { files: p.files as string[] } : {}),
					...(p.sources
						? {
								onRead: (file: string, text: string) => {
									sources.push([file, text])
								},
							}
						: {}),
				})
				return { report, sources }
			}
			const document = TextDocument.create(
				p.uri as string,
				p.language as string,
				p.version as number,
				p.text as string,
			)
			if (message.method === "complete")
				return hints.complete(engine, document, p.position as Position)
			if (message.method === "hover")
				return hints.hover(engine, document, p.position as Position)
			throw new Error(`Unknown project operation: ${message.method}`)
		})().then(
			(value) => port.postMessage({ id: message.id, value }),
			(error: unknown) =>
				port.postMessage({ id: message.id, error: failure(error) }),
		)
	},
)
