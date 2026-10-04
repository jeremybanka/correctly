import type { AjvExtension } from "../core/extensions.ts"
export function renovate(): AjvExtension {
	return { id: "renovate", annotations: ["x-renovate-version"] }
}
