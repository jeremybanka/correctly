# Schemars extension consumer guidance

- Install `@correctlyjs/schemars` alongside a compatible `correctly`; the peer dependency declares the supported Correctly API.
- Import `schemars` and opt in per Ajv validator. Importing the package does not enable it globally.
- `version` identifies an upstream Schemars release or closed range within one reviewed era, not this package's npm version.
- Consult `docs/guide.md` for the complete supported format and precision contract.
- This package releases independently of Correctly. Each newly reviewed upstream release needs its own extension changeset and publication.
