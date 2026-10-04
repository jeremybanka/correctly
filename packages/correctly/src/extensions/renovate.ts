import type { SchemaExtension } from "../core/extensions.ts"
export function renovate(): SchemaExtension {
	return { id: "renovate", annotations: ["x-renovate-version"] }
}
