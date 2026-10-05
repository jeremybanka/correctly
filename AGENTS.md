# Correctly workspace

- Use TypeScript for source and Node scripts. Generated bundle extensions follow the build tool.
- Keep consumer guidance in `packages/correctly/AGENTS.md` and detailed examples in `packages/correctly/docs/guide.md`.
- Schemars implementation, format documentation, fixtures, and release policy belong to the independently published `packages/schemars` package.
- Public CLI, core, and LSP behavior belongs in `tests/public`; scheduling and packaging checks belong in `tests/private`.
- Keep changeset bodies on one line. Before 1.0, use patches for features/fixes and minors for breaking changes.
- Use `fmt` to format, `check` for static validators, and `test` for a single test run.
- Vite Plus upgrades use the target release's official `vp migrate --no-interactive`; preserve the old lockfile until it runs.
