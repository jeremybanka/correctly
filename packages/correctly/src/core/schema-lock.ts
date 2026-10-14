import { createHash } from "node:crypto"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { readText, type ReadText } from "./config.ts"
import { CorrectlyError } from "./types.ts"

export const SCHEMA_LOCK = ".correctly/correctly.lock"
export const PREVIOUS_SCHEMA_LOCK = "correctly.lock"
export const LEGACY_SCHEMA_LOCK = ".correctly/lock.json"
export type LockedSchema = {
	digest: string
	discoveredAt: string
	packages: Record<string, string>
}
export type SchemaLock = {
	lockVersion: 1 | 2
	/** Retrieval URLs without fragments; identifiers inside schemas remain unchanged. */
	schemas: Record<string, LockedSchema>
}
export function schemaDigest(text: string): string {
	return createHash("sha256").update(text).digest("hex")
}
export function vendoredSchemaPath(root: string, uri: string): string {
	const url = new URL(uri)
	if (!["http:", "https:"].includes(url.protocol))
		throw new CorrectlyError("schema-lock", `Unsupported retrieval URL: ${uri}`)
	url.hash = ""
	// Escape literal underscores before using double underscores for URL slashes.
	// Retain the authority, path and query without filesystem metacharacters.
	const source = encodeURIComponent(url.href.slice(url.protocol.length + 2))
		.replace(/%[0-9A-F]{2}|[A-Z_!'()*~]/g, (token) =>
			token.startsWith("%")
				? token
				: `%${token.charCodeAt(0).toString(16).toUpperCase()}`,
		)
		.replaceAll("%2F", "__")
		.replace(/\.$/, "%2E")
	return path.join(root, ".correctly", "schemas", source)
}
/** Read the exact pinned bytes, including snapshots using digest-derived filenames. */
export async function readLockedSchema(
	root: string,
	uri: string,
	lock: SchemaLock,
	read: ReadText = readText,
): Promise<string> {
	const entry = Object.hasOwn(lock.schemas, uri) ? lock.schemas[uri] : undefined
	if (!entry)
		throw new CorrectlyError(
			"schema-lock",
			`Schema is not locked: ${uri}; run correctly schemas pull`,
		)
	const file =
		lock.lockVersion === 1
			? path.join(root, ".correctly", "schemas", `${entry.digest}.json`)
			: vendoredSchemaPath(root, uri)
	let text: string
	try {
		text = await read(pathToFileURL(file).href)
	} catch (error) {
		throw new CorrectlyError(
			"schema-lock",
			`Cannot read vendored schema ${file}: ${String(error)}`,
		)
	}
	if (schemaDigest(text) !== entry.digest)
		throw new CorrectlyError(
			"schema-integrity",
			`Digest mismatch for vendored schema ${uri}: ${file}`,
		)
	return text
}
function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
export async function readSchemaLock(
	root: string,
	read: ReadText = readText,
): Promise<SchemaLock | undefined> {
	let file = "",
		text: string | undefined
	for (const name of [SCHEMA_LOCK, PREVIOUS_SCHEMA_LOCK, LEGACY_SCHEMA_LOCK]) {
		file = path.join(root, name)
		try {
			text = await read(pathToFileURL(file).href)
			break
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
			throw new CorrectlyError(
				"schema-lock",
				`Cannot read ${file}: ${String(error)}`,
			)
		}
	}
	if (text === undefined) return undefined
	try {
		const lock: unknown = JSON.parse(text)
		if (
			!object(lock) ||
			![1, 2].includes(lock.lockVersion as number) ||
			!object(lock.schemas)
		)
			throw new Error("Expected lockVersion 1 or 2 and a schemas object")
		const filenames = new Map<string, string>()
		for (const [uri, entry] of Object.entries(lock.schemas)) {
			const url = new URL(uri)
			if (
				!["http:", "https:"].includes(url.protocol) ||
				url.hash ||
				url.href !== uri
			)
				throw new Error(`Invalid retrieval URL: ${uri}`)
			if (
				!object(entry) ||
				typeof entry.digest !== "string" ||
				!/^[a-f0-9]{64}$/.test(entry.digest) ||
				typeof entry.discoveredAt !== "string" ||
				!Number.isFinite(Date.parse(entry.discoveredAt)) ||
				!object(entry.packages) ||
				Object.values(entry.packages).some(
					(version) => typeof version !== "string" || !version,
				)
			)
				throw new Error(`Invalid schema entry: ${uri}`)
			if (lock.lockVersion === 2) {
				const filename = vendoredSchemaPath(root, uri)
				const digest = filenames.get(filename)
				if (digest !== undefined && digest !== entry.digest)
					throw new Error(
						`Schemas map to the same filename with different digests: ${filename}`,
					)
				filenames.set(filename, entry.digest)
			}
		}
		return lock as SchemaLock
	} catch (error) {
		throw new CorrectlyError("schema-lock", `Invalid ${file}: ${String(error)}`)
	}
}
