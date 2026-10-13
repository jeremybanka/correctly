import { createHash } from "node:crypto"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { readText, type ReadText } from "./config.ts"
import { CorrectlyError } from "./types.ts"

export const SCHEMA_LOCK = ".correctly/lock.json"
export type LockedSchema = {
	digest: string
	discoveredAt: string
	packages: Record<string, string>
}
export type SchemaLock = {
	lockVersion: 1
	/** Retrieval URLs without fragments; identifiers inside schemas remain unchanged. */
	schemas: Record<string, LockedSchema>
}
export function schemaDigest(text: string): string {
	return createHash("sha256").update(text).digest("hex")
}
export function vendoredSchemaPath(root: string, digest: string): string {
	return path.join(root, ".correctly", "schemas", `${digest}.json`)
}
function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
export async function readSchemaLock(
	root: string,
	read: ReadText = readText,
): Promise<SchemaLock | undefined> {
	const file = path.join(root, SCHEMA_LOCK)
	let text: string
	try {
		text = await read(pathToFileURL(file).href)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
		throw new CorrectlyError(
			"schema-lock",
			`Cannot read ${file}: ${String(error)}`,
		)
	}
	try {
		const lock: unknown = JSON.parse(text)
		if (!object(lock) || lock.lockVersion !== 1 || !object(lock.schemas))
			throw new Error("Expected lockVersion 1 and a schemas object")
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
		}
		return lock as SchemaLock
	} catch (error) {
		throw new CorrectlyError("schema-lock", `Invalid ${file}: ${String(error)}`)
	}
}
