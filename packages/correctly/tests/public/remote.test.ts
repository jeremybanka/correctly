import { createServer, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { Engine } from "../../src/core/engine.ts"
import { setup, sampleSchema } from "./helpers.ts"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
	for (const close of cleanup.splice(0)) await close()
})
async function serve(
	handler: (
		url: string,
		response: ServerResponse,
		headers: Record<string, string | string[] | undefined>,
	) => void,
) {
	const server = createServer((request, response) =>
		handler(request.url ?? "/", response, request.headers),
	)
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(0, "127.0.0.1", resolve)
	})
	cleanup.push(
		() =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()))
				server.closeAllConnections()
			}),
	)
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe("bounded remote schema loading", () => {
	test("remote references, conditional refresh and offline disk cache", async () => {
		const requested: string[] = []
		let conditional = 0
		const base = await serve((url, response, headers) => {
			requested.push(url)
			if (headers["if-none-match"] === '"v1"') {
				conditional++
				response.writeHead(304)
				response.end()
				return
			}
			response.setHeader("etag", '"v1"')
			response.end(
				JSON.stringify(
					url === "/schema.json"
						? { $ref: "defs.json#/definitions/value" }
						: { definitions: { value: { type: "string" } } },
				),
			)
		})
		const { project, file } = await setup(sampleSchema, {
			files: ["data/**"],
			associations: [{ files: ["data/**"], schema: `${base}/schema.json` }],
		})
		expect(await new Engine(project).validate(file, '"ok"')).toMatchObject({
			failures: [],
			diagnostics: [],
		})
		expect(requested).toEqual(["/schema.json", "/defs.json"])
		const offline = new Engine(project, {
			offline: true,
			fetch: () => {
				throw new Error("network must not run offline")
			},
		})
		expect(await offline.validate(file, "2")).toMatchObject({
			failures: [],
			diagnostics: [{ code: "schema/type" }],
		})
		expect(requested).toHaveLength(2)
		expect(await new Engine(project).validate(file, '"ok"')).toMatchObject({
			failures: [],
			diagnostics: [],
		})
		expect(conditional).toBe(2)
	})
	test("offline cache misses fail instead of reverting to syntax checks", async () => {
		const { engine, file } = await setup(sampleSchema, {
			files: ["data/**"],
			associations: [
				{ files: ["data/**"], schema: "https://example.invalid/schema.json" },
			],
			remote: { offline: true },
		})
		expect((await engine.validate(file, "{}")).failures).toMatchObject([
			{ code: "offline-miss" },
		])
	})
	test("changed remote schemas refresh and online errors do not use stale cache", async () => {
		let type = "string"
		let status = 200
		const base = await serve((_url, response) => {
			response.statusCode = status
			response.end(JSON.stringify({ type }))
		})
		const { project, file } = await setup(sampleSchema, {
			files: ["data/**"],
			associations: [{ files: ["data/**"], schema: `${base}/schema.json` }],
		})
		expect(await new Engine(project).validate(file, '"ok"')).toMatchObject({
			failures: [],
			diagnostics: [],
		})
		type = "number"
		expect(
			(await new Engine(project).validate(file, '"ok"')).diagnostics[0]?.code,
		).toBe("schema/type")
		status = 503
		expect(
			(await new Engine(project).validate(file, '"ok"')).failures[0]?.code,
		).toBe("schema-load")
	})
	test("request size, time and redirect limits fail visibly", async () => {
		const base = await serve((url, response) => {
			if (url === "/large") response.end(" ".repeat(2048))
			else if (url === "/redirect") {
				response.writeHead(302, { location: "/redirect" })
				response.end()
			} else if (url === "/slow") {
				/* deliberately pending until the fetch timeout */
			}
		})
		for (const [suffix, remote, expected] of [
			["large", { maxBytes: 128 }, "schema-limit"],
			["redirect", {}, "schema-limit"],
			["slow", { timeoutMs: 30 }, "schema-load"],
		] as const) {
			const { engine, file } = await setup(sampleSchema, {
				files: ["data/**"],
				associations: [{ files: ["data/**"], schema: `${base}/${suffix}` }],
				remote,
			})
			expect((await engine.validate(file, "{}")).failures[0]?.code).toBe(
				expected,
			)
		}
	})
	test("reference graph limits include local resources", async () => {
		const { engine, file } = await setup(
			{ $ref: "second.json" },
			{
				files: ["data/**"],
				associations: [{ files: ["data/**"], schema: "schema.json" }],
				remote: { maxRequests: 1 },
			},
		)
		expect((await engine.validate(file, "{}")).failures[0]?.code).toBe(
			"schema-limit",
		)
	})
})
