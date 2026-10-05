import type { Parser } from "./adapters.ts"
import { parseDocument } from "./parse.ts"

export function json(): Parser {
	return {
		id: "json",
		valueModel: "json",
		editorLanguage: "json",
		parse: (text) => parseDocument(text, "json"),
	}
}
export function jsonc(): Parser {
	return {
		id: "jsonc",
		valueModel: "json",
		editorLanguage: "jsonc",
		parse: (text) => parseDocument(text, "jsonc"),
	}
}
export function defaultParser(file: string): Parser {
	return file.toLowerCase().endsWith(".jsonc") ? jsonc() : json()
}
