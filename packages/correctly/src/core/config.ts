import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { cli } from "comline"
import picomatch from "picomatch"
import type { Parser, Validator } from "./adapters.ts"
import { defaultParser } from "./parsers.ts"
import { GitIgnore } from "./gitignore.ts"
import { CorrectlyError, type Association } from "./types.ts"

export const CONFIG_NAME = "correctly.config.ts"
/** Opt into project-local .gitignore rules in the exclude array. */
export const GITIGNORE = Symbol.for("correctly.gitignore.v1")
export const DEFAULT_EXCLUDES = [
	"**/node_modules/**",
	"**/.git/**",
	"**/dist/**",
	"**/artifacts/**",
	"**/.correctly-cache/**",
]
export type RemoteOptions = {
	offline?: boolean
	cacheDir?: string
	timeoutMs?: number
	maxBytes?: number
	maxRequests?: number
}
export type ProjectConfig = {
	files?: string[]
	exclude?: (string | typeof GITIGNORE)[]
	associations: {
		name?: string
		files: string[]
		parse?: Parser
		validate: Validator | null
	}[]
	remote?: RemoteOptions
}
export type Project = {
	configPath: string
	root: string
	config: ProjectConfig
}
export type ReadText = (uri: string) => Promise<string>
export const readText: ReadText = (uri) => readFile(fileURLToPath(uri), "utf8")

