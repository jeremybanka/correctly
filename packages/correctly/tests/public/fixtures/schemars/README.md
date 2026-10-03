# Schemars 0.8.22 contract fixtures

`Cargo.toml` installs upstream `schemars = "=0.8.22"`, including its exactly pinned derive crate. `Cargo.lock` locks the entire fixture generator graph. The generator enables every optional integration offered by that release; aliases select the same underlying features. `ui_test` only enables upstream compile-fail tests and is intentionally absent.

`src/main.rs` generates 74 draft-7 schemas from actual Rust types, including every primitive format, signed/unsigned nonzero and atomic wrappers, networking types, all format-bearing optional integrations, every other optional integration, and derive's email/URL/phone attributes. `schemas.json` is its unedited stdout. These schemas are compiled by the public tests; every emitted format also has positive and negative assertion cases in both supported JSON Schema dialects. Wrapper tests verify additional nonzero constraints and nested references.

Run `pnpm test:schemars` from the repository root with the Mise Rust toolchain installed. It runs Cargo with `--locked` and compares newly generated JSON structurally with the checked-in fixture. CI runs this before the public tests. The ordinary JavaScript test suite uses the checked-in fixture and requires no Rust installation or network. End users never install Rust or Schemars.

For an intentional compatibility-version change, review upstream source and this inventory, update the exact crate and extension identifiers, regenerate the lockfile and fixtures, and update all behavioral cases and consumer documentation together. Do not silently repoint an existing extension ID to a newer generator version.

## Source audit

The pinned [primitive implementations](https://github.com/GREsau/schemars/blob/v0.8.22/schemars/src/json_schema_impls/primitives.rs) emit 17 distinct formats: 14 numeric formats, `ip`, `ipv4`, and `ipv6`. The [chrono integration](https://github.com/GREsau/schemars/blob/v0.8.22/schemars/src/json_schema_impls/chrono.rs) adds `date`, `date-time`, and `partial-date-time`; both NaiveTime and NaiveDateTime use the latter. UUID integrations add `uuid`, URL adds `uri`, and [derive validation attributes](https://github.com/GREsau/schemars/blob/v0.8.22/schemars_derive/src/attr/validation.rs) add `email`, `phone`, and the already-counted `uri`: 24 formats total. Other implementations forward those schemas or emit standard keywords, patterns, and enums.

Support covers that finite extension surface. Arbitrary user-written JsonSchema implementations, schema_with callbacks, custom generator settings, and OpenAPI output are not an enumerable Schemars contract. See the consumer guide for precise format policies, including numeric precision and ambiguous string-format conventions.
