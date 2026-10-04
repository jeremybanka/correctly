# Correctly for VS Code

Install Correctly and any imported adapters in the project, trust the workspace, install the VSIX, add `correctly.config.ts` to each workspace root, and open JSON or JSONC files. Correctly uses that same external configuration for validation, completion, and hover. It reads unsaved data and schema buffers. Executable configuration and imported modules reload only after saving. The extension is disabled in untrusted workspaces.

The client and server are bundled; no npm install or separate schema map is needed. Run **Correctly: Restart Server** to restart the language server. JSON formatting remains the responsibility of your formatter.

VS Code's built-in JSON features can also provide their own diagnostics or suggestions. Correctly diagnostics have source `correctly`. For an editor experience using only Correctly validation, set `json.validate.enable` to `false`; this does not affect Correctly or require another schema association map.
