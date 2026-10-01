#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import {
	createConnection,
	TextDocuments,
	TextDocumentSyncKind,
	DidChangeWatchedFilesNotification,
	ResponseError,
	LSPErrorCodes,
	type CancellationToken,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"
import { Workspace } from "./workspace.ts"
import { Hints } from "./hints.ts"
import type { FileResult } from "../core/types.ts"
import { diagnostic } from "../core/parse.ts"

export function lspDiagnostics(result: FileResult, text: string) {
	return [
		...result.diagnostics,
		...result.failures
			.filter(
				(f) =>
					!result.diagnostics.some(
						(d) => d.code === f.code && d.message === f.message,
					),
			)
			.map((f) => diagnostic(text, f.code, f.message)),
	].map((d) => ({
		range: d.range,
		message: d.message,
		code: d.code,
		severity: 1 as const,
		source: "correctly",
		data: { pointer: d.pointer },
	}))
}

export function startServer() {
	const connection = createConnection()
	const documents = new TextDocuments(TextDocument)
	const workspace = new Workspace([])
	const hints = new Hints()
	const jobs = new Map<
		string,
		{ controller: AbortController; timer: ReturnType<typeof setTimeout> }
	>()
	let dynamicWatch = false
	const watchedSchemas = new Set<string>()
	workspace.onSchema = (uri) => {
		if (!dynamicWatch || !uri.startsWith("file:") || watchedSchemas.has(uri))
			return
		watchedSchemas.add(uri)
		const file = fileURLToPath(uri)
		void connection.client
			.register(DidChangeWatchedFilesNotification.type, {
				watchers: [
					{
						globPattern: {
							baseUri: pathToFileURL(path.dirname(file)).href,
							pattern: path.basename(file),
						},
					},
				],
			})
			.catch((error: unknown) => connection.console.error(String(error)))
	}
	connection.onInitialize((params) => {
		workspace.roots = (
			params.workspaceFolders?.map((f) => f.uri) ??
			(params.rootUri ? [params.rootUri] : [])
		)
			.filter((uri) => uri.startsWith("file:"))
			.map((uri) => fileURLToPath(uri))
		dynamicWatch =
			params.capabilities.workspace?.didChangeWatchedFiles
				?.dynamicRegistration ?? false
		return {
			capabilities: {
				textDocumentSync: TextDocumentSyncKind.Incremental,
				completionProvider: { triggerCharacters: ['"', ":"] },
				hoverProvider: true,
				workspace: {
					workspaceFolders: { supported: true, changeNotifications: true },
				},
			},
			serverInfo: { name: "correctly", version: "0.0.1" },
		}
	})
	connection.onInitialized(() => {
		if (dynamicWatch)
			void connection.client
				.register(DidChangeWatchedFilesNotification.type, {
					watchers: [{ globPattern: "**/*.{json,jsonc}" }],
				})
				.catch((error: unknown) => connection.console.error(String(error)))
		connection.workspace.onDidChangeWorkspaceFolders((event) => {
			const removed = new Set(event.removed.map((f) => fileURLToPath(f.uri)))
			workspace.roots = [
				...workspace.roots.filter((r) => !removed.has(r)),
				...event.added.map((f) => fileURLToPath(f.uri)),
			]
			refresh()
		})
	})
	function schedule(document: TextDocument) {
		if (!document.uri.startsWith("file:")) return
		const previous = jobs.get(document.uri)
		if (previous) {
			clearTimeout(previous.timer)
			previous.controller.abort()
		}
		const controller = new AbortController()
		const generation = workspace.generation
		const timer = setTimeout(() => {
			void workspace
				.validate(document)
				.then((result) => {
					if (
						controller.signal.aborted ||
						workspace.generation !== generation ||
						documents.get(document.uri)?.version !== document.version
					)
						return
					return connection.sendDiagnostics({
						uri: document.uri,
						version: document.version,
						diagnostics: lspDiagnostics(result, document.getText()),
					})
				})
				.catch((error: unknown) => connection.console.error(String(error)))
		}, 40)
		jobs.set(document.uri, { controller, timer })
	}
	function scheduleAll() {
		for (const document of documents.all()) schedule(document)
	}
	function refresh() {
		workspace.invalidate()
		scheduleAll()
	}
	documents.onDidChangeContent(({ document }) => {
		if (!document.uri.startsWith("file:")) return
		const resourceChanged = workspace.open(document)
		if (resourceChanged) scheduleAll()
		else schedule(document)
	})
	documents.onDidClose(async ({ document }) => {
		const job = jobs.get(document.uri)
		if (job) {
			clearTimeout(job.timer)
			job.controller.abort()
			jobs.delete(document.uri)
		}
		await connection.sendDiagnostics({ uri: document.uri, diagnostics: [] })
		if (document.uri.startsWith("file:") && workspace.close(document.uri))
			scheduleAll()
	})
	connection.onDidChangeWatchedFiles((params) => {
		// Cache writes and unrelated JSON files must not trigger schema reloads.
		if (params.changes.some((change) => workspace.resourceChanged(change.uri)))
			refresh()
	})
	connection.onDidChangeConfiguration(refresh)
	async function request<T>(
		uri: string,
		token: CancellationToken,
		action: (
			engine: Awaited<ReturnType<Workspace["engineFor"]>>,
			document: TextDocument,
		) => Promise<T>,
	): Promise<T | null> {
		const document = documents.get(uri)
		if (!document || !uri.startsWith("file:")) return null
		const generation = workspace.generation
		const cancelled = () =>
			token.isCancellationRequested ||
			workspace.generation !== generation ||
			documents.get(uri)?.version !== document.version
		if (cancelled())
			throw new ResponseError(
				LSPErrorCodes.RequestCancelled,
				"Request cancelled",
			)
		const operation = (async () => {
			try {
				const engine = await workspace.engineFor(uri)
				if (cancelled())
					throw new ResponseError(
						LSPErrorCodes.RequestCancelled,
						"Request cancelled",
					)
				const result = await action(engine, document)
				if (cancelled())
					throw new ResponseError(
						LSPErrorCodes.RequestCancelled,
						"Request cancelled",
					)
				return result
			} catch (error) {
				if (error instanceof ResponseError) throw error
				if (cancelled())
					throw new ResponseError(
						LSPErrorCodes.RequestCancelled,
						"Request cancelled",
					)
				connection.console.error(String(error))
				return null
			}
		})()
		let listener: { dispose(): void } | undefined
		const cancellation = new Promise<never>((_resolve, reject) => {
			listener = token.onCancellationRequested(() =>
				reject(
					new ResponseError(
						LSPErrorCodes.RequestCancelled,
						"Request cancelled",
					),
				),
			)
		})
		try {
			return await Promise.race([operation, cancellation])
		} finally {
			listener?.dispose()
		}
	}
	connection.onCompletion((params, token) =>
		request(params.textDocument.uri, token, (engine, document) =>
			hints.complete(engine, document, params.position),
		),
	)
	connection.onHover((params, token) =>
		request(params.textDocument.uri, token, (engine, document) =>
			hints.hover(engine, document, params.position),
		),
	)
	connection.onShutdown(() => {
		workspace.invalidate()
		for (const job of jobs.values()) {
			clearTimeout(job.timer)
			job.controller.abort()
		}
		jobs.clear()
	})
	documents.listen(connection)
	connection.listen()
}

startServer()
