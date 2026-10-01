import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { once } from "node:events"
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
	type CancellationToken,
	type PublishDiagnosticsParams,
} from "vscode-languageserver/node"
import { onCleanup } from "./helpers.ts"

export async function lspClient(
	roots: string[],
	entry = fileURLToPath(new URL("../../src/lsp/server.ts", import.meta.url)),
	cwd?: string,
	dynamicWatch = false,
) {
	const child = spawn(process.execPath, [entry, "--stdio"], {
		cwd,
		stdio: ["pipe", "pipe", "pipe"],
	})
	let stderr = ""
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString()
	})
	const connection = createMessageConnection(
		new StreamMessageReader(child.stdout),
		new StreamMessageWriter(child.stdin),
	)
	const notifications: PublishDiagnosticsParams[] = []
	const registrations: unknown[] = []
	connection.onRequest("client/registerCapability", (params: unknown) => {
		registrations.push(params)
		return null
	})
	const waiters = new Set<() => void>()
	connection.onNotification(
		"textDocument/publishDiagnostics",
		(params: PublishDiagnosticsParams) => {
			notifications.push(params)
			for (const notify of waiters) notify()
		},
	)
	connection.listen()
	onCleanup(async () => {
		connection.dispose()
		if (child.exitCode === null && child.signalCode === null) {
			const stopped = once(child, "exit")
			child.kill()
			await stopped
		}
	})
	let initTimer: ReturnType<typeof setTimeout> | undefined
	try {
		await Promise.race([
			connection.sendRequest("initialize", {
				processId: process.pid,
				capabilities: {
					workspace: {
						workspaceFolders: true,
						didChangeWatchedFiles: { dynamicRegistration: dynamicWatch },
					},
				},
				workspaceFolders: roots.map((r, i) => ({
					uri: pathToFileURL(r).href,
					name: `root-${i}`,
				})),
			}),
			new Promise<never>((_resolve, reject) => {
				initTimer = setTimeout(
					() => reject(new Error(`Server did not initialize: ${stderr}`)),
					2500,
				)
			}),
		])
	} finally {
		clearTimeout(initTimer)
	}
	await connection.sendNotification("initialized", {})
	return {
		connection,
		registrations,
		notifications,
		open: (uri: string, text: string, version = 1, languageId = "json") =>
			connection.sendNotification("textDocument/didOpen", {
				textDocument: { uri, text, version, languageId },
			}),
		change: (uri: string, text: string, version: number) =>
			connection.sendNotification("textDocument/didChange", {
				textDocument: { uri, version },
				contentChanges: [{ text }],
			}),
		request: <T>(
			method: string,
			uri: string,
			position: { line: number; character: number },
			token?: CancellationToken,
		) =>
			token
				? connection.sendRequest<T>(
						method,
						{ textDocument: { uri }, position },
						token,
					)
				: connection.sendRequest<T>(method, {
						textDocument: { uri },
						position,
					}),
		wait: (uri: string, version: number, after = 0) =>
			new Promise<PublishDiagnosticsParams>((resolve, reject) => {
				const timer = setTimeout(() => {
					waiters.delete(check)
					reject(
						new Error(
							`No diagnostics for version ${version}; server stderr: ${stderr}`,
						),
					)
				}, 2500)
				const check = () => {
					const match = notifications
						.slice(after)
						.find((p) => p.uri === uri && p.version === version)
					if (match) {
						clearTimeout(timer)
						waiters.delete(check)
						resolve(match)
					}
				}
				waiters.add(check)
				check()
			}),
	}
}
