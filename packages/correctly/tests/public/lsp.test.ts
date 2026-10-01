import { pathToFileURL } from "node:url"
import path from "node:path"
import type { CompletionList, Hover } from "vscode-languageserver/node"
import { expect, test } from "vite-plus/test"
import { check } from "../../src/cli/check.ts"
import { lspClient } from "./lsp-client.ts"
import { put, setup } from "./helpers.ts"

test("stdio LSP and CLI agree on document diagnostics; editor supplies hints", async () => {
	const { root, uri, engine, file } = await setup()
	const client = await lspClient([root])
	await client.open(uri, '{"name":"x", ""}')
	const completions = await client.request<CompletionList>(
		"textDocument/completion",
		uri,
		{ line: 0, character: 14 },
	)
	expect(completions.items.map((i) => i.label)).toContain("color")
	const hover = await client.request<Hover>("textDocument/hover", uri, {
		line: 0,
		character: 3,
	})
	expect(JSON.stringify(hover)).toContain("The project name")
	for (const [i, text] of [
		"{",
		'{"name":1}',
		'{"name":"x","color":"green"}',
		'{"color":"red"}',
		'{"name":"x","extra":true}',
		'{"name":"x","name":"y"}',
	].entries()) {
		await put(root, "data/test.json", text)
		await client.change(uri, text, i + 2)
		const editor = await client.wait(uri, i + 2)
		const report = await check({ cwd: root })
		expect(report.exitCode).toBe(1)
		const core = await engine.validate(file, text)
		if (text.includes("green"))
			expect(core.diagnostics[0]?.message).toBe(
				'/color: must be one of: "red", "blue"',
			)
		expect(
			editor.diagnostics.map((d) => ({
				code: d.code,
				message: d.message,
				range: d.range,
				pointer: (d.data as { pointer: string }).pointer,
			})),
		).toEqual(
			core.diagnostics.map((d) => ({
				code: d.code,
				message: d.message,
				range: d.range,
				pointer: d.pointer,
			})),
		)
		expect(report.files[0]?.diagnostics).toEqual(core.diagnostics)
	}
})

test("rapid unsaved edits publish the latest version; schema/config changes refresh it", async () => {
	const { root, uri } = await setup()
	const client = await lspClient([root])
	await client.open(uri, '{"name":2}')
	await client.change(uri, '{"name":"valid"}', 2)
	await client.change(uri, '{"name":3}', 3)
	await client.change(uri, '{"name":"latest"}', 4)
	expect((await client.wait(uri, 4)).diagnostics).toEqual([])
	expect(
		client.notifications.filter((d) => d.uri === uri).map((d) => d.version),
	).toEqual([4])
	await put(root, "schema.json", { type: "number" })
	const after = client.notifications.length
	await client.connection.sendNotification("workspace/didChangeWatchedFiles", {
		changes: [
			{ uri: pathToFileURL(path.join(root, "schema.json")).href, type: 2 },
		],
	})
	expect((await client.wait(uri, 4, after)).diagnostics[0]?.code).toBe(
		"schema/type",
	)
	const configUri = pathToFileURL(path.join(root, "correctly.config.json")).href
	const configAfter = client.notifications.length
	await client.open(configUri, '{"associations":[]}')
	expect((await client.wait(uri, 4, configAfter)).diagnostics).toEqual([])
	const closeAfter = client.notifications.length
	await client.connection.sendNotification("textDocument/didClose", {
		textDocument: { uri: configUri },
	})
	expect((await client.wait(uri, 4, closeAfter)).diagnostics[0]?.code).toBe(
		"schema/type",
	)
})

test("stdio workspace roots select separate configuration and support folder changes", async () => {
	const first = await setup()
	const second = await setup({ type: "number" })
	const client = await lspClient([first.root, second.root])
	await client.open(first.uri, '{"name":"ok"}')
	await client.open(second.uri, "3")
	expect((await client.wait(first.uri, 1)).diagnostics).toEqual([])
	expect((await client.wait(second.uri, 1)).diagnostics).toEqual([])
	const after = client.notifications.length
	await client.connection.sendNotification(
		"workspace/didChangeWorkspaceFolders",
		{
			event: {
				added: [],
				removed: [{ uri: pathToFileURL(second.root).href, name: "removed" }],
			},
		},
	)
	expect((await client.wait(second.uri, 1, after)).diagnostics[0]?.code).toBe(
		"config",
	)
})

test("schemas outside workspace roots receive explicit file watchers and refresh diagnostics", async () => {
	const external = await setup({ type: "string" })
	const schemaPath = await put(external.root, "external.schema", {
		type: "string",
	})
	const { root, uri } = await setup(
		{},
		{
			files: ["data/**"],
			associations: [{ files: ["data/**"], schema: schemaPath }],
		},
	)
	const client = await lspClient([root], undefined, undefined, true)
	await client.open(uri, '"valid"')
	expect((await client.wait(uri, 1)).diagnostics).toEqual([])
	expect(JSON.stringify(client.registrations)).toContain(
		'"pattern":"external.schema"',
	)
	expect(JSON.stringify(client.registrations)).toContain(
		pathToFileURL(external.root).href,
	)
	await put(external.root, "external.schema", { type: "number" })
	const after = client.notifications.length
	await client.connection.sendNotification("workspace/didChangeWatchedFiles", {
		changes: [{ uri: pathToFileURL(schemaPath).href, type: 2 }],
	})
	expect((await client.wait(uri, 1, after)).diagnostics[0]?.code).toBe(
		"schema/type",
	)
})

test("schema cache writes and unrelated JSON changes do not restart validation", async () => {
	const { root, uri } = await setup()
	const client = await lspClient([root])
	await client.open(uri, '{"name":"ok"}')
	await client.wait(uri, 1)
	const after = client.notifications.length
	await client.connection.sendNotification("workspace/didChangeWatchedFiles", {
		changes: [".correctly-cache/schema.json", "unrelated.json"].map((file) => ({
			uri: pathToFileURL(path.join(root, file)).href,
			type: 2,
		})),
	})
	await client.request<Hover>("textDocument/hover", uri, {
		line: 0,
		character: 3,
	})
	await new Promise<void>((resolve) => setTimeout(resolve, 80))
	expect(client.notifications.length).toBe(after)
})
