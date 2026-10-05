import { readFileSync } from "node:fs"
import path from "node:path"
import ignore, { type Ignore } from "ignore"
import { CorrectlyError } from "./types.ts"

/** Lazily reads ignore files along a document's path, within the project root. */
export class GitIgnore {
	private readonly rules = new Map<string, Ignore>()
	private readonly root: string
	constructor(root: string) {
		this.root = root
	}
	private inDirectory(directory: string, parent?: Ignore): Ignore {
		let rules = this.rules.get(directory)
		if (!rules) {
			rules = ignore({ ignorecase: false })
			if (parent) rules.add(parent)
			const file = path.join(directory, ".gitignore")
			try {
				const text = readFileSync(file, "utf8")
				const base = path
					.relative(this.root, directory)
					.split(path.sep)
					.join("/")
				rules.add(base ? scopedPatterns(base, text) : text)
			} catch (error) {
				if (
					!["ENOENT", "ENOTDIR"].includes(
						(error as NodeJS.ErrnoException).code ?? "",
					)
				)
					throw new CorrectlyError(
						"config",
						`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
					)
			}
			this.rules.set(directory, rules)
		}
		return rules
	}
	ignores(relative: string): boolean {
		const parts = relative.split("/")
		let rules: Ignore | undefined
		for (let depth = 0; depth < parts.length; depth++) {
			rules = this.inDirectory(
				path.join(this.root, ...parts.slice(0, depth)),
				rules,
			)
			const target =
				parts.slice(0, depth + 1).join("/") +
				(depth < parts.length - 1 ? "/" : "")
			// Git cannot re-include a file beneath an excluded directory.
			if (rules.ignores(target)) return true
		}
		return false
	}
}

/** Rebase nested rules so one matcher can apply precedence to ancestor paths too. */
function scopedPatterns(base: string, text: string): string[] {
	const prefix = base.replace(/[\\!*?[\]#]/g, "\\$&")
	return text.split(/\r?\n/).flatMap((line) => {
		if (!line || line.startsWith("#")) return []
		const negative = line.startsWith("!")
		const pattern = negative ? line.slice(1) : line
		if (!pattern.trim() || pattern === "/") return []
		const anchored =
			pattern.startsWith("/") ||
			pattern.replace(/ +$/, "").replace(/\/$/, "").includes("/")
		return [
			`${negative ? "!" : ""}/${prefix}/${anchored ? "" : "**/"}${pattern.replace(/^\//, "")}`,
		]
	})
}