function object(
	value: unknown,
	location: string,
	keys?: string[],
): asserts value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new CorrectlyError("config", `${location} must be an object`)
	if (keys)
		for (const key of Object.keys(value))
			if (!keys.includes(key))
				throw new CorrectlyError("config", `Unknown option ${location}.${key}`)
}
function string(value: unknown, location: string): asserts value is string {
	if (typeof value !== "string" || !value.length)
		throw new CorrectlyError("config", `${location} must be a nonempty string`)
}
function patterns(value: unknown, location: string, gitignore = false): void {
	if (!Array.isArray(value) || !value.length)
		throw new CorrectlyError(
			"config",
			`${location} must be a nonempty array of relative patterns`,
		)
	for (const item of value) {
		if (gitignore && item === GITIGNORE) continue
		string(item, location)
		if (/^(?:[!/]|[A-Za-z]:)|(?:^|\/)\.\.(?:\/|$)|\\/.test(item))
			throw new CorrectlyError(
				"config",
				`${location}: use relative forward-slash patterns without '..' or leading '!': ${item}`,
			)
	}
}
export function defineConfig<T extends ProjectConfig>(config: T): T {
	validateConfig(config)
	return config
}
export function validateConfig(value: unknown): ProjectConfig {
	object(value, "config", ["files", "exclude", "associations", "remote"])
	for (const key of ["files", "exclude"])
		if (value[key] !== undefined) patterns(value[key], key, key === "exclude")
	if (!Array.isArray(value.associations))
		throw new CorrectlyError("config", "associations must be an array")
	for (const [index, rule] of value.associations.entries()) {
		const at = `associations[${index}]`
		object(rule, at, ["name", "files", "parse", "validate"])
		patterns(rule.files, `${at}.files`)
		if (rule.name !== undefined) string(rule.name, `${at}.name`)
		if (rule.parse !== undefined) {
			object(rule.parse, `${at}.parse`)
			string(rule.parse.id, `${at}.parse.id`)
			string(rule.parse.valueModel, `${at}.parse.valueModel`)
			if (typeof rule.parse.parse !== "function")
				throw new CorrectlyError(
					"config",
					`${at}.parse must be a parser adapter`,
				)
			if (
				rule.parse.editorLanguage !== undefined &&
				rule.parse.editorLanguage !== "json" &&
				rule.parse.editorLanguage !== "jsonc"
			)
				throw new CorrectlyError(
					"config",
					`${at}.parse.editorLanguage must be json or jsonc`,
				)
		}
		if (rule.validate !== null) {
			object(rule.validate, `${at}.validate`)
			string(rule.validate.id, `${at}.validate.id`)
			if (
				typeof rule.validate.prepare !== "function" ||
				!Array.isArray(rule.validate.accepts) ||
				!rule.validate.accepts.length ||
				rule.validate.accepts.some((v: unknown) => typeof v !== "string" || !v)
			)
				throw new CorrectlyError(
					"config",
					`${at}.validate must be a validator adapter with accepted value models`,
				)
			if (
				rule.validate.register !== undefined &&
				typeof rule.validate.register !== "function"
			)
				throw new CorrectlyError(
					"config",
					`${at}.validate.register must be a function`,
				)
			if (rule.validate.extensions !== undefined) {
				if (!Array.isArray(rule.validate.extensions))
					throw new CorrectlyError(
						"config",
						`${at}.validate.extensions must be an array`,
					)
				for (const extension of rule.validate.extensions) {
					object(extension, `${at}.validate.extensions[]`)
					string(extension.id, `${at}.validate.extensions[].id`)
				}
			}
			if (rule.validate.schema !== undefined)
				string(rule.validate.schema, `${at}.validate.schema`)
		}
	}
	if (value.remote !== undefined) {
		object(value.remote, "remote", [
			"offline",
			"cacheDir",
			"timeoutMs",
			"maxBytes",
			"maxRequests",
		])
		if (
			value.remote.offline !== undefined &&
			typeof value.remote.offline !== "boolean"
		)
			throw new CorrectlyError("config", "remote.offline must be a boolean")
		if (value.remote.cacheDir !== undefined)
			string(value.remote.cacheDir, "remote.cacheDir")
		for (const [key, max] of [
			["timeoutMs", 60000],
			["maxBytes", 16777216],
			["maxRequests", 256],
		] as const) {
			const number = value.remote[key]
			if (
				number !== undefined &&
				(typeof number !== "number" ||
					!Number.isInteger(number) ||
					number < 1 ||
					number > max)
			)
				throw new CorrectlyError(
					"config",
					`remote.${key} must be an integer between 1 and ${max}`,
				)
		}
	}
	return value as ProjectConfig
}
export function contains(root: string, file: string): boolean {
	const relative = path.relative(root, file)
	return (
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	)
}
export async function discoverConfig(
	start: string,
	boundary?: string,
): Promise<string> {
	let directory = path.resolve(start)
	if (boundary && !contains(boundary, directory))
		throw new CorrectlyError("config", `Path is outside workspace ${boundary}`)
	while (true) {
		const candidate = path.join(directory, CONFIG_NAME)
		try {
			if ((await stat(candidate)).isFile()) return candidate
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		}
		const parent = path.dirname(directory)
		if (directory === boundary || parent === directory) break
		directory = parent
	}
	throw new CorrectlyError(
		"config",
		`No ${CONFIG_NAME} found from ${start}${boundary ? ` within ${boundary}` : ""}`,
	)
}
/** Comline owns module loading and invokes our runtime contract validation. */
export async function loadProject(configPath: string): Promise<Project> {
	const resolved = path.resolve(configPath)
	try {
		if (path.extname(resolved) !== ".ts")
			throw new Error("Correctly configuration must be a TypeScript .ts module")
		if (!(await stat(resolved)).isFile())
			throw new Error("Configuration must be a file")
		const schema = {
			"~standard": {
				version: 1 as const,
				vendor: "correctly",
				validate: (value: unknown) => ({ value: validateConfig(value) }),
				jsonSchema: {
					input: () => ({ type: "object" }),
					output: () => ({ type: "object" }),
				},
			},
		}
		const parse = cli({
			cliName: "correctly",
			discoverConfigPath: () => resolved,
			routeOptions: {
				"": {
					description: "Correctly configuration",
					optionsSchema: schema,
					optionConfigs: {},
				},
			},
		})
		const config = validateConfig(
			parse([process.execPath, "correctly"]).inputs.opts,
		)
		return { configPath: resolved, root: path.dirname(resolved), config }
	} catch (error) {
		throw new CorrectlyError(
			"config",
			`Cannot load ${resolved}: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

export function schemaUri(value: string, root: string): string {
	if (
		/^[A-Za-z][A-Za-z\d+.-]*:/.test(value) &&
		!/^[A-Za-z]:[\\/]/.test(value)
	) {
		const uri = new URL(value)
		if (!["file:", "http:", "https:"].includes(uri.protocol))
			throw new CorrectlyError(
				"schema",
				`Unsupported schema protocol: ${uri.protocol}`,
			)
		return uri.href
	}
	const hash = value.indexOf("#")
	const filename = hash === -1 ? value : value.slice(0, hash)
	const uri = pathToFileURL(path.resolve(root, filename))
	if (hash !== -1) uri.hash = value.slice(hash + 1)
	return uri.href
}

export function exclusions(project: Project): string[] {
	const cachePath = path.resolve(
		project.root,
		project.config.remote?.cacheDir ?? ".correctly-cache",
	)
	const relative = path
		.relative(project.root, cachePath)
		.split(path.sep)
		.join("/")
	return [
		...DEFAULT_EXCLUDES,
		...(project.config.exclude ?? []).filter(
			(item) => typeof item === "string",
		),
		...(relative && contains(project.root, cachePath)
			? [`${relative}/**`]
			: []),
	]
}

const gitignores = new WeakMap<Project, GitIgnore>()

export function isIncluded(project: Project, file: string): boolean {
	if (!contains(project.root, file)) return false
	const relative = path.relative(project.root, file).split(path.sep).join("/")
	const options = { dot: true }
	return (
		picomatch(
			project.config.files ?? ["**/*.json", "**/*.jsonc"],
			options,
		)(relative) &&
		!picomatch(exclusions(project), options)(relative) &&
		!isGitignored(project, relative)
	)
}

function isGitignored(project: Project, relative: string): boolean {
	if (!relative || !project.config.exclude?.includes(GITIGNORE)) return false
	let gitignore = gitignores.get(project)
	if (!gitignore) {
		gitignore = new GitIgnore(project.root)
		gitignores.set(project, gitignore)
	}
	return gitignore.ignores(relative)
}

export function associationFor(
	project: Project,
	file: string,
): Association | null {
	const relative = path.relative(project.root, file).split(path.sep).join("/")
	for (
		let index = project.config.associations.length - 1;
		index >= 0;
		index--
	) {
		const rule = project.config.associations[index]!
		if (picomatch(rule.files, { dot: true })(relative))
			return {
				index,
				name: rule.name ?? `association ${index + 1}`,
				mode: (rule.parse ?? defaultParser(file)).id,
				schema: rule.validate?.schema
					? schemaUri(rule.validate.schema, project.root)
					: null,
				validator: rule.validate?.id ?? null,
				...(rule.validate?.extensions
					? {
							extensions: rule.validate.extensions.map(
								(extension) => extension.id,
							),
						}
					: {}),
			}
	}
	return null
}
export function modeFor(file: string): string {
	return defaultParser(file).id
}
