import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdir, readFile, readdir, rm } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { expect, test } from "vite-plus/test"
import { check } from "../../src/cli/check.ts"
import {
	loadProject,
	validateConfig,
	isIncluded,
} from "../../src/core/config.ts"
import { Engine } from "../../src/core/engine.ts"
import { pullSchemas } from "../../src/core/pull.ts"
import {
	readSchemaLock,
	SCHEMA_LOCK,
	PREVIOUS_SCHEMA_LOCK,
	LEGACY_SCHEMA_LOCK,
	schemaDigest,
	vendoredSchemaPath,
} from "../../src/core/schema-lock.ts"
import { onCleanup, put, setup } from "./helpers.ts"
import { lspClient } from "./lsp-client.ts"

const url = "https://schemas.example.test/root.json"
const noNetwork: typeof fetch = async () => {
	throw new Error("Unexpected network request")
}

test("selective pulls refresh local roots' remote graphs and preserve unrelated snapshots and provenance", async () => {
	const other = "https://schemas.example.test/renovate.json"
	const child = "https://schemas.example.test/child.json"
	const unused = "https://schemas.example.test/unused.json"
	const added = "https://schemas.example.test/added.json"
	const { project, root } = await setup(
		{},
		{
			files: ["data/**"],
			associations: [
				{
					name: "Tool",
					files: ["data/tool.json"],
					schema: "schema.json",
					packages: ["tool"],
				},
				{
					name: "Renovate",
					files: ["data/renovate.json"],
					schema: other,
					packages: ["renovate"],
				},
			],
		},
	)
	await put(root, "schema.json", {
		$ref: child,
		$defs: { unused: { $ref: unused } },
	})
	await put(root, "node_modules/tool/package.json", { version: "1.0.0" })
	await put(root, "node_modules/renovate/package.json", { version: "1.0.0" })
	const first = await pullSchemas(project, {
		fetch: documents({
			[child]: { type: "string" },
			[unused]: true,
			[other]: { type: "string" },
		}),
	})
	first.schemas[other]!.discoveredAt = "2020-01-01T00:00:00.000Z"
	await put(root, SCHEMA_LOCK, first)
	const oldBytes = await readFile(vendoredSchemaPath(root, other), "utf8")
	await put(root, "node_modules/tool/package.json", { version: "2.0.0" })
	await rm(path.join(root, "node_modules/renovate"), { recursive: true })
	await put(root, "schema.json", {
		$ref: child,
		$defs: { added: { $ref: added } },
	})
	const requested: string[] = []
	const next = await pullSchemas(project, {
		associations: ["Tool"],
		fetch: documents(
			{
				[child]: { type: "number" },
				[added]: true,
				[other]: { type: "invalid-type" },
			},
			requested,
		),
	})
	expect(requested.sort()).toEqual([child, added].sort())
	expect(next.schemas[other]).toEqual(first.schemas[other])
	expect(await readFile(vendoredSchemaPath(root, other), "utf8")).toBe(oldBytes)
	expect(next.schemas[unused]).toEqual(first.schemas[unused])
	expect(next.schemas[child]!.packages).toEqual({ tool: "2.0.0" })
	expect(next.schemas[added]!.packages).toEqual({ tool: "2.0.0" })
	await put(root, "data/tool.json", '"now invalid"')
	await put(root, "data/renovate.json", '"still valid"')
	const report = await check({ cwd: root, offline: true })
	expect(report.exitCode).toBe(1)
	expect(
		report.files.find((file) => file.file.endsWith("renovate.json"))
			?.diagnostics,
	).toEqual([])
	await put(root, "node_modules/renovate/package.json", { version: "1.0.0" })
	const full = await pullSchemas(project, {
		fetch: documents({
			[child]: { type: "number" },
			[added]: true,
			[other]: { type: "string" },
		}),
	})
	expect(full.schemas[unused]).toBeUndefined()
})

