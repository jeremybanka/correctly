import path from "node:path"
import { cp } from "node:fs/promises"
import { rolldown } from "rolldown"

export async function bundleEditor(
	packageRoot: string,
	dist: string,
	entries: readonly (readonly [string, string])[],
	sourcemap = true,
): Promise<void> {
	for (const asset of ["pklr.wasm", "pklr.LICENSE"])
		await cp(path.join(packageRoot, "src/core", asset), path.join(dist, asset))
	for (const [entry, outfile] of entries) {
		const bundle = await rolldown({
			input: path.join(packageRoot, `src/${entry}.ts`),
			platform: "node",
			resolve: { mainFields: ["module", "main"] },
			external: ["vscode"],
			onLog: (level, log, handler) =>
				handler(log.code === "UNRESOLVED_IMPORT" ? "error" : level, log),
		})
		try {
			await bundle.write({
				file: path.join(dist, `${outfile}.mjs`),
				format: "esm",
				sourcemap,
			})
		} finally {
			await bundle.close()
		}
	}
}
