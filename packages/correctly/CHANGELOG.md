# correctly

## 0.0.1

### Patch Changes

- 3618e26: Color readable CLI reports, consolidate validation mode and schema association into file headers, and show allowed enum values consistently in CLI and editor diagnostics.
- c686ee6: Include the expected JSON value in const violations consistently across CLI and editor diagnostics.
- c3b6f5e: Highlight the later duplicated array item and identify its earlier counterpart by JSON pointer in uniqueItems diagnostics.
- 144cdf7: Group readable CLI diagnostics into distinct file sections with source-position ordering, numbered excerpts, context lines, and carets marking the affected range.
- 53cc30c: Group anyOf, oneOf, and conditional branch failures under their summaries in readable CLI reports and LSP related information, while preserving all diagnostics in JSON with optional context metadata.
- a631ac8: Distinguish oneOf failures with no matching alternatives from overlapping alternatives, naming the matching witnesses with one-based indices in CLI and editor diagnostics.
- bc49d36: Highlight the offending property key for underlying propertyNames validation reasons and preserve escaped JSON pointers in CLI and editor diagnostics.