test("shared references stay pinned until all owning associations are selected together", async () => {
	const other = "https://schemas.example.test/other.json"
	const shared = "https://schemas.example.test/shared.json"
	const { project, root } = await setup(
		{},
		{
			files: ["data/**"],
			associations: [
				{
					name: "One",
					files: ["data/one.json"],
					schema: url,
					packages: ["one"],
				},
				{
					name: "Two",
					files: ["data/two.json"],
					schema: other,
					packages: ["two"],
				},
			],
		},
	)
	await put(root, "node_modules/one/package.json", { version: "1.0.0" })
	await put(root, "node_modules/two/package.json", { version: "1.0.0" })
	const roots = { [url]: { $ref: shared }, [other]: { $ref: shared } }
	const first = await pullSchemas(project, {
		fetch: documents({ ...roots, [shared]: { type: "string" } }),
	})
	await put(root, "node_modules/one/package.json", { version: "2.0.0" })
	const requested: string[] = []
	const partial = await pullSchemas(project, {
		associations: ["One"],
		fetch: documents(roots, requested),
	})
	expect(requested).toEqual([url])
	expect(partial.schemas[shared]).toEqual(first.schemas[shared])
	expect(partial.schemas[other]).toEqual(first.schemas[other])
	expect(partial.schemas[url]!.packages).toEqual({ one: "2.0.0" })
	requested.length = 0
	const together = await pullSchemas(project, {
		associations: ["One", "Two"],
		fetch: documents({ ...roots, [shared]: { type: "number" } }, requested),
	})
	expect(requested.sort()).toEqual([url, other, shared].sort())
	expect(together.schemas[shared]!.packages).toEqual({
		one: "2.0.0",
		two: "1.0.0",
	})
})

test("selective pulls retain cross-association identifiers without fetching their identifier URLs", async () => {
	const other = "https://schemas.example.test/other.json"
	const id = "https://identifiers.example.test/other"
	const { project } = await setup(
		{},
		{
			associations: [
				{ name: "One", files: ["data/one.json"], schema: url },
				{ name: "Two", files: ["data/two.json"], schema: other },
			],
		},
	)
	const first = await pullSchemas(project, {
		fetch: documents({
			[url]: { $ref: id },
			[other]: { $id: id, type: "string" },
		}),
	})
	const requested: string[] = []
	const next = await pullSchemas(project, {
		associations: ["One"],
		fetch: documents({ [url]: { $ref: id } }, requested),
	})
	expect(requested).toEqual([url])
	expect(next).toEqual(first)
})

test("selectors reject unknown names, empty selections and uninitialized snapshots before fetching", async () => {
	const { project, root } = await remoteProject()
	project.config.associations[0]!.name = "Tool"
	for (const associations of [["Typo"], [], ["Tool"]])
		await expect(
			pullSchemas(project, { associations, fetch: noNetwork }),
		).rejects.toThrow()
	expect(await readSchemaLock(root)).toBeUndefined()
})

test("selective pulls migrate a root lock and preserve unrelated observation metadata", async () => {
	const other = "https://schemas.example.test/other.json"
	const { project, root, file } = await setup(
		{},
		{
			associations: [
				{ name: "One", files: ["data/test.json"], schema: url },
				{ name: "Two", files: ["data/two.json"], schema: other },
			],
		},
	)
	const first = await pullSchemas(project, {
		fetch: documents({ [url]: { type: "string" }, [other]: true }),
	})
	await put(root, PREVIOUS_SCHEMA_LOCK, first)
	await rm(path.join(root, SCHEMA_LOCK))
	expect(await readSchemaLock(root)).toEqual(first)
	expect(
		(await new Engine(project, { fetch: noNetwork }).validate(file, '"valid"'))
			.diagnostics,
	).toEqual([])
	const next = await pullSchemas(project, {
		associations: ["One"],
		fetch: documents({ [url]: { type: "number" } }),
	})
	expect(next.schemas[other]).toEqual(first.schemas[other])
	expect(await readFile(path.join(root, SCHEMA_LOCK), "utf8")).toBe(
		`${JSON.stringify(next, null, 2)}\n`,
	)
	await expect(
		readFile(path.join(root, PREVIOUS_SCHEMA_LOCK)),
	).rejects.toMatchObject({ code: "ENOENT" })
	await put(root, PREVIOUS_SCHEMA_LOCK, first)
	await put(root, SCHEMA_LOCK, "{")
	await expect(readSchemaLock(root)).rejects.toThrow("Invalid")
})

