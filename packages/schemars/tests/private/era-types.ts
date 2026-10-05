import type { VersionSelection } from "../../src/eras.ts"

// Hypothetical eras ensure range construction keeps each tuple independent.
type Selections = VersionSelection<
	| { since: "0.8.9"; versions: readonly ["0.8.9", "0.8.10"] }
	| { since: "1.0.0"; versions: readonly ["1.0.0", "1.0.1"] }
>
type Expected =
	| "0.8.9"
	| "0.8.10"
	| ">=0.8.9 <=0.8.9"
	| ">=0.8.9 <=0.8.10"
	| ">=0.8.10 <=0.8.10"
	| "1.0.0"
	| "1.0.1"
	| ">=1.0.0 <=1.0.0"
	| ">=1.0.0 <=1.0.1"
	| ">=1.0.1 <=1.0.1"

// Bidirectional assignment checks the entire union, including equal bounds,
// numeric ordering across digit widths, and absence of cross-era ranges.
export function everySelection(value: Selections): Expected {
	return value
}
export function everyExpected(value: Expected): Selections {
	return value
}
