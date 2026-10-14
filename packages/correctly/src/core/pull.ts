import { randomUUID } from "node:crypto"
import {
	mkdir,
	mkdtemp,
	open,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import type { SchemaObject } from "ajv"
import { schemaUri, type Project } from "./config.ts"
import { Engine } from "./engine.ts"
import {
	SchemaStore,
	type SchemaResource,
	type StoreOptions,
} from "./schemas.ts"
import { schemaChildren } from "./schema-walk.ts"
import {
	readSchemaLock,
	readLockedSchema,
	SCHEMA_LOCK,
	PREVIOUS_SCHEMA_LOCK,
	LEGACY_SCHEMA_LOCK,
	schemaDigest,
	vendoredSchemaPath,
	type SchemaLock,
} from "./schema-lock.ts"
import { CorrectlyError } from "./types.ts"

async function packageVersion(project: Project, name: string): Promise<string> {
	const require = createRequire(project.configPath)
	for (const directory of require.resolve.paths(name) ?? []) {
		try {
			const manifest: unknown = JSON.parse(
				await readFile(path.join(directory, name, "package.json"), "utf8"),
			)
			if (
				typeof manifest !== "object" ||
				manifest === null ||
				!("version" in manifest) ||
				typeof manifest.version !== "string" ||
				!manifest.version
			)
				throw new Error("Package manifest has no version")
			return manifest.version
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
			throw new CorrectlyError(
				"schema-packages",
				`Cannot read installed version of ${name}: ${String(error)}`,
			)
		}
	}
	throw new CorrectlyError(
		"schema-packages",
		`Package ${name} is not installed from ${project.root}; install dependencies before pulling schemas`,
	)
}

export type PullOptions = Pick<StoreOptions, "fetch" | "signal"> & {
	/** Exact association names to refresh. Omit to refresh the complete snapshot. */
	associations?: string[]
}

async function walkGraph(
	store: SchemaStore,
	root: SchemaResource,
	onResource: (resource: SchemaResource) => void,
): Promise<void> {
	const visited = new Set<SchemaResource["schema"]>()
	async function resource(current: SchemaResource): Promise<void> {
		onResource(current)
		if (visited.has(current.schema)) return
		visited.add(current.schema)
		await walk(current.schema, current.uri, current)
	}
	async function walk(
		value: unknown,
		base: string,
		current: SchemaResource,
	): Promise<void> {
		if (typeof value !== "object" || value === null || Array.isArray(value))
			return
		const schema = value as SchemaObject
		const scope = typeof schema.$id === "string" ? schema.$id : base
		for (const keyword of ["$ref", "$dynamicRef"]) {
			const ref: unknown = schema[keyword]
			if (ref === undefined) continue
			if (typeof ref !== "string")
				throw new CorrectlyError(
					"schema",
					`${keyword} must be a string: ${base}`,
				)
			const url = new URL(ref, scope)
			const known = store.resources.get(url.href)
			url.hash = ""
			await resource(known ?? (await store.load(url.href, current.dialect)))
		}
		for (const [, child] of schemaChildren(schema))
			await walk(child, scope, current)
	}
	await resource(root)
}

/** Download and prepare selected schema graphs before publishing a merged snapshot. */
export async function pullSchemas(
	project: Project,
	options: PullOptions = {},
): Promise<SchemaLock> {
	if (project.config.remote?.offline)
		throw new CorrectlyError(
			"schema-load",
			"Schema pull requires online mode; remote.offline is enabled",
		)
	const names = options.associations
	if (names !== undefined) {
		if (!names.length)
			throw new CorrectlyError("config", "Select at least one association")
		for (const name of names)
			if (!project.config.associations.some((rule) => rule.name === name))
				throw new CorrectlyError(
					"config",
					`Unknown schema association: ${name}`,
				)
	}
	const selected = project.config.associations.filter(
		(rule) =>
			names === undefined ||
			(rule.name !== undefined && names.includes(rule.name)),
	)
	const previous = await readSchemaLock(project.root)
	if (names !== undefined && !previous)
		throw new CorrectlyError(
			"schema-lock",
			"Selective pulls require an existing snapshot; run correctly schemas pull --all first",
		)
	const texts = new Map<string, string>()
	const refreshed = new Set<string>()
	const store = new SchemaStore(project, {
		...options,
		pull: true,
		onRemote: (uri, text) => {
			texts.set(uri, text)
			refreshed.add(uri)
		},
	})
	if (names !== undefined && previous) {
		// Preserve exact bytes and observations, including resources no longer referenced.
		for (const uri of Object.keys(previous.schemas))
			texts.set(uri, await readLockedSchema(project.root, uri, previous))
		const pinned = new SchemaStore(project, {
			...(options.signal ? { signal: options.signal } : {}),
			offline: true,
		})
		const roots = new Map<
			Project["config"]["associations"][number],
			SchemaResource
		>()
		// Register existing roots before walking, including cross-association identifiers.
		for (const rule of project.config.associations) {
			if (!rule.validate?.schema) continue
			const uri = new URL(schemaUri(rule.validate.schema, project.root))
			uri.hash = ""
			if (
				selected.includes(rule) &&
				uri.protocol !== "file:" &&
				!previous.schemas[uri.href]
			)
				continue
			roots.set(rule, await pinned.load(uri.href))
		}
		const preserved = new Set<string>()
		for (const [rule, root] of roots) {
			if (selected.includes(rule)) continue
			await walkGraph(pinned, root, (resource) => preserved.add(resource.uri))
		}
		// Shared resources remain pinned until every owning association is selected.
		for (const [uri, resource] of pinned.resources)
			if (resource.uri.startsWith("file:") || preserved.has(resource.uri))
				store.resources.set(uri, resource)
	}
	const roots: {
		resource: SchemaResource
		packages: Record<string, string>
	}[] = []
	// Register all roots first, so references to another association's $id remain local.
	for (const rule of selected) {
		if (!rule.validate?.schema) continue
		const packages: Record<string, string> = {}
		for (const name of [...new Set(rule.packages ?? [])].sort())
			packages[name] = await packageVersion(project, name)
		roots.push({
			resource: await store.load(schemaUri(rule.validate.schema, project.root)),
			packages,
		})
	}
	const provenance = new Map<string, Record<string, string>>()
	for (const root of roots) {
		await walkGraph(store, root.resource, (current) => {
			if (refreshed.has(current.uri)) {
				const packages = provenance.get(current.uri) ?? {}
				Object.assign(packages, root.packages)
				provenance.set(current.uri, packages)
			}
		})
	}
	const engine = new Engine(
		{ ...project, config: { ...project.config, associations: selected } },
		options,
	)
	// The Ajv adapter's versioned, project-local service uses the captured graph.
	engine.context.services.set(Symbol.for("correctly/ajv/schema-store@1"), store)
	try {
		await engine.prepare()
	} finally {
		await engine.dispose()
	}
	const lock: SchemaLock = {
		lockVersion: 2,
		schemas: names === undefined ? {} : { ...previous!.schemas },
	}
	const discoveredAt = new Date().toISOString()
	for (const [uri, text] of [...texts].sort(([a], [b]) => a.localeCompare(b))) {
		if (!refreshed.has(uri)) continue
		const digest = schemaDigest(text)
		const packages = Object.fromEntries(
			Object.entries(provenance.get(uri) ?? {}).sort(([a], [b]) =>
				a.localeCompare(b),
			),
		)
		const old = previous?.schemas[uri]
		lock.schemas[uri] =
			old?.digest === digest &&
			JSON.stringify(old.packages) === JSON.stringify(packages)
				? old
				: { digest, discoveredAt, packages }
	}
	lock.schemas = Object.fromEntries(
		Object.entries(lock.schemas).sort(([a], [b]) => a.localeCompare(b)),
	)
	options.signal?.throwIfAborted()
	await publishSnapshot(project.root, texts, lock, previous, options.signal)
	return lock
}

async function publishSnapshot(
	root: string,
	texts: Map<string, string>,
	lock: SchemaLock,
	expected: SchemaLock | undefined,
	signal?: AbortSignal,
): Promise<void> {
	const directory = path.join(root, ".correctly")
	const files = new Map<string, { uri: string; text: string }>()
	for (const [uri, text] of texts) {
		const filename = path.basename(vendoredSchemaPath(root, uri))
		const previous = files.get(filename)
		if (previous && previous.text !== text)
			throw new CorrectlyError(
				"schema-lock",
				`Schemas ${previous.uri} and ${uri} map to ${filename} with different contents; choose one retrieval URL`,
			)
		files.set(filename, { uri, text })
	}
	await mkdir(directory, { recursive: true })
	const guardPath = path.join(directory, "pull.lock")
	const guard = await open(guardPath, "wx").catch((error: unknown) => {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new CorrectlyError(
				"schema-lock",
				`Another schema pull is publishing a snapshot: ${guardPath}`,
			)
		throw error
	})
	let stage: string | undefined
	const schemas = path.join(directory, "schemas")
	let movedPrevious = false,
		installed = false,
		committed = false
	try {
		if (JSON.stringify(await readSchemaLock(root)) !== JSON.stringify(expected))
			throw new CorrectlyError(
				"schema-lock",
				"Schema snapshot changed during pull; retry against the current lock",
			)
		stage = await mkdtemp(path.join(directory, ".pull-"))
		const incoming = path.join(stage, "schemas")
		const previous = path.join(stage, "previous")
		await mkdir(incoming)
		for (const [filename, { text }] of files)
			await writeFile(path.join(incoming, filename), text)
		signal?.throwIfAborted()
		try {
			await rename(schemas, previous)
			movedPrevious = true
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		}
		await rename(incoming, schemas)
		installed = true
		signal?.throwIfAborted()
		await atomicWrite(
			path.join(root, SCHEMA_LOCK),
			`${JSON.stringify(lock, null, 2)}\n`,
		)
		committed = true
		// Cleanup must not roll back a snapshot after its new lock has been published.
		for (const name of [PREVIOUS_SCHEMA_LOCK, LEGACY_SCHEMA_LOCK])
			await rm(path.join(root, name), { force: true }).catch(() => {})
	} catch (error) {
		if (installed) await rm(schemas, { recursive: true, force: true })
		if (movedPrevious && stage) {
			await rename(path.join(stage, "previous"), schemas)
			movedPrevious = false
		}
		throw error
	} finally {
		// Keep the backup available for recovery if the filesystem prevents rollback.
		try {
			if (stage && (committed || !movedPrevious))
				await rm(stage, { recursive: true, force: true })
		} finally {
			await guard.close()
			await rm(guardPath, { force: true })
		}
	}
}

async function atomicWrite(file: string, text: string): Promise<void> {
	const temporary = `${file}.${randomUUID()}.tmp`
	try {
		await writeFile(temporary, text)
		await rename(temporary, file)
	} finally {
		await rm(temporary, { force: true })
	}
}
