# Test contracts

`public/` protects shared-core, configuration, CLI, and editor behavior. Its helpers and fixed fixtures live alongside those tests. Acceptance coverage includes dialects, schema identifiers/references, source locations, duplicate keys, CLI/LSP parity, unsaved buffers, cancellation/stale results, remote limits, offline cache, workspace roots, and actual sibling-repository configurations.

`private/` checks scheduling and distribution mechanics: the built CLI and isolated bundled VSIX/Zed servers without installed npm dependencies. Zed checks inspect the precompiled component, extract its embedded bundles from the shareable archive, and exercise stdio diagnostics, hints, and reloads. The ordinary `test` command excludes distribution tests. Run `pnpm build`, `pnpm build:vsix`, `pnpm build:zed`, then `pnpm test:distribution`; that command fails if artifacts are missing. The Zed build requires the `wasm32-wasip2` Rust target.

CI runs core tests, Schemars compatibility, and build/distribution checks in independent jobs. The required `Test` job succeeds only when all three pass. `pnpm check:tests` asks each Vitest configuration for its files and verifies that every discovered test belongs to exactly one workload, including new tests. Each job uploads JSON test timings for seven days.

The test suite starts local HTTP servers to exercise real remote-loading behavior. It needs loopback network access; it does not fetch external schemas or depend on sibling repositories at test time. Fixture origins are recorded in `public/fixtures/repositories/README.md`.

Schemars format behavior, pinned Rust fixtures, and the compatibility release gate live in `packages/schemars/tests`. Core retains cross-extension, CLI, and editor integration coverage. Run `pnpm test:schemars` to reproduce every historical contract and review the Renovate probe.
