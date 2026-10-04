import { schemarsEras, type EraDefinition, type SchemarsEra } from "./eras.ts"

export function compareVersions(left: string, right: string): number {
	const a = left.split(".").map(Number),
		b = right.split(".").map(Number)
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
	return 0
}
const VERSION = "(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)"
const EXACT = new RegExp(`^${VERSION}$`)
const RANGE = new RegExp(`^>=(${VERSION}) <=(${VERSION})$`)
export function selectSchemarsEra(selection: string): SchemarsEra
export function selectSchemarsEra<Era extends EraDefinition>(
	selection: string,
	eras: readonly Era[],
): Era
export function selectSchemarsEra(
	selection: string,
	eras: readonly EraDefinition[] = schemarsEras,
): EraDefinition {
	const range = typeof selection === "string" ? RANGE.exec(selection) : null
	const from = range?.[1] ?? selection,
		through = range?.[2] ?? selection
	if (
		typeof from !== "string" ||
		!EXACT.test(from) ||
		!EXACT.test(through) ||
		compareVersions(from, through) > 0
	)
		throw new Error(
			`Unsupported Schemars version selection: ${JSON.stringify(selection)}. Use an exact reviewed release or a closed range such as ">=0.8.15 <=0.8.22".`,
		)
	const first = eras.find((era) => era.versions.includes(from)),
		last = eras.find((era) => era.versions.includes(through))
	if (!first || !last)
		throw new Error(
			`Unsupported Schemars version selection: ${JSON.stringify(selection)}. Reviewed eras: ${eras.map((era) => `${era.since}–${era.versions.at(-1)}`).join(", ")}. Unreviewed releases are not enabled implicitly.`,
		)
	if (first !== last)
		throw new Error(
			`Schemars range ${JSON.stringify(selection)} crosses compatibility eras. Select releases from one era to avoid combining different validation semantics.`,
		)
	return first
}
