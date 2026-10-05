import { cp } from "node:fs/promises"

await cp(
	new URL("../core/pklr.wasm", import.meta.url),
	new URL("../../dist/pklr.wasm", import.meta.url),
)
await cp(
	new URL("../core/pklr.LICENSE", import.meta.url),
	new URL("../../dist/pklr.LICENSE", import.meta.url),
)
