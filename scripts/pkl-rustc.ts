#!/usr/bin/env node
import { spawnSync } from "node:child_process"

// Cargo hashes absolute paths into metadata for path dependencies. Keep the
// identities of our two pinned path crates stable across checkout locations.
const [compiler, ...args] = process.argv.slice(2)
if (!compiler) throw new Error("Missing Rust compiler")
const name = args[args.indexOf("--crate-name") + 1]
const pinned = name === "pklr" || name === "correctly_pklr"
const mapped = args.map((arg) =>
	pinned && arg.startsWith("metadata=")
		? `metadata=correctly-pklr-5084552234a7e5f8a691df61d80b4141cea84f4f-${name}`
		: arg,
)
// Node closes the inherited jobserver descriptors. Don't advertise them to rustc.
const env = { ...process.env }
delete env.CARGO_MAKEFLAGS
const result = spawnSync(compiler, mapped, { stdio: "inherit", env })
if (result.error) throw result.error
process.exit(result.status ?? 1)
