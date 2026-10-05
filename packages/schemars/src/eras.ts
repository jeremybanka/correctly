/** Structural shape used when checking historical or candidate catalogs. */
export type EraDefinition = {
	readonly since: string
	readonly versions: readonly string[]
}

/** Reviewed releases, grouped by identical generated schema contracts.
 * Keep this module self-contained: CI loads it from both Git revisions.
 */
export const schemarsEras = Object.freeze([
	Object.freeze({
		since: "0.8.15",
		versions: Object.freeze([
			"0.8.15",
			"0.8.16",
			"0.8.17",
			"0.8.18",
			"0.8.19",
			"0.8.20",
			"0.8.21",
			"0.8.22",
		] as const),
	}),
	Object.freeze({
		since: "0.9.0",
		versions: Object.freeze(["0.9.0"] as const),
	}),
	Object.freeze({
		since: "1.0.0",
		versions: Object.freeze(["1.0.0", "1.0.1", "1.0.2", "1.0.3"] as const),
	}),
	Object.freeze({
		since: "1.0.4",
		versions: Object.freeze(["1.0.4", "1.0.5"] as const),
	}),
	Object.freeze({
		since: "1.1.0",
		versions: Object.freeze(["1.1.0"] as const),
	}),
	Object.freeze({
		since: "1.2.0",
		versions: Object.freeze(["1.2.0"] as const),
	}),
	Object.freeze({
		since: "1.2.1",
		versions: Object.freeze(["1.2.1", "1.2.2"] as const),
	}),
] as const satisfies readonly EraDefinition[])

/** One of the compatibility eras reviewed by this package. */
export type SchemarsEra = (typeof schemarsEras)[number]
/** An exact reviewed upstream release. */
export type SchemarsVersion = SchemarsEra["versions"][number]

// The ordered tuple supplies each lower bound and only upper bounds at or after it.
type ClosedRanges<
	Versions extends readonly string[],
	Ranges extends string = never,
> = Versions extends readonly [
	infer First extends string,
	...infer Rest extends readonly string[],
]
	? ClosedRanges<Rest, Ranges | `>=${First} <=${Versions[number]}`>
	: Ranges

// Distribute over eras before constructing ranges so they cannot cross eras.
export type VersionSelection<Era extends EraDefinition> =
	Era extends EraDefinition
		? Era["versions"][number] | ClosedRanges<Era["versions"]>
		: never

/** An exact reviewed release or an ordered, inclusive range within one era. */
export type SchemarsVersionSelection = VersionSelection<SchemarsEra>
