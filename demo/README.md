# CLI validation demo

This directory contains the valid and invalid project documents used to demonstrate Correctly's readable diagnostics. The schema association lives in `correctly.config.ts`, and the schema is local, so the demo works offline. Documents have no embedded schema link.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec correctly check --config demo/correctly.config.ts
```

The command reports **four errors across two files** and exits **1**. Each file has a separate heading, schema-association details, and numbered source excerpts with carets:

| Document            | Result                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `valid.json`        | Passes: a string name and an allowed color.                                                      |
| `invalid.json`      | Fails: `name` is a number, `color` is outside the enum, and `debug` is disallowed.               |
| `missing-name.json` | Fails: the required `name` property is missing; its diagnostic highlights the containing object. |

Run only the valid document to see exit **0**, or request the stable JSON report:

```sh
pnpm exec correctly check --config demo/correctly.config.ts demo/valid.json
pnpm exec correctly check --config demo/correctly.config.ts --format json
```

File arguments resolve from the current directory. The configuration's file patterns and schema path resolve from this directory. You can also run `../node_modules/.bin/correctly check` from inside `demo` to discover the configuration automatically.

For the editor demo, install the repository's VSIX and open this directory as a VS Code workspace. The same external association supplies diagnostics, property completions, `color` value suggestions, and schema descriptions on hover. Change an invalid value or add the missing `name` in an unsaved buffer to see diagnostics update. See the [package guide](../packages/correctly/docs/guide.md) for extension installation and editor settings.
