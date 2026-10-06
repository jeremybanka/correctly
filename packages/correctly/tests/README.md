# Test contracts

`public/` protects shared-core, configuration, CLI, and editor behavior. Its helpers and fixed fixtures live alongside those tests. Acceptance coverage includes dialects, schema identifiers/references, source locations, duplicate keys, CLI/LSP parity, unsaved buffers, cancellation/stale results, remote limits, offline cache, workspace roots, and actual sibling-repository configurations.

`private/` checks scheduling and distribution mechanics: the built CLI and an isolated bundled VSIX server without installed npm dependencies. The ordinary `test` command excludes distribution tests. Run `pnpm build`, `pnpm build:vsix`, then `pnpm test:distribution`; that command fails if artifacts are missing.

CI runs core tests, Schemars compatibility, and build/distribution checks in independent jobs. Distribution runs on both x86 and ARM Linux to verify that both build hosts reproduce the same PKL WASM and package working CLI/VSIX artifacts. The required `Test` job succeeds only when all three workloads pass, including both distribution platforms. `pnpm check:tests` asks each Vitest configuration for its files and verifies that every discovered test belongs to exactly one workload, including new tests. Each job uploads JSON test timings for seven days; WASM comparison failures also retain both binaries for diagnosis.

The test suite starts local HTTP servers to exercise real remote-loading behavior. It needs loopback network access; it does not fetch external schemas or depend on sibling repositories at test time. Fixture origins are recorded in `public/fixtures/repositories/README.md`.

Schemars format behavior, pinned Rust fixtures, and the compatibility release gate live in `packages/schemars/tests`. Core retains cross-extension, CLI, and editor integration coverage. Run `pnpm test:schemars` to reproduce every historical contract and review the Renovate probe.
