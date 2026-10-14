---
"correctly": patch
---

Add repeatable `schemas pull --association name` selectors and an explicit `--all` option, preserving unselected schema bytes and provenance, pinning shared references until their owners are selected together, and rejecting stale concurrent updates; use dependency-specific Renovate `packageRules` to refresh only the upgrade's related schemas, with document validation remaining in CI.
