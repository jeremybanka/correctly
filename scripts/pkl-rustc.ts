#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"

// Cargo's crate identifiers depend on the host compiler as well as paths.
// Normalize every crate, including registry dependencies and proc macros,
// so ARM and x86 hosts produce identical symbols in the WASM target.
const [compiler, ...args] = process.argv.slice(2)
if (!compiler) throw new Error("Missing Rust compiler")
const name = args[args.indexOf("--crate-name") + 1]
const features = args
	.flatMap((arg, index) =>
		arg === "--cfg" && args[index + 1]?.startsWith("feature=")
			? [args[index + 1]!]
			: [],
	)
	.sort()
const targetIndex = args.indexOf("--target")
const identity = createHash("sha256")
	.update(
		JSON.stringify({
			package: process.env.CARGO_PKG_NAME,
			version: process.env.CARGO_PKG_VERSION,
			name,
			target: targetIndex === -1 ? "host" : args[targetIndex + 1],
			features,
		}),
	)
	.digest("hex")
const mapped = args.map((arg) =>
	arg.startsWith("metadata=") ? `metadata=correctly-pklr-${identity}` : arg,
)
// Build script output directories also contain Cargo's host-dependent hashes.
if (process.env.OUT_DIR)
	mapped.push(
		`--remap-path-prefix=${process.env.OUT_DIR}=/cargo-out/${process.env.CARGO_PKG_NAME}-${process.env.CARGO_PKG_VERSION}`,
	)
// Node closes the inherited jobserver descriptors. Don't advertise them to rustc.
const env = { ...process.env }
delete env.CARGO_MAKEFLAGS
const result = spawnSync(compiler, mapped, { stdio: "inherit", env })
if (result.error) throw result.error
process.exit(result.status ?? 1)
