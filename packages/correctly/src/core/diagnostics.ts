import type { ErrorObject } from "ajv"
import type { Diagnostic } from "./types.ts"

export type DiagnosticView = Diagnostic & {
	branches: { label: string; diagnostics: DiagnosticView[] }[]
}

// Ajv emits branch failures before the applicator's summary. Keep the complete
// flat report and annotate only relationships established by schema paths.
// Reference paths can lose their caller; leave those errors standalone.
export function validationContexts(
	errors: readonly ErrorObject[],
	diagnostics: Diagnostic[],
): Diagnostic[] {
	const summaries = errors.flatMap((error, index) => {
		if (error.keyword === "anyOf" || error.keyword === "oneOf")
			return [
				{ index, error, prefix: `${error.schemaPath}/`, alternative: true },
			]
		if (
			error.keyword === "if" &&
			["then", "else"].includes(error.params.failingKeyword as string)
		)
			return [
				{
					index,
					error,
					prefix: `${error.schemaPath.slice(0, -3)}/${error.params.failingKeyword}`,
					alternative: false,
				},
			]
		return []
	})
	return diagnostics.map((diagnostic, index) => {
		const error = errors[index]!
		const candidates = summaries.filter(
			(parent) =>
				parent.index > index &&
				(error.instancePath === parent.error.instancePath ||
					error.instancePath.startsWith(`${parent.error.instancePath}/`)) &&
				(parent.error.propertyName === undefined ||
					error.propertyName === parent.error.propertyName) &&
				(parent.alternative
					? error.schemaPath.startsWith(parent.prefix)
					: error.schemaPath === parent.prefix ||
						error.schemaPath.startsWith(`${parent.prefix}/`)),
		)
		const parent = candidates.toSorted(
			(a, b) => b.prefix.length - a.prefix.length || a.index - b.index,
		)[0]
		if (!parent) return diagnostic
		const branch = parent.alternative
			? error.schemaPath.slice(parent.prefix.length).split("/")[0]!
			: (parent.error.params.failingKeyword as string)
		if (parent.alternative && !/^\d+$/.test(branch)) return diagnostic
		return {
			...diagnostic,
			context: {
				parent: parent.index,
				label: parent.alternative
					? `Alternative ${Number(branch) + 1}`
					: branch === "then"
						? "Then branch"
						: "Else branch",
			},
		}
	})
}

export function diagnosticViews(
	diagnostics: readonly Diagnostic[],
): DiagnosticView[] {
	const views = diagnostics.map((diagnostic): DiagnosticView => ({
		...diagnostic,
		branches: [],
	}))
	const roots: DiagnosticView[] = []
	for (const [index, view] of views.entries()) {
		const context = view.context
		// Parents must follow their children, so malformed metadata cannot create
		// cycles or make a diagnostic disappear from the displayed report.
		const parent =
			context && Number.isInteger(context.parent) && context.parent > index
				? views[context.parent]
				: undefined
		if (!parent) {
			roots.push(view)
			continue
		}
		let branch = parent.branches.find(
			(branch) => branch.label === context!.label,
		)
		if (!branch) {
			branch = { label: context!.label, diagnostics: [] }
			parent.branches.push(branch)
		}
		branch.diagnostics.push(view)
	}
	return roots
}

export function diagnosticDetails(
	view: DiagnosticView,
): { label: string; diagnostic: DiagnosticView }[] {
	return view.branches.flatMap((branch) =>
		branch.diagnostics.flatMap((child) => [
			{ label: branch.label, diagnostic: child },
			...diagnosticDetails(child).map((detail) => ({
				...detail,
				label: `${branch.label} / ${detail.label}`,
			})),
		]),
	)
}