test("selective pulls refuse corrupted preserved schemas without changing the lock", async () => {
	const other = "https://schemas.example.test/other.json"
	const { project, root } = await setup(
		{},
		{
			associations: [
				{ name: "One", files: ["data/one.json"], schema: url },
				{ name: "Two", files: ["data/two.json"], schema: other },
			],
		},
	)
	await pullSchemas(project, {
		fetch: documents({ [url]: true, [other]: true }),
	})
	const lock = await readFile(path.join(root, SCHEMA_LOCK), "utf8")
	await put(root, path.relative(root, vendoredSchemaPath(root, other)), "false")
	await expect(
		pullSchemas(project, { associations: ["One"], fetch: noNetwork }),
	).rejects.toThrow("Digest mismatch")
	expect(await readFile(path.join(root, SCHEMA_LOCK), "utf8")).toBe(lock)
})

test("a stale selective pull cannot overwrite another association's completed update", async () => {
	const other = "https://schemas.example.test/other.json"
	const { project, root } = await setup(
		{},
		{
			associations: [
				{ name: "One", files: ["data/one.json"], schema: url },
				{ name: "Two", files: ["data/two.json"], schema: other },
			],
		},
	)
	await pullSchemas(project, {
		fetch: documents({
			[url]: { type: "string" },
			[other]: { type: "string" },
		}),
	})
	await expect(
		pullSchemas(project, {
			associations: ["One"],
			fetch: async () => {
				await pullSchemas(project, {
					associations: ["Two"],
					fetch: documents({ [other]: { type: "number" } }),
				})
				return new Response('{"type":"number"}')
			},
		}),
	).rejects.toThrow("snapshot changed")
	expect(await readFile(vendoredSchemaPath(root, url), "utf8")).toBe(
		'{"type":"string"}',
	)
	expect(await readFile(vendoredSchemaPath(root, other), "utf8")).toBe(
		'{"type":"number"}',
	)
})
function documents(
	schemas: Record<string, unknown>,
	requested: string[] = [],
): typeof fetch {
	return async (input, init) => {
		const uri = input instanceof Request ? input.url : input.toString()
		requested.push(uri)
		expect(init?.headers).toEqual({})
		return Object.hasOwn(schemas, uri)
			? new Response(JSON.stringify(schemas[uri]))
			: new Response("missing", { status: 404 })
	}
}
async function remoteProject(packages?: string[]) {
	return setup(
		{},
		{
			files: ["**/*.json"],
			associations: [
				{ files: ["data/**"], schema: url, ...(packages ? { packages } : {}) },
			],
		},
	)
}

test("pull locks a complete graph and package provenance; online and offline validation ignore upstream", async () => {
	const { project, root, file } = await remoteProject([
		"@example/tool",
		"companion",
	])
	await put(root, "node_modules/@example/tool/package.json", {
		version: "1.2.3",
		exports: {},
	})
	await put(root, "node_modules/companion/package.json", { version: "4.5.6" })
	const requested: string[] = []
	const child = "https://schemas.example.test/nested/value.json"
	const unused = "https://schemas.example.test/unused.json"
	const schema = {
		$ref: "nested/value.json#/$defs/value",
		$defs: { unused: { $ref: "unused.json" } },
		default: { $ref: "https://must-not-fetch.example/annotation" },
	}
	const lock = await pullSchemas(project, {
		fetch: documents(
			{
				[url]: schema,
				[child]: { $defs: { value: { type: "string" } } },
				[unused]: true,
			},
			requested,
		),
	})
	expect(requested.sort()).toEqual([url, child, unused].sort())
	expect(lock.schemas[url]).toMatchObject({
		digest: schemaDigest(JSON.stringify(schema)),
		packages: { "@example/tool": "1.2.3", companion: "4.5.6" },
	})
	expect(Number.isFinite(Date.parse(lock.schemas[url]!.discoveredAt))).toBe(
		true,
	)
	expect(lock.schemas[child]!.packages).toEqual(lock.schemas[url]!.packages)
	for (const offline of [true, false]) {
		const engine = new Engine(project, { offline, fetch: noNetwork })
		expect(await engine.validate(file, '"valid"')).toMatchObject({
			failures: [],
			diagnostics: [],
		})
		expect(await engine.validate(file, "2")).toMatchObject({
			failures: [],
			diagnostics: [{ code: "schema/type" }],
		})
		await engine.dispose()
	}
	expect(isIncluded(project, path.join(root, SCHEMA_LOCK))).toBe(false)
	await put(root, "data/test.json", "2")
	expect((await check({ cwd: root })).exitCode).toBe(1)
})

