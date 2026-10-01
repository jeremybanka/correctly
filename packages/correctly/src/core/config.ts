import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Ajv } from "ajv"
import picomatch from "picomatch"
import configSchema from "./config.schema.json" with { type: "json" }
import { parseDocument } from "./parse.ts"
import { CorrectlyError, type Association, type Mode } from "./types.ts"

export const CONFIG_NAME = "correctly.config.json"
export const DEFAULT_EXCLUDES = [
	"**/node_modules/**",
	"**/.git/**",
	"**/dist/**",
	"**/artifacts/**",
	"**/.correctly-cache/**",
]
export type ProjectConfig = {
	files?: string[]
	exclude?: string[]
	associations: {
		name?: string
		files: string[]
		schema: string | null
		mode?: Mode
	}[]
	remote?: {
		offline?: boolean
		cacheDir?: string
		timeoutMs?: number
		maxBytes?: number
		maxRequests?: number
	}
}
export type Project = {
	configPath: string
	root: string
	config: ProjectConfig
}
export type ReadText = (uri: string) => Promise<string>
export const readText: ReadText = (uri) => readFile(fileURLToPath(uri), "utf8")
const validateConfig = new Ajv({ allErrors: true, strict: true }).compile(
	configSchema,
)

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
	virtualFiles: ReadonlySet<string> = new Set(),
): Promise<string> {
	let directory = path.resolve(start)
	if (boundary && !contains(boundary, directory))
		throw new CorrectlyError("config", `Path is outside workspace ${boundary}`)
	while (true) {
		const candidate = path.join(directory, CONFIG_NAME)
		if (virtualFiles.has(candidate)) return candidate
		try {
			const info = await stat(candidate)
			if (info.isFile()) return candidate
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

export async function loadProject(
	configPath: string,
	read: ReadText = readText,
): Promise<Project> {
	const resolved = path.resolve(configPath)
	let text: string
	try {
		text = await read(pathToFileURL(resolved).href)
	} catch (error) {
		throw new CorrectlyError(
			"config",
			`Cannot read configuration ${resolved}: ${String(error)}`,
		)
	}
	const parsed = parseDocument(text, "json")
	if (parsed.diagnostics.length) {
		const d = parsed.diagnostics[0]!
		throw new CorrectlyError(
			"config",
			`${resolved}:${d.range.start.line + 1}:${d.range.start.character + 1}: ${d.message}`,
		)
	}
	if (!validateConfig(parsed.value)) {
		throw new CorrectlyError(
			"config",
			`${resolved}: ${validateConfig.errors?.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ")}`,
		)
	}
	const config = parsed.value as ProjectConfig
	for (const pattern of [
		...(config.files ?? []),
		...(config.exclude ?? []),
		...config.associations.flatMap((a) => a.files),
	]) {
		if (pattern.includes("\\"))
			throw new CorrectlyError(
				"config",
				`Use forward slashes in patterns: ${pattern}`,
			)
	}
	return { configPath: resolved, root: path.dirname(resolved), config }
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
		...(project.config.exclude ?? []),
		...(relative && contains(project.root, cachePath)
			? [`${relative}/**`]
			: []),
	]
}

export function isIncluded(project: Project, file: string): boolean {
	if (!contains(project.root, file)) return false
	const relative = path.relative(project.root, file).split(path.sep).join("/")
	const options = { dot: true }
	return (
		picomatch(
			project.config.files ?? ["**/*.json", "**/*.jsonc"],
			options,
		)(relative) && !picomatch(exclusions(project), options)(relative)
	)
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
		if (picomatch(rule.files, { dot: true })(relative)) {
			return {
				index,
				name: rule.name ?? `association ${index + 1}`,
				schema:
					rule.schema === null ? null : schemaUri(rule.schema, project.root),
				mode: rule.mode ?? modeFor(file),
			}
		}
	}
	return null
}
export function modeFor(file: string): Mode {
	return path.extname(file).toLowerCase() === ".jsonc" ? "jsonc" : "json"
}
