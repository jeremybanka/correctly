import { createServer, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, expect, test } from "vite-plus/test"
import {
	CancellationTokenSource,
	type CompletionList,
} from "vscode-languageserver/node"
import { lspClient } from "./lsp-client.ts"
import { setup, sampleSchema } from "./helpers.ts"

const closeServers: (() => Promise<void>)[] = []
afterEach(async () => {
	for (const close of closeServers.splice(0)) await close()
})
async function slowSchema() {
	let response: ServerResponse | undefined
	let requested: (() => void) | undefined
	const received = new Promise<void>((resolve) => {
		requested = resolve
	})
	const server = createServer((_request, result) => {
		response = result
		requested?.()
	})
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(0, "127.0.0.1", resolve)
	})
	closeServers.push(
		() =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()))
				server.closeAllConnections()
			}),
	)
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	return {
		schema: `${base}/schema.json`,
		received,
		release: () => response?.end(JSON.stringify(sampleSchema)),
	}
}

test("completion cancellation returns while a schema load is still pending", async () => {
	const remote = await slowSchema()
	const { root, uri } = await setup(sampleSchema, {
		files: ["data/**"],
		associations: [{ files: ["data/**"], schema: remote.schema }],
	})
	const client = await lspClient([root])
	await client.open(uri, '{""}')
	const token = new CancellationTokenSource()
	const pending = client.request<CompletionList>(
		"textDocument/completion",
		uri,
		{ line: 0, character: 2 },
		token.token,
	)
	const rejection = expect(pending).rejects.toMatchObject({ code: -32800 })
	await remote.received
	token.cancel()
	await rejection
	remote.release()
	token.dispose()
})

test("slow old validation cannot overwrite a newer unsaved document", async () => {
	const remote = await slowSchema()
	const { root, uri } = await setup(sampleSchema, {
		files: ["data/**"],
		associations: [{ files: ["data/**"], schema: remote.schema }],
	})
	const client = await lspClient([root])
	await client.open(uri, '{"name":2}')
	await remote.received
	await client.change(uri, '{"name":"latest"}', 2)
	remote.release()
	expect((await client.wait(uri, 2)).diagnostics).toEqual([])
	expect(
		client.notifications.filter((p) => p.uri === uri).map((p) => p.version),
	).toEqual([2])
})
