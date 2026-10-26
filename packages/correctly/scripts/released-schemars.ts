import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseAllDocuments } from "yaml"

export const packageName = "@correctlyjs/schemars"
export const dependencyName = "schemars-released"
export const publicDirectory = "packages/correctly/tests/public/"
export type PackagePin = { version: string; integrity: string }
export type Baseline = { ref: string; commit: string }
export type ReplayPlan = {
	root: string
	files: string[]
	patches: { file: string; original: string; replacement: string }[]
}

const legacy = JSON.parse(
	readFileSync(new URL("./legacy-schemars.json", import.meta.url), "utf8"),
) as Record<string, PackagePin & { commit: string }>

/** New releases record the registry dependency in their manifest and lockfile. */
export function dependencyPin(
	baseline: Baseline,
	manifest: { devDependencies?: Record<string, string> },
	lockfile: string,
): PackagePin {
	const specifier = manifest.devDependencies?.[dependencyName]
	if (specifier === undefined) {
		const pin = legacy[baseline.ref]
		if (!pin || pin.commit !== baseline.commit)
			throw new Error(
				"Unrecognized legacy Correctly baseline; review its Schemars dependency explicitly.",
			)
		return { version: pin.version, integrity: pin.integrity }
	}
	const prefix = `npm:${packageName}@`
	const version = specifier.slice(prefix.length)
	if (!specifier.startsWith(prefix) || !/^\d+\.\d+\.\d+$/.test(version))
		throw new Error(
			"Correctly contracts require an exact published Schemars version.",
		)
	type RegistryLock = {
		importers?: Record<
			string,
			{
				devDependencies?: Record<string, { specifier: string; version: string }>
			}
		>
		packages?: Record<string, { resolution?: { integrity?: string } }>
	}
	// pnpm 12 puts package-manager dependencies and workspace dependencies in
	// separate YAML documents. Select the workspace importer unambiguously.
	const locks = parseAllDocuments(lockfile)
		.map((document) => {
			if (document.errors.length) throw document.errors[0]
			return document.toJS() as RegistryLock | null
		})
		.filter((lock) => lock?.importers?.["packages/correctly"])
	if (locks.length !== 1)
		throw new Error(
			"The historical lockfile must contain exactly one Correctly importer.",
		)
	const lock = locks[0]!
	const dependency =
		lock.importers?.["packages/correctly"]?.devDependencies?.[dependencyName]
	const integrity =
		lock.packages?.[`${packageName}@${version}`]?.resolution?.integrity
	if (
		dependency?.specifier !== specifier ||
		dependency.version.split("(")[0] !== `${packageName}@${version}` ||
		!integrity?.startsWith("sha512-")
	)
		throw new Error(
			"The historical lockfile must pin Schemars to a registry artifact with integrity.",
		)
	return { version, integrity }
}

/** These released extensions have no runtime dependencies; their peer is types-only. */
export function installReleasedSchemars(
	directory: string,
	pin: PackagePin,
): string {
	const manifest = {
		name: "correctly-released-extension",
		private: true,
		type: "module",
		dependencies: { [packageName]: pin.version },
	}
	writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest))
	writeFileSync(
		path.join(directory, "package-lock.json"),
		JSON.stringify({
			name: manifest.name,
			lockfileVersion: 3,
			requires: true,
			packages: {
				"": manifest,
				[`node_modules/${packageName}`]: {
					version: pin.version,
					resolved: `https://registry.npmjs.org/${packageName}/-/schemars-${pin.version}.tgz`,
					integrity: pin.integrity,
				},
			},
		}),
	)
	execFileSync(
		"npm",
		["ci", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund"],
		{ cwd: directory, stdio: "inherit" },
	)
	const installed = JSON.parse(
		readFileSync(
			path.join(directory, "node_modules", packageName, "package.json"),
			"utf8",
		),
	) as {
		name: string
		version: string
		dependencies?: Record<string, string>
		optionalDependencies?: Record<string, string>
	}
	if (
		installed.name !== packageName ||
		installed.version !== pin.version ||
		Object.keys(installed.dependencies ?? {}).length ||
		Object.keys(installed.optionalDependencies ?? {}).length
	)
		throw new Error(
			"The released Schemars package needs a reviewed dependency environment; replay cannot use this leaf-package installer.",
		)
	const resolver = path.join(directory, "resolve.ts")
	writeFileSync(
		resolver,
		`process.stdout.write(import.meta.resolve("${packageName}/ajv"))`,
	)
	return fileURLToPath(
		execFileSync(process.execPath, [resolver], {
			cwd: directory,
			encoding: "utf8",
		}),
	)
}

/** Rewrite dependency wiring only. Every historical assertion stays intact. */
export function rebindSchemars(
	file: string,
	original: string,
	entry: string,
): string {
	const specifier = file.endsWith("extensions.test.ts")
		? /^import \{ schemars \} from "(?:\.\.\/\.\.\/\.\.\/schemars\/src\/ajv\.ts|schemars-released\/ajv)"/gm
		: /(?:new URL\(\s*built \? "\.\.\/\.\.\/\.\.\/schemars\/dist\/ajv\.mjs" : "\.\.\/\.\.\/\.\.\/schemars\/src\/ajv\.ts",\s*import\.meta\.url,\s*\)\.href|import\.meta\.resolve\("schemars-released\/ajv"\))/g
	const matches = [...original.matchAll(specifier)]
	if (matches.length !== 1)
		throw new Error(
			`Unrecognized Schemars loading in ${file}; historical assertions were not changed.`,
		)
	return original.replace(specifier, () =>
		file.endsWith("extensions.test.ts")
			? `import { schemars } from ${JSON.stringify(entry)}`
			: JSON.stringify(pathToFileURL(entry).href),
	)
}
