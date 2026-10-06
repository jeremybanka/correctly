# Test contracts

`public/` protects shared-core, configuration, CLI, and editor behavior. Its helpers and fixed fixtures live alongside those tests. Acceptance coverage includes dialects, schema identifiers/references, source locations, duplicate keys, CLI/LSP parity, unsaved buffers, cancellation/stale results, remote limits, offline cache, workspace roots, and actual sibling-repository configurations.

`private/` checks scheduling and distribution mechanics: the built CLI and an isolated bundled VSIX server without installed npm dependencies. The ordinary `test` command excludes distribution tests. Run `pnpm build`, `pnpm build:vsix`, then `pnpm test:distribution`; that command fails if artifacts are missing.

CI runs core tests, Schemars compatibility, build/distribution checks, and released public contracts in independent jobs. The required `Test` job succeeds only when all four pass. `pnpm check:tests` asks each ordinary and distribution Vitest configuration for its files and verifies that every discovered test belongs to exactly one of those workloads, including new tests. The historical job intentionally replays public tests. The ordinary workloads upload JSON test timings for seven days.

The test suite starts local HTTP servers to exercise real remote-loading behavior. It needs loopback network access; it does not fetch external schemas or depend on sibling repositories at test time. Fixture origins are recorded in `public/fixtures/repositories/README.md`.

Schemars format behavior, pinned Rust fixtures, and the compatibility release gate live in `packages/schemars/tests`. Core retains cross-extension, CLI, and editor integration coverage. Run `pnpm test:schemars` to reproduce every historical contract and review the Renovate probe.

## Released public contracts

Run `pnpm test` for current contracts and `pnpm test:breaks` for released contracts. Each package has a `test:breaks` script and `break-check.config.json`, like `atom.io`. The root command runs them recursively. Public tests use source directly; builds run independently, and distribution tests check built artifacts.

break-check restores public tests, fixtures, and helpers from the latest matching `correctly@<version>` or `@correctlyjs/schemars@<version>` tag, runs `test:public`, then restores the working copy. Both configs use the repository root as their base so Schemars can also preserve Correctly's shared test helper. Recursive checks run sequentially because that helper overlaps Correctly's restore pattern. The test commands run directly without task caching and fail if no tests are selected.

Commit changes first; break-check needs a clean checkout and access to `origin` and release tags. Before 1.0, an intentional break is certified by a minor changeset for the affected package, following `atom.io`'s release convention. Review the failure before certifying it; a missing baseline remains inconclusive. See [break-check's consumer-contract guide](https://github.com/jeremybanka/wayforge/tree/main/packages/break-check#writing-consumer-contracts) for choosing assertions and preserving their observation helpers.
