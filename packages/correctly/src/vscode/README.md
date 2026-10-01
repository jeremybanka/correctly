# Correctly for VS Code

Install the VSIX, add `correctly.config.json` to each workspace root, and open JSON or JSONC files. Correctly uses that same external configuration for validation, completion, and hover. It reads unsaved buffers and refreshes when configurations and schemas change.

The client and server are bundled; no npm install or separate schema map is needed. Run **Correctly: Restart Server** to restart the language server. JSON formatting remains the responsibility of your formatter.

VS Code's built-in JSON features can also provide their own diagnostics or suggestions. Correctly diagnostics have source `correctly`. For an editor experience using only Correctly validation, set `json.validate.enable` to `false`; this does not affect Correctly or require another schema association map.
