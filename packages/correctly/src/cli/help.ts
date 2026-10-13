import {
	help,
	helpOption,
	options,
	optional,
	parseBooleanOption,
	required,
} from "comline"

type CheckOptions = {
	config?: string
	offline?: boolean
	format?: string
	help?: boolean
}

const optionProperties = {
	config: { type: "string" },
	offline: { type: "boolean" },
	format: { enum: ["readable", "json"] },
	help: { type: "boolean" },
}
const optionsJsonSchema = () => ({
	type: "object",
	properties: optionProperties,
})
const checkOptions = options<CheckOptions>(
	"Validate discovered files or the supplied files.",
	{
		"~standard": {
			version: 1,
			vendor: "correctly",
			validate: (value: unknown) => {
				if (typeof value !== "object" || value === null || Array.isArray(value))
					return { issues: [{ message: "Expected an options object" }] }
				for (const [key, field] of Object.entries(value)) {
					if (field === undefined) continue
					const valid =
						key === "offline" || key === "help"
							? typeof field === "boolean"
							: key === "config"
								? typeof field === "string"
								: key === "format" && (field === "readable" || field === "json")
					if (!valid)
						return {
							issues: [{ message: `Invalid option: ${key}`, path: [key] }],
						}
				}
				return { value: value as CheckOptions }
			},
			jsonSchema: { input: optionsJsonSchema, output: optionsJsonSchema },
		},
	},
	{
		config: {
			flag: "c",
			example: "--config path",
			description:
				"Use a TypeScript configuration file (default: correctly.config.ts).",
			required: false,
		},
		offline: {
			example: "--offline",
			description: "Use cached schemas without network access.",
			parse: parseBooleanOption,
			required: false,
		},
		format: {
			example: "--format readable|json",
			description: "Choose the report format (default: readable).",
			required: false,
		},
		...helpOption().optionConfigs,
	},
)

export function cliHelp(): string {
	return help({
		cliName: "correctly",
		cliDescription:
			"Validate JSON, JSONC, YAML and TOML using associations in correctly.config.ts.\n" +
			"Exit 0: valid; 1: document errors; 2: configuration, schema, or execution errors.\n" +
			"Formatting does not affect validation. See the package guide for configuration.\n" +
			"Editor assistance: correctly-lsp --stdio",
		routes: required({ check: optional({ "$...files": null }) }),
		routeOptions: {
			check: checkOptions,
			"check/$...files": checkOptions,
		},
	})
}