test("unchanged pulls preserve discovery dates; version changes update provenance with the same digest", async () => {
	const { project, root } = await remoteProject(["tool"])
	await put(root, "node_modules/tool/package.json", { version: "1.0.0" })
	const fetch = documents({ [url]: { type: "string" } })
	const first = await pullSchemas(project, { fetch })
	// Use a historical observation so a same-millisecond pull cannot mask a timestamp change.
	first.schemas[url]!.discoveredAt = "2020-01-01T00:00:00.000Z"
	await put(root, SCHEMA_LOCK, first)
	expect(await pullSchemas(project, { fetch })).toEqual(first)
	await put(root, "node_modules/tool/package.json", { version: "2.0.0" })
	const second = await pullSchemas(project, { fetch })
	expect(second.schemas[url]!.digest).toBe(first.schemas[url]!.digest)
	expect(second.schemas[url]!.packages).toEqual({ tool: "2.0.0" })
	expect(second.schemas[url]!.discoveredAt).not.toBe(
		first.schemas[url]!.discoveredAt,
	)
})

test("failed updates preserve the previous lock and schema; successful updates can be rolled back", async () => {
	const { project, root, file } = await remoteProject()
	const first = await pullSchemas(project, {
		fetch: documents({ [url]: { type: "string" } }),
	})
	const original = await readFile(path.join(root, SCHEMA_LOCK), "utf8")
	const schemaFile = vendoredSchemaPath(root, url)
	const originalSchema = await readFile(schemaFile, "utf8")
	for (const fetch of [
		documents({}),
		async () => new Response("{"),
		documents({ [url]: { $ref: "missing.json" } }),
		documents({ [url]: { type: "invalid-type" } }),
	]) {
		await expect(pullSchemas(project, { fetch })).rejects.toThrow()
		expect(await readFile(path.join(root, SCHEMA_LOCK), "utf8")).toBe(original)
		expect(await readFile(schemaFile, "utf8")).toBe(originalSchema)
	}
	await pullSchemas(project, {
		fetch: documents({ [url]: { type: "number" } }),
	})
	expect(
		(await new Engine(project, { fetch: noNetwork }).validate(file, "2"))
			.diagnostics,
	).toEqual([])
	await put(root, SCHEMA_LOCK, first)
	expect(
		(await new Engine(project, { fetch: noNetwork }).validate(file, "2"))
			.failures[0]?.code,
	).toBe("schema-integrity")
	await put(root, path.relative(root, schemaFile), originalSchema)
	expect(
		(await new Engine(project, { fetch: noNetwork }).validate(file, "2"))
			.diagnostics[0]?.code,
	).toBe("schema/type")
})

