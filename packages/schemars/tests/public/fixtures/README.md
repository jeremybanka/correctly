# Schemars compatibility contracts

The first reviewed era begins at **0.8.15** and includes every patch through **0.8.22**. `versions/<version>/Cargo.toml` installs exactly that upstream Schemars version; its `Cargo.lock` locks the matching derive crate and the entire dependency graph. Every optional integration offered by these releases is enabled; aliases select the same underlying features. `ui_test` only enables upstream compile-fail tests and is intentionally absent.

`eras/0.8.15.rs` generates 74 draft-7 schemas from actual Rust types: every primitive format, signed/unsigned nonzero and atomic wrappers, networking types, every optional integration, and derive's email/URL/phone attributes. `eras/0.8.15.json` is its unedited JSON output. All eight generators reproduce that corpus structurally. Public tests compile every schema and assert positive/negative cases for every emitted format in both supported JSON Schema dialects, plus nonzero constraints and nested references. Exact release and closed-range selection are tested through executable configuration.

Run `pnpm test:schemars` from the repository root with the Mise Rust toolchain installed. Cargo runs with `--locked`; CI regenerates all historical releases before the JavaScript tests. The ordinary JavaScript suite uses checked-in fixtures and requires neither Rust nor network. End users never install Rust or Schemars.

## Renovate and the mandatory review

`compatibility/schemars/probe/Cargo.toml` is the single moving candidate pin. It has its own generator source, independent of frozen historical generators. It lives outside `tests` because `config:recommended` includes `:ignoreModulesAndTests`, whose directory globs include `**/tests/**`. Renovate discovers the probe with its Cargo manager, updates only its Schemars dependency, opens the PR without a release-age wait, and cannot automerge it. Historical pins and probe helper dependencies are excluded from automated updates. Stable upstream releases are tracked; prereleases are outside the supported version grammar.

The Test job passes the PR base SHA as `SCHEMARS_BASE_REF`. The gate loads the reviewed catalog and corpora from that Git revision, regenerates the candidate, and writes its output to `artifacts/schemars/<version>.json`. On the initial dependency-only PR it exits nonzero with one of:

- `SCHEMARS_ERA_EXTENSION_REQUIRED`: the schemas are identical; explicitly extend the existing era to include the candidate.
- `SCHEMARS_NEW_ERA_REQUIRED`: schemas changed; add an era starting at exactly the candidate version, preserving the previous era.

Cargo/API/feature incompatibilities must first be resolved in the probe so it can produce evidence. Such a failure is never treated as proof that output is compatible. Compare parsed JSON structurally; key order is irrelevant, but changed properties, constraints, or array order are changes. Matching this finite corpus does not prove every possible Rust program emits identical schemas: review upstream implementation and feature changes for additions missing from the corpus before accepting an era extension.

## Approving and releasing a candidate

1. Review upstream changes and update the probe's inventory for newly supported types, integrations, or formats. Keep its source and enabled features exhaustive for the claimed surface. Do not edit historical sources, manifests, lockfiles, or corpora.
2. If output matches, append the candidate to that era's `versions` in `packages/schemars/src/eras.json`. If output differs, add a new catalog entry whose `since` is the candidate, commit its generated `eras/<version>.json`, freeze its generator as `eras/<version>.rs`, and implement its version-specific assertion policy in the extension. Never combine incompatible era semantics.
3. Add `versions/<version>/Cargo.toml` and `Cargo.lock`, copied from the reviewed probe, pointing the manifest's binary at the appropriate frozen era source. Both Schemars and its derive crate must resolve to that exact version. The probe keeps its own source for the next update.
4. Add behavioral cases for new or changed assertions, retain prior era coverage, and update the consumer guide's support catalog and precise format policies. Add a **new** @correctlyjs/schemars changeset naming the exact Schemars version. Era extension alone still needs a patch release. Before 1.0, breaking changes need a minor.
5. Stage the new files, then run `SCHEMARS_BASE_REF=origin/main pnpm test:schemars`, `pnpm check`, `pnpm test`, and the distribution builds/checks. The base comparison prevents rewriting history or approving multiple new versions together; the initial adoption PR alone bootstraps the eight historical releases.
6. Merge the reviewed update and publish its Changesets release before accepting the next Schemars update. The next update checks for a pending previous Schemars changeset and verifies the base extension package version exists on npm. Publication remains the existing release workflow's responsibility.

Renovate may coalesce patch releases that arrive between its runs; its settings do not promise a PR for every intermediate patch. The CI gate also checks the crates.io index and refuses to skip intervening stable versions. If the proposed candidate skips one, first review and ship the earliest intervening release, then proceed in order. A newer candidate's PR remains red until its predecessors have shipped. Correctly core does not need a release when the extension contract remains compatible. A closed consumer range does not grow automatically when an era is extended; widening that range is explicit.

## Source audit

The pinned [primitive implementations](https://github.com/GREsau/schemars/blob/v0.8.22/schemars/src/json_schema_impls/primitives.rs) emit 17 distinct formats: 14 numeric formats, `ip`, `ipv4`, and `ipv6`. The [chrono integration](https://github.com/GREsau/schemars/blob/v0.8.22/schemars/src/json_schema_impls/chrono.rs) adds `date`, `date-time`, and `partial-date-time`; both NaiveTime and NaiveDateTime use the latter. UUID integrations add `uuid`, URL adds `uri`, and [derive validation attributes](https://github.com/GREsau/schemars/blob/v0.8.22/schemars_derive/src/attr/validation.rs) add `email`, `phone`, and the already-counted `uri`: 24 formats total. Other implementations forward those schemas or emit standard keywords, patterns, and enums.

Support covers that finite extension surface. Arbitrary user-written JsonSchema implementations, schema_with callbacks, custom generator settings, and OpenAPI output are not an enumerable Schemars contract. See the consumer guide for precise format policies, including numeric precision and ambiguous string-format conventions.
