# Repository commands

Run from the repository root with `pnpm run <command>`. `mise.toml` selects Node 26.10.0 and pnpm 12.9.0. Published runtime code targets Node 22.18 or later.

| Command             | Contract                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `fmt`               | Apply dprint formatting.                                                                                                                       |
| `check`             | Run all `check:*` static validators.                                                                                                           |
| `check:fmt`         | Check dprint formatting without rewriting.                                                                                                     |
| `check:vp`          | Run Vite Plus lint and TypeScript checks.                                                                                                      |
| `check:correctly`   | Validate repository JSON/JSONC using Correctly's configuration.                                                                                |
| `test`              | Run public and private source tests once.                                                                                                      |
| `test:watch`        | Run interactive test suites.                                                                                                                   |
| `test:public`       | Run each package's public tests once.                                                                                                          |
| `test:breaks`       | Replay each package's latest released public tests through break-check.                                                                        |
| `build`             | Build ESM CLI, LSP, and typed shared-core entries.                                                                                             |
| `build:vsix`        | Bundle the VS Code client/server and write a universal VSIX to `artifacts`.                                                                    |
| `test:schemars`     | Reproduce all pinned Schemars releases and review the Renovate probe; set `SCHEMARS_BASE_REF=origin/main` locally to include PR policy checks. |
| `test:distribution` | Verify built CLI and isolated bundled server after both builds.                                                                                |
| `change`            | Author release notes; bodies stay on one line.                                                                                                 |
| `release:version`   | Prepare versions and release metadata without publishing.                                                                                      |

CI runs `check`, `test:schemars`, `test`, `test:breaks`, `build`, `build:vsix`, and `test:distribution`. Source tests and builds run independently. Distribution checks run after building the artifacts they inspect. The release workflow versions and publishes with Changesets. Each new stable Schemars release requires an explicit compatibility review and its own `@correctlyjs/schemars` changeset and release. Before 1.0, features/fixes use patches and breaking changes use minors.

The [test contracts](../packages/correctly/tests/README.md) describe break-check's restore boundary and certification. Commit changes before running `test:breaks`; it requires a clean checkout and access to `origin` and release tags.
