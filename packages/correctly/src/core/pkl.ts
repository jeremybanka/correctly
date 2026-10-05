import type { ParsedDocument } from "./parse.ts"
import { pklDiagnostic, runPkl, wasmPath } from "./pkl-runtime.ts"

export async function parsePkl(
	text: string,
	context: { file: string; signal?: AbortSignal },
): Promise<ParsedDocument> {
	context.signal?.throwIfAborted()
	const outcome = await runPkl({
		source: text,
		file: wasmPath(context.file),
		evaluate: false,
	})
	context.signal?.throwIfAborted()
	return {
		value: text,
		diagnostics: outcome.error
			? [pklDiagnostic(text, context.file, outcome.error)]
			: [],
		locate: () => ({ offset: 0, length: text.length }),
	}
}