test("missing, corrupted, and unpinned schemas fail without a network fallback", async () => {
	const { project, root, file } = await remoteProject()
	const lock = await pullSchemas(project, {
		fetch: documents({ [url]: { type: "string" } }),
	})
	const blob = vendoredSchemaPath(root, url)
	await put(root, path.relative(root, blob), { type: "number" })
	expect(
		(await new Engine(project, { fetch: noNetwork }).validate(file, "2"))
			.failures[0]?.code,
	).toBe("schema-integrity")
	await rm(blob)
	expect(
		(await new Engine(project, { fetch: noNetwork }).validate(file, "2"))
			.failures[0]?.code,
	).toBe("schema-lock")
	await put(root, SCHEMA_LOCK, { lockVersion: 1, schemas: {} })
	expect(
		(await new Engine(project, { fetch: noNetwork }).validate(file, "2"))
			.failures[0]?.message,
	).toContain("not locked")
	await put(root, SCHEMA_LOCK, { lockVersion: 3, schemas: {} })
	await expect(readSchemaLock(root)).rejects.toThrow("lockVersion 1")
	await put(root, SCHEMA_LOCK, {
		lockVersion: 1,
		schemas: { [url]: { ...lock.schemas[url], digest: "../../escape" } },
	})
	await expect(readSchemaLock(root)).rejects.toThrow("Invalid schema entry")
})

test("pull follows local roots, relative IDs, embedded resources, shared dependencies and cycles", async () => {
	const { root } = await setup(
		{},
		{
			files: ["data/**"],
			associations: [
				{ files: ["data/a.json"], schema: "schema.json", packages: ["one"] },
				{ files: ["data/b.json"], schema: "other.json", packages: ["two"] },
			],
		},
	)
	await put(root, "node_modules/one/package.json", { version: "1.0.0" })
	await put(root, "node_modules/two/package.json", { version: "2.0.0" })
	await put(root, "schema.json", {
		$id: "https://schemas.example.test/local.json",
		$ref: "embedded",
		definitions: {
			value: { $id: "embedded", $ref: "shared.json" },
		},
	})
	await put(root, "other.json", {
		$ref: "https://schemas.example.test/shared.json",
	})
	const shared = "https://schemas.example.test/shared.json"
	const requested: string[] = []
	const project = await loadProject(path.join(root, "correctly.config.ts"))
	const lock = await pullSchemas(project, {
		fetch: documents(
			{
				[shared]: {
					type: "object",
					properties: { child: { $ref: "shared.json" } },
				},
			},
			requested,
		),
	})
	expect(requested).toEqual([shared])
	expect(lock.schemas[shared]!.packages).toEqual({ one: "1.0.0", two: "2.0.0" })
})

test("pull requires installed packages and respects resource limits and cancellation", async () => {
	const { project, root } = await remoteProject(["missing-tool"])
	await expect(pullSchemas(project, { fetch: noNetwork })).rejects.toThrow(
		"not installed",
	)
	await put(root, "node_modules/missing-tool/package.json", {
		version: "1.0.0",
	})
	project.config.remote = { maxRequests: 1 }
	await expect(
		pullSchemas(project, {
			fetch: documents({ [url]: { $ref: "child.json" } }),
		}),
	).rejects.toThrow("resource limit")
	project.config.remote = { maxBytes: 2 }
	await expect(
		pullSchemas(project, { fetch: documents({ [url]: { type: "string" } }) }),
	).rejects.toThrow("exceeds")
	project.config.remote = { offline: true }
	await expect(pullSchemas(project)).rejects.toThrow("online mode")
	delete project.config.remote
	await expect(
		pullSchemas(project, { signal: AbortSignal.abort() }),
	).rejects.toThrow()
	expect(await readSchemaLock(root)).toBeUndefined()
	expect(() =>
		validateConfig({
			associations: [
				{ files: ["**/*"], packages: ["../escape"], validate: null },
			],
		}),
	).toThrow("Invalid package name")
})

