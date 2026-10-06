# Test contracts

`public/` protects shared-core, configuration, CLI, and editor behavior. Its helpers and fixed fixtures live alongside those tests. Acceptance coverage includes dialects, schema identifiers/references, source locations, duplicate keys, CLI/LSP parity, unsaved buffers, cancellation/stale results, remote limits, offline cache, workspace roots, and actual sibling-repository configurations.

`private/` checks scheduling and distribution mechanics: the built CLI and an isolated bundled VSIX server without installed npm dependencies. The ordinary `test` command excludes distribution tests. Run `pnpm build`, `pnpm build:vsix`, then `pnpm test:distribution`; that command fails if artifacts are missing.

CI runs core tests, Schemars compatibility, build/distribution checks, and released public contracts in independent jobs. The required `Test` job succeeds only when all four pass. `pnpm check:tests` asks each ordinary and distribution Vitest configuration for its files and verifies that every discovered test belongs to exactly one of those workloads, including new tests. The historical job intentionally replays public tests. The ordinary workloads upload JSON test timings for seven days.

The test suite starts local HTTP servers to exercise real remote-loading behavior. It needs loopback network access; it does not fetch external schemas or depend on sibling repositories at test time. Fixture origins are recorded in `public/fixtures/repositories/README.md`.

Schemars format behavior, pinned Rust fixtures, and the compatibility release gate live in `packages/schemars/tests`. Core retains cross-extension, CLI, and editor integration coverage. Run `pnpm test:schemars` to reproduce every historical contract and review the Renovate probe.

## Released public contracts

`pnpm test:break-check` follows [break-check's setup and consumer-contract guide](https://github.com/jeremybanka/wayforge/tree/main/packages/break-check#writing-consumer-contracts). It first runs both current public suites. It then restores Correctly's public files from the newest `correctly@<version>` release and Schemars' public files from the newest `@correctlyjs/schemars@<version>` release, running each package's `test:public` command before restoring the working copy. The checks run sequentially because Schemars also restores Correctly's shared `helpers.ts`.

The restore patterns include all public assertions, fixtures, helpers, public runner configurations, and consumer type samples. Keep support files that determine assertion meaning within that boundary. Leave the implementation under test outside it. Public tests still exercise internal source entrypoints for some CLI, LSP, and core behavior; passing the replay protects those tested behaviors and does not prove every package export or harmless internal refactor is covered. Consumer type samples resolve through package exports with the workspace source aliases disabled.

Each `test:public` command rebuilds the current packages after restoration, checks the public TypeScript files against built declarations, and runs only public tests once. The public runner fails on an empty suite. Builds use `vp run` without caching and tests invoke `vp test` directly, so historical files cannot reuse a current-suite task result. The ordinary `test` and distribution jobs continue checking current implementation and packaging separately.

Run from the repository root with a clean, committed checkout and network access to `origin`; CI fetches full history and tags. Config paths are explicit because these are independent packages; their patterns and commands are relative to the repository root. To replay one package after checking its current suite, run `pnpm exec break-check packages/correctly/break-check.config.json` or `pnpm exec break-check packages/schemars/break-check.config.json`.

Certification is deliberately `false`. A failing released assertion exits 1; an absent release or a release without public files remains inconclusive and exits 2. Neither is silently accepted. Review failures to separate a consumer regression from a build, declaration, dependency, or runner failure. Intentional breaks require an explained release plan (minor before 1.0, major afterward); this setup does not automatically certify them from a changeset. Dependencies and the shared lockfile stay current, so upgrades must keep historical readers runnable.
