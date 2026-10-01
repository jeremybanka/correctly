import {
	getLanguageService,
	type JSONDocument,
	type LanguageService,
	type Position,
} from "vscode-json-languageservice"
import type { TextDocument } from "vscode-languageserver-textdocument"
import { fileURLToPath } from "node:url"
import { associationFor, isIncluded } from "../core/config.ts"
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
		if (!isIncluded(engine.project, file)) return undefined
		const association = associationFor(engine.project, file)
		if (!association?.schema) return undefined
		await engine.validator(association.schema)
		let services = this.services.get(engine)
		if (!services) {
			services = new Map()
			this.services.set(engine, services)
		}
		let service = services.get(association.schema)
		if (!service) {
			service = getLanguageService({
				schemaRequestService: async (uri) =>
					JSON.stringify((await engine.store.load(uri)).schema),
				workspaceContext: {
					resolveRelativePath: (relative, resource) =>
						new URL(relative, resource).href,
				},
			})
			// A per-association service prevents overlapping rules being combined.
			service.configure({
				validate: false,
				schemas: [{ uri: association.schema, fileMatch: ["*"] }],
			})
			services.set(association.schema, service)
		}
		return service
	}
	async complete(engine: Engine, document: TextDocument, position: Position) {
		const service = await this.service(engine, document)
		return service
			? await service.doComplete(
					document,
					position,
					externalSelection(service.parseJSONDocument(document)),
				)
			: { isIncomplete: false, items: [] }
	}
	async hover(engine: Engine, document: TextDocument, position: Position) {
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