test("published pull command vendors schemas, exposes JSON provenance and rejects offline pulls", async () => {
	let type = "string"
	let requests = 0
	const server = createServer((_request, response) => {
		requests++
		response.end(JSON.stringify({ type }))
	})
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	onCleanup(
		() =>
			new Promise<void>((resolve) => {
				server.close(() => resolve())
				server.closeAllConnections()
			}),
	)
	const source = `http://127.0.0.1:${(server.address() as AddressInfo).port}/schema.json`
	const { root } = await setup(
		{},
		{
			files: ["data/**"],
			associations: [{ files: ["data/**"], schema: source }],
		},
	)
	const entry = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))
	async function invoke(args: string[]) {
		const child = spawn(process.execPath, [entry, ...args], {
			cwd: path.join(root, "data"),
		})
		let output = ""
		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString()
		})
		const [exitCode] = await once(child, "exit")
		return { exitCode, output }
	}
	await put(root, "data/test.json", '"valid"')
	const pulled = await invoke([
		"schemas",
		"pull",
		"--config",
		"../correctly.config.ts",
		"--format=json",
	])
	expect(pulled.exitCode).toBe(0)
	expect(JSON.parse(pulled.output)).toEqual(await readSchemaLock(root))
	expect(requests).toBe(1)
	type = "number"
	expect((await invoke(["check", "--offline"])).exitCode).toBe(0)
	expect(requests).toBe(1)
	expect((await invoke(["schemas", "pull", "--offline"])).exitCode).toBe(2)
	expect((await invoke(["schemas", "pull"])).output).toContain(
		"Vendored 1 schema resources",
	)
	expect((await invoke(["check"])).exitCode).toBe(1)
})

test("CLI association selectors preserve literal names and other schemas while refreshing multiple associations", async () => {
	let type = "string"
	const requests: string[] = []
	const server = createServer((request, response) => {
		requests.push(request.url!)
		response.end(JSON.stringify({ type }))
	})
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	onCleanup(
		() =>
			new Promise<void>((resolve) => {
				server.close(() => resolve())
				server.closeAllConnections()
			}),
	)
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	const { root } = await setup(
		{},
		{
			associations: [
				{
					name: "Tool, configuration",
					files: ["data/one.json"],
					schema: `${origin}/one.json`,
				},
				{
					name: "Other tool",
					files: ["data/two.json"],
					schema: `${origin}/two.json`,
				},
				{
					name: "Pinned",
					files: ["data/three.json"],
					schema: `${origin}/three.json`,
				},
			],
		},
	)
	const entry = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))
	async function invoke(args: string[]) {
		const child = spawn(process.execPath, [entry, "schemas", "pull", ...args], {
			cwd: root,
		})
		let output = ""
		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString()
		})
		const [exitCode] = await once(child, "exit")
		return { exitCode, output }
	}
	expect((await invoke(["--all"])).exitCode).toBe(0)
	const first = await readSchemaLock(root)
	requests.length = 0
	type = "number"
	const selected = await invoke([
		"--association",
		"Tool, configuration",
		"--association=Other tool",
		"--format=json",
	])
	expect(selected.exitCode).toBe(0)
	expect(requests.sort()).toEqual(["/one.json", "/two.json"])
	expect(JSON.parse(selected.output).schemas[`${origin}/three.json`]).toEqual(
		first!.schemas[`${origin}/three.json`],
	)
	requests.length = 0
	for (const args of [
		["--all", "--association", "Pinned"],
		["--association", "Typo"],
		["--association"],
	])
		expect((await invoke(args)).exitCode).toBe(2)
	expect(requests).toEqual([])
})

test("LSP uses locked schemas and reloads when a pull replaces the lock", async () => {
	const { project, root, uri } = await remoteProject()
	await pullSchemas(project, {
		fetch: documents({ [url]: { type: "string" } }),
	})
	const client = await lspClient([root], undefined, undefined, true)
	await client.open(uri, '"valid"')
	expect((await client.wait(uri, 1)).diagnostics).toEqual([])
	await pullSchemas(project, {
		fetch: documents({ [url]: { type: "number" } }),
	})
	const after = client.notifications.length
	await client.connection.sendNotification("workspace/didChangeWatchedFiles", {
		changes: [
			{ uri: pathToFileURL(path.join(root, SCHEMA_LOCK)).href, type: 2 },
		],
	})
	expect((await client.wait(uri, 1, after)).diagnostics[0]?.code).toBe(
		"schema/type",
	)
	// Editing a blob cannot silently change validation under the locked digest.
	const blob = vendoredSchemaPath(root, url)
	await client.open(pathToFileURL(blob).href, '{"type":"string"}')
	const changed = client.notifications.length
	await client.change(uri, '"valid"', 2)
	expect((await client.wait(uri, 2, changed)).diagnostics[0]?.code).toBe(
		"schema-integrity",
	)
})

