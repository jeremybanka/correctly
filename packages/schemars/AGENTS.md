# Schemars extension consumer guidance

- Install `@correctlyjs/schemars` alongside a compatible `correctly`; the peer dependency declares the supported Correctly API.
- Import `schemars` from `@correctlyjs/schemars/ajv` and opt in per Ajv validator. Importing the package does not enable it globally.
- The package root exports `schemarsEras`, `SchemarsEra`, `SchemarsVersion`, and `SchemarsVersionSelection`; the factory implements `AjvExtension` from `correctly/validators/ajv`.
- Types derive from the literal catalog in `src/eras.ts`; keep that module self-contained so CI can load both Git revisions. Version selections must be reviewed exact releases or ordered closed ranges within one era.
- `version` identifies an upstream Schemars release or closed range within one reviewed era, not this package's npm version.
- Consult `docs/guide.md` for the complete supported format and precision contract.
- This package releases independently of Correctly. Each newly reviewed upstream release needs its own extension changeset; consecutive reviewed releases may ship together in one publication.
