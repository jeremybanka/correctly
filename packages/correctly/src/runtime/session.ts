import { Worker } from "node:worker_threads"
import type { TextDocument } from "vscode-languageserver-textdocument"
import type { CompletionList, Hover } from "vscode-json-languageservice"
import {
	CorrectlyError,
	type Failure,
	type FileResult,
	type Position,
	type Report,
} from "../core/types.ts"

export type SessionOptions = {
	offline?: boolean
	buffers?: [string, string][]
	onDependency?: (uri: string, kind: "module" | "resource") => void
}
export type CheckResult = { report: Report; sources: [string, string][] }
/** Functions stay in this worker, which is replaced to invalidate native module caches. */
export class ProjectSession {
	private readonly worker: Worker
	private readonly pending = new Map<
		number,
		{ resolve(value: unknown): void; reject(error: Error): void }
	>()
	private next = 0
	private closed = false
	private disposal: Promise<void> | undefined
	readonly ready: Promise<void>
	constructor(configPath: string, options: SessionOptions = {}) {
		const source = import.meta.url.endsWith(".ts")
		this.worker = new Worker(
			new URL(source ? "./worker.ts" : "./worker.mjs", import.meta.url),
			{ stdout: true, stderr: true },
		)
		this.worker.stdout?.on("data", (chunk: Buffer) =>
			process.stderr.write(chunk),
		)
		this.worker.stderr?.on("data", (chunk: Buffer) =>
			process.stderr.write(chunk),
		)
		this.worker.on(
			"message",
			(message: {
				id?: number
				value?: unknown
				error?: Failure
				dependency?: { uri: string; kind: "module" | "resource" }
			}) => {
				if (message.dependency) {
					options.onDependency?.(
						message.dependency.uri,
						message.dependency.kind,
					)
					return
				}
				const pending = this.pending.get(message.id!)
				if (!pending) return
				this.pending.delete(message.id!)
				if (message.error)
					pending.reject(
						new CorrectlyError(
							message.error.code,
							message.error.message,
							message.error.details,
						),
					)
				else pending.resolve(message.value)
				if (!this.pending.size) this.worker.unref()
			},
		)
		this.worker.on("error", (error) =>
			this.fail(
				new CorrectlyError(
					"config",
					`Project worker failed: ${error instanceof Error ? error.message : String(error)}`,
				),
			),
		)
		this.worker.on("exit", (code) =>
			this.fail(
				new CorrectlyError("config", `Project worker exited (${code})`),
			),
		)
		this.ready = this.request<void>("init", {
			configPath,
			offline: options.offline,
			buffers: options.buffers ?? [],
		})
		// Avoid an unhandled rejection if a project is invalidated before its consumer awaits it.
		void this.ready.catch(() => {})
	}
	private fail(error: Error) {
		this.closed = true
		for (const pending of this.pending.values()) pending.reject(error)
		this.pending.clear()
	}
	private request<T>(method: string, params: unknown): Promise<T> {
		if (this.closed)
			return Promise.reject(
				new CorrectlyError("execution", "Project worker has been closed"),
			)
		const id = this.next++
		this.worker.ref()
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: (value) => resolve(value as T), reject })
			this.worker.postMessage({ id, method, params })
		})
	}
	async validate(file: string, text: string): Promise<FileResult> {
		await this.ready
		return this.request("validate", { file, text })
	}
	async complete(
		document: TextDocument,
		position: Position,
	): Promise<CompletionList | null> {
		await this.ready
		return this.request("complete", {
			uri: document.uri,
			text: document.getText(),
			language: document.languageId,
			version: document.version,
			position,
		})
	}
	async hover(
		document: TextDocument,
		position: Position,
	): Promise<Hover | null> {
		await this.ready
		return this.request("hover", {
			uri: document.uri,
			text: document.getText(),
			language: document.languageId,
			version: document.version,
			position,
		})
	}
	async check(params: {
		cwd: string
		files?: string[]
		sources: boolean
	}): Promise<CheckResult> {
		await this.ready
		return this.request("check", params)
	}
	dispose(): Promise<void> {
		return (this.disposal ??= (async () => {
			const finished = this.closed
				? Promise.resolve()
				: this.request("dispose", {}).catch(() => {})
			this.closed = true
			let timer: ReturnType<typeof setTimeout> | undefined
			try {
				await Promise.race([
					finished,
					new Promise<void>((resolve) => {
						timer = setTimeout(resolve, 250)
					}),
				])
			} finally {
				clearTimeout(timer)
				this.fail(
					new CorrectlyError(
						"execution",
						"Project configuration was invalidated",
					),
				)
				await this.worker.terminate()
			}
		})())
	}
}