test("vendored filenames reflect retrieval URLs and distinguish filesystem-sensitive names", async () => {
	const { root } = await remoteProject()
	expect(vendoredSchemaPath(root, "https://dprint.dev/schemas/v0.json")).toBe(
		path.join(root, ".correctly/schemas/dprint.dev__schemas__v0.json"),
	)
	const sources = [
		"https://example.test/foo/bar.json",
		"https://example.test/foo__bar.json",
		"https://example.test/Foo/bar.json",
		"https://example.test:8443/foo/bar.json",
		"https://example.test/foo/bar.json?version=1",
		"https://example.test/foo/bar.json?version=2",
		"https://example.test/foo%2Fbar.json",
		"https://example.test/foo%2fbar.json",
		"https://example.test/",
		"https://example.test/schema.",
		"https://example.test/schema%2E",
		"https://example.test/../../outside.json?name=../escape",
	]
	const files = sources.map((uri) => vendoredSchemaPath(root, uri))
	expect(new Set(files.map((file) => file.toLowerCase())).size).toBe(
		sources.length,
	)
	for (const file of files) {
		expect(path.dirname(file)).toBe(path.join(root, ".correctly", "schemas"))
		expect(path.basename(file)).not.toMatch(/[\\/:*?"<>|]|\.$/)
	}
	expect(vendoredSchemaPath(root, `${sources[0]}#/value`)).toBe(files[0])
	expect(vendoredSchemaPath(root, "http://example.test/foo/bar.json")).toBe(
		files[0],
	)
	expect(() => vendoredSchemaPath(root, "file:///schema.json")).toThrow(
		"Unsupported retrieval URL",
	)
})

test("legacy snapshots validate offline and migrate without losing observation metadata", async () => {
	const { project, root, file } = await remoteProject()
	const text = '{"type":"string"}'
	const digest = schemaDigest(text)
	const legacy = {
		lockVersion: 1,
		schemas: {
			[url]: { digest, discoveredAt: "2020-01-01T00:00:00.000Z", packages: {} },
		},
	}
	await put(root, LEGACY_SCHEMA_LOCK, legacy)
	await put(root, `.correctly/schemas/${digest}.json`, text)
	expect(
		await new Engine(project, { fetch: noNetwork, offline: true }).validate(
			file,
			'"valid"',
		),
	).toMatchObject({
		failures: [],
		diagnostics: [],
	})
	const migrated = await pullSchemas(project, {
		fetch: documents({ [url]: { type: "string" } }),
	})
	expect(migrated).toEqual({ ...legacy, lockVersion: 2 })
	expect(await readFile(vendoredSchemaPath(root, url), "utf8")).toBe(text)
	expect(await readdir(path.join(root, ".correctly"))).toEqual([
		"correctly.lock",
		"schemas",
	])
	expect(await readSchemaLock(root)).toEqual(migrated)
	expect(
		await new Engine(project, { fetch: noNetwork, offline: true }).validate(
			file,
			'"valid"',
		),
	).toMatchObject({
		failures: [],
		diagnostics: [],
	})
	// An invalid new lock must not fall back to an older, otherwise valid snapshot.
	await put(root, LEGACY_SCHEMA_LOCK, legacy)
	await put(root, SCHEMA_LOCK, "{")
	await expect(readSchemaLock(root)).rejects.toThrow("Invalid")
})

test("snapshot publication failures leave the previous URL-named schemas intact", async () => {
	const { project, root, file } = await remoteProject()
	await pullSchemas(project, {
		fetch: documents({ [url]: { type: "string" } }),
	})
	const originalLock = await readFile(path.join(root, SCHEMA_LOCK), "utf8")
	const schemaFile = vendoredSchemaPath(root, url)
	const originalSchema = await readFile(schemaFile, "utf8")
	await expect(
		pullSchemas(project, {
			fetch: async () => {
				// Simulate the lock becoming unwritable after the previous observation was read.
				await rm(path.join(root, SCHEMA_LOCK))
				await mkdir(path.join(root, SCHEMA_LOCK))
				return new Response('{"type":"number"}')
			},
		}),
	).rejects.toThrow()
	expect(await readFile(schemaFile, "utf8")).toBe(originalSchema)
	expect(await readdir(path.join(root, ".correctly"))).toEqual([
		"correctly.lock",
		"schemas",
	])
	await rm(path.join(root, SCHEMA_LOCK), { recursive: true })
	await put(root, SCHEMA_LOCK, originalLock)
	expect(
		await new Engine(project, { fetch: noNetwork }).validate(file, '"valid"'),
	).toMatchObject({
		failures: [],
		diagnostics: [],
	})
})

test("concurrent pulls publish a graph whose files agree with its lock", async () => {
	const { project, root, file } = await remoteProject()
	await pullSchemas(project, {
		fetch: documents({ [url]: { type: "boolean" } }),
	})
	let arrived = 0
	let release: () => void = () => {}
	const ready = new Promise<void>((resolve) => {
		release = resolve
	})
	const snapshot =
		(type: string): typeof fetch =>
		async () => {
			if (++arrived === 2) release()
			await ready
			return new Response(JSON.stringify({ type }))
		}
	const results = await Promise.allSettled([
		pullSchemas(project, { fetch: snapshot("string") }),
		pullSchemas(project, { fetch: snapshot("number") }),
	])
	expect(results.some((result) => result.status === "fulfilled")).toBe(true)
	const text = await readFile(vendoredSchemaPath(root, url), "utf8")
	expect((await readSchemaLock(root))!.schemas[url]!.digest).toBe(
		schemaDigest(text),
	)
	const type = (JSON.parse(text) as { type: string }).type
	expect(
		await new Engine(project, { fetch: noNetwork }).validate(
			file,
			type === "string" ? '"valid"' : "2",
		),
	).toMatchObject({
		failures: [],
		diagnostics: [],
	})
	expect(await readdir(path.join(root, ".correctly"))).toEqual([
		"correctly.lock",
		"schemas",
	])
})

test("HTTP and HTTPS aliases share a filename only when their schema bytes match", async () => {
	const http = url.replace("https:", "http:")
	const { root, project } = await setup(
		{},
		{
			files: ["data/**"],
			associations: [
				{ files: ["data/http.json"], schema: http },
				{ files: ["data/https.json"], schema: url },
			],
		},
	)
	const lock = await pullSchemas(project, {
		fetch: documents({
			[http]: { type: "string" },
			[url]: { type: "string" },
		}),
	})
	const schemaFile = vendoredSchemaPath(root, url)
	expect(vendoredSchemaPath(root, http)).toBe(schemaFile)
	expect(await readdir(path.join(root, ".correctly/schemas"))).toEqual([
		path.basename(schemaFile),
	])
	for (const name of ["http", "https"])
		expect(
			await new Engine(project, { fetch: noNetwork }).validate(
				path.join(root, "data/" + name + ".json"),
				'"valid"',
			),
		).toMatchObject({
			failures: [],
			diagnostics: [],
		})
	const originalLock = await readFile(path.join(root, SCHEMA_LOCK), "utf8")
	const originalSchema = await readFile(schemaFile, "utf8")
	await expect(
		pullSchemas(project, {
			fetch: documents({
				[http]: { type: "string" },
				[url]: { type: "number" },
			}),
		}),
	).rejects.toThrow("different contents")
	expect(await readFile(path.join(root, SCHEMA_LOCK), "utf8")).toBe(
		originalLock,
	)
	expect(await readFile(schemaFile, "utf8")).toBe(originalSchema)
	lock.schemas[http]!.digest = schemaDigest('{"type":"number"}')
	await put(root, SCHEMA_LOCK, lock)
	await expect(readSchemaLock(root)).rejects.toThrow("different digests")
})
