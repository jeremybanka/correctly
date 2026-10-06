import { associationFor, isIncluded, readText, type Project } from "./config.ts"
import { defaultParser } from "./parsers.ts"
import { CorrectlyError, failure, type FileResult } from "./types.ts"
import type { StoreOptions } from "./schemas.ts"
import type {
	PreparedValidator,
	ValidationContext,
	Validator,
} from "./adapters.ts"

export type EngineOptions = StoreOptions & {
	onDependency?: (uri: string) => void
}
export class Engine {
	readonly project: Project
	readonly context: ValidationContext
	private readonly prepared = new Map<Validator, Promise<PreparedValidator>>()
	private registration: Promise<void> | undefined
	constructor(project: Project, options: EngineOptions = {}) {
		this.project = project
		const watch = (uri: string) => options.onDependency?.(uri)
		this.context = {
			root: project.root,
			configPath: project.configPath,
			remote: {
				...project.config.remote,
				...(options.offline === undefined ? {} : { offline: options.offline }),
			},
			read: async (uri) => {
				watch(uri)
				return (options.read ?? readText)(uri)
			},
			...(options.fetch ? { fetch: options.fetch } : {}),
			...(options.signal ? { signal: options.signal } : {}),
			watch,
			services: new Map(),
		}
	}
	private register(): Promise<void> {
		return (this.registration ??= (async () => {
			for (const rule of this.project.config.associations)
				await rule.validate?.register?.(this.context)
		})())
	}
	private validator(validator: Validator): Promise<PreparedValidator> {
		let prepared = this.prepared.get(validator)
		if (!prepared) {
			prepared = (async () => {
				await this.register()
				const result = await validator.prepare(this.context)
				if (!result || typeof result.validate !== "function")
					throw new CorrectlyError(
						"validator",
						`Validator ${validator.id} did not prepare a validate function`,
					)
				return result
			})()
			this.prepared.set(validator, prepared)
		}
		return prepared
	}
	async prepare(): Promise<void> {
		await this.register()
		for (const rule of this.project.config.associations) {
			if (rule.validate) {
				const parsers = rule.parse
					? [rule.parse]
					: rule.files.map(defaultParser)
				const incompatible = parsers.find(
					(parser) => !rule.validate!.accepts.includes(parser.valueModel),
				)
				if (incompatible)
					throw new CorrectlyError(
						"adapter-incompatible",
						`Parser ${incompatible.id} produces ${incompatible.valueModel}; validator ${rule.validate.id} accepts ${rule.validate.accepts.join(", ")}`,
					)
				await this.validator(rule.validate)
			}
		}
	}
	async editor(file: string) {
		if (!isIncluded(this.project, file)) return undefined
		const association = associationFor(this.project, file)
		if (!association) return undefined
		const rule = this.project.config.associations[association.index]!
		const parser = rule.parse ?? defaultParser(file)
		if (!rule.validate || !parser.editorLanguage) return undefined
		if (!rule.validate.accepts.includes(parser.valueModel)) return undefined
		const prepared = await this.validator(rule.validate)
		return prepared.editor
			? {
					support: prepared.editor,
					language: parser.editorLanguage,
					association: association.index,
				}
			: undefined
	}
	async validate(file: string, text: string): Promise<FileResult> {
		const association = associationFor(this.project, file)
		const rule = association
			? this.project.config.associations[association.index]
			: undefined
		const parser = rule?.parse ?? defaultParser(file)
		const result: FileResult = {
			file,
			mode: parser.id,
			association,
			coverage: "excluded",
			diagnostics: [],
			failures: [],
		}
		if (!isIncluded(this.project, file)) return result
		result.coverage = rule?.validate
			? association?.schema
				? "schema"
				: "validated"
			: "syntax-only"
		try {
			this.context.signal?.throwIfAborted()
			const parsed = await parser.parse(text, {
				file,
				...(this.context.signal ? { signal: this.context.signal } : {}),
			})
			result.diagnostics.push(...parsed.diagnostics)
			if (rule?.validate) {
				if (!rule.validate.accepts.includes(parser.valueModel))
					throw new CorrectlyError(
						"adapter-incompatible",
						`Parser ${parser.id} produces ${parser.valueModel}; validator ${rule.validate.id} accepts ${rule.validate.accepts.join(", ")}`,
					)
				const validator = await this.validator(rule.validate)
				if (!parsed.diagnostics.length)
					result.diagnostics.push(
						...(await validator.validate({
							file,
							text,
							parsed,
							...(this.context.signal ? { signal: this.context.signal } : {}),
						})),
					)
			}
		} catch (error) {
			result.failures.push(failure(error, file))
		}
		return result
	}
	async dispose(): Promise<void> {
		for (const prepared of this.prepared.values()) {
			const result = await prepared.catch(() => undefined)
			await result?.dispose?.()
		}
	}
}
