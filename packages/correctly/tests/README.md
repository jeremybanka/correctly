# Test contracts

`public/` protects shared-core, configuration, CLI, and editor behavior. Its helpers and fixed fixtures live alongside those tests. Acceptance coverage includes dialects, schema identifiers/references, source locations, duplicate keys, CLI/LSP parity, unsaved buffers, cancellation/stale results, remote limits, offline cache, workspace roots, and actual sibling-repository configurations.

`private/` checks distribution mechanics: the built CLI and an isolated bundled VSIX server without installed npm dependencies. These tests run when build artifacts exist. CI explicitly builds both distributions, then runs `test:distribution`.

The test suite starts local HTTP servers to exercise real remote-loading behavior. It needs loopback network access; it does not fetch external schemas or depend on sibling repositories at test time. Fixture origins are recorded in `public/fixtures/repositories/README.md`.
