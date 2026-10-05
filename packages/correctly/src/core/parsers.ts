import type { Parser } from "./adapters.ts"
import { parseDocument } from "./parse.ts"
import { parseYaml } from "./yaml.ts"
import { parseToml } from "./toml.ts"

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
	switch (file.slice(file.lastIndexOf(".")).toLowerCase()) {
		case ".jsonc":
			return jsonc()
		case ".yaml":
		case ".yml":
			return yaml()
		case ".toml":
			return toml()
		default:
			return json()
	}
}

export function yaml(): Parser {
	return { id: "yaml", valueModel: "json", parse: parseYaml }
}

export function toml(): Parser {
	return { id: "toml", valueModel: "json", parse: parseToml }
}
