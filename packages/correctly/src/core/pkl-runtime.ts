import { readFile } from "node:fs/promises"
import { CorrectlyError } from "./types.ts"
import { diagnostic } from "./parse.ts"

type Exports = {
	memory: { buffer: ArrayBuffer }
	allocate(length: number): number
	deallocate(pointer: number, length: number): void
	run(pointer: number, length: number): bigint
}
// Node supplies WebAssembly; these are the small ABI types used by our bridge.
const wasm = (
	globalThis as typeof globalThis & {
		WebAssembly: {
			compile(bytes: Uint8Array): Promise<unknown>
			instantiate(module: unknown): Promise<{ exports: Exports }>
		}
	}
).WebAssembly
let compiled: Promise<unknown> | undefined
export type PklOutcome = {
	ok?: boolean
	json?: string
	requests?: string[]
	error?: {
		code: string
		message: string
		offset?: number | null
		source?: string | null
	}
}
export function wasmPath(file: string): string {
	return process.platform === "win32" ? `/${file.replace(/\\/g, "/")}` : file
}
export function hostPath(file: string): string {
	return process.platform === "win32" && /^\/[A-Za-z]:\//.test(file)
		? file.slice(1)
		: file
}
export async function runPkl(input: {
	source: string
	file: string
	evaluate: boolean
	resources?: Record<string, unknown>
	environment?: Record<string, string>
	properties?: Record<string, string>
}): Promise<PklOutcome> {
	try {
		compiled ??= readFile(new URL("./pklr.wasm", import.meta.url)).then(
			(bytes) => wasm.compile(bytes),
		)
		// Separate memories keep concurrent validations and replay attempts isolated.
		const { exports } = await wasm.instantiate(await compiled)
		const bytes = Buffer.from(JSON.stringify(input))
		const address = exports.allocate(bytes.length)
		let output: number | undefined
		let size = 0
		try {
			new Uint8Array(exports.memory.buffer, address, bytes.length).set(bytes)
			const result = exports.run(address, bytes.length)
			output = Number(result & 0xffffffffn)
			size = Number(result >> 32n)
			return JSON.parse(
				Buffer.from(exports.memory.buffer, output, size).toString("utf8"),
			) as PklOutcome
		} finally {
			exports.deallocate(address, bytes.length)
			if (output !== undefined) exports.deallocate(output, size)
		}
	} catch (error) {
		throw new CorrectlyError(
			"pkl-runtime",
			`Cannot run pklr WASM: ${String(error)}`,
		)
	}
}
export function pklDiagnostic(
	text: string,
	file: string,
	error: NonNullable<PklOutcome["error"]>,
) {
	const local = !error.source || error.source === wasmPath(file)
	const offset =
		local && error.offset != null
			? Buffer.from(text).subarray(0, error.offset).toString("utf8").length
			: 0
	return diagnostic(
		text,
		error.code,
		local ? error.message : `${error.source}: ${error.message}`,
		"",
		offset,
	)
}
