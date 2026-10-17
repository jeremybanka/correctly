# Correctly for VS Code

Run `pnpm exec correctly vsix` in a project with Correctly installed to build and install the matching extension. Use `--target code-insiders` or `--target cursor` to choose another editor command, `--build-only` to skip installation, and `--outdir path` to change the default `dist` output directory. Rebuild and reinstall after upgrading Correctly; no separate source checkout is required.

Install Correctly and any imported adapters in the project, trust the workspace, install the VSIX, add `correctly.config.ts` to each workspace root, and open JSON, JSONC, YAML, or TOML files. Correctly uses that same external configuration for validation. Completion and hover currently support JSON/JSONC only. It reads unsaved data and schema buffers. Executable configuration and imported modules reload only after saving. The extension is disabled in untrusted workspaces. Install a language extension if your editor does not recognize YAML or TOML.

The client and server are bundled; no npm install or separate schema map is needed. Run **Correctly: Restart Server** to restart the language server. JSON formatting remains the responsibility of your formatter.

VS Code's built-in JSON features can also provide their own diagnostics or suggestions. Correctly diagnostics have source `correctly`. For an editor experience using only Correctly validation, set `json.validate.enable` to `false`; this does not affect Correctly or require another schema association map.
