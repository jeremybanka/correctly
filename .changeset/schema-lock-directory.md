---
"correctly": minor
---

Write schema locks to `.correctly/correctly.lock` alongside vendored schemas, continuing to read root `correctly.lock` and legacy `.correctly/lock.json` snapshots and migrating them on the next successful pull without changing preserved discovery metadata; include `.correctly/**` in Renovate `postUpgradeTasks.fileFilters`.
