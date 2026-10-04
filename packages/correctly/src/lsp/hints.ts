import {
	getLanguageService,
	type JSONDocument,
	type LanguageService,
	type Position,
} from "vscode-json-languageservice"
import type { TextDocument } from "vscode-languageserver-textdocument"
import { fileURLToPath } from "node:url"

import type { ProjectSession } from "../runtime/session.ts"
import type { Engine } from "../core/engine.ts"

// Only the schema-selection accessor is hidden. The original AST (including
// $schema as ordinary data) is retained by every bound traversal method.
export function externalSelection(document: JSONDocument): JSONDocument {
	return new Proxy(document, {
		get(target, key) {
			if (key === "root") return undefined
			const value: unknown = Reflect.get(target, key)
			return typeof value === "function" ? value.bind(target) : value
		},
	})
}

export class Hints {
	private readonly services = new WeakMap<
		Engine,
		Map<string, LanguageService>
	>()
	private async service(
		engine: Engine,
		document: TextDocument,
	): Promise<LanguageService | undefined> {
		const file = fileURLToPath(document.uri)
		const editor = await engine.editor(file)
		if (!editor) return undefined
		const key = String(editor.association)

		let services = this.services.get(engine)
		if (!services) {
			services = new Map()
			this.services.set(engine, services)
		}
		let service = services.get(key)
		if (!service) {
			service = getLanguageService({
				schemaRequestService: (uri) => editor.support.readSchema(uri),
				workspaceContext: {
					resolveRelativePath: (relative, resource) =>
						new URL(relative, resource).href,
				},
			})
			// A per-association service prevents overlapping rules being combined.
			service.configure({
				validate: false,
				schemas: [{ uri: editor.support.uri, fileMatch: ["*"] }],
			})
			services.set(key, service)
		}
		return service
	}
	async complete(
		engine: Engine | ProjectSession,
		document: TextDocument,
		position: Position,
	) {
		if (!("editor" in engine)) return engine.complete(document, position)
		const service = await this.service(engine, document)
		return service
			? await service.doComplete(
					document,
					position,
					externalSelection(service.parseJSONDocument(document)),
				)
			: { isIncomplete: false, items: [] }
	}
	async hover(
		engine: Engine | ProjectSession,
		document: TextDocument,
		position: Position,
	) {
		if (!("editor" in engine)) return engine.hover(document, position)
		const service = await this.service(engine, document)
		return service
			? await service.doHover(
					document,
					position,
					externalSelection(service.parseJSONDocument(document)),
				)
			: null
	}
}
