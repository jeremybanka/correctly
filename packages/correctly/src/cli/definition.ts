import {
	cli,
	helpOption,
	options,
	optional,
	parseBooleanOption,
	parseStringOption,
	type CommandLineInterface,
	type CompletionTargetFormat,
	type OptionsGroup,
} from "comline"
import { z } from "zod/v4"

const reportFormats = ["readable", "json"] as const
const completionTargets = [
	"bash",
	"zsh",
	"fish",
	"nushell",
	"carapace",
] as const satisfies readonly CompletionTargetFormat[]

const checkOptionsSchema = z.strictObject({
	config: z.string().min(1).optional(),
	offline: z.boolean().optional(),
	format: z.enum(reportFormats).default("readable"),
	help: z.boolean().optional(),
})
type CheckOptions = z.infer<typeof checkOptionsSchema>

const checkOptions = options<CheckOptions>(
	"Validate discovered files or the supplied files.",
	checkOptionsSchema,
	{
		config: {
			flag: "c",
			example: "--config path",
			description:
				"Use a TypeScript configuration file (default: correctly.config.ts).",
			parse: parseStringOption,
			required: false,
			completion: { fileSystem: "files", repeatable: false },
		},
		offline: {
			example: "--offline",
			description: "Use cached schemas without network access.",
			parse: parseBooleanOption,
			required: false,
			completion: { repeatable: false },
		},
		format: {
			example: "--format readable|json",
			description: "Choose the report format (default: readable).",
			required: false,
			completion: { repeatable: false },
		},
		...helpOption().optionConfigs,
	},
)

const routes = optional({
	check: optional({ "$...files": null }),
	schemas: optional({ pull: null }),
	completion: optional({
		$target: null,
		install: optional({ $target: null }),
	}),
})
type Definition = Pick<
	CommandLineInterface<typeof routes>,
	"cliName" | "cliDescription" | "positionalCompletions"
> & {
	routes: typeof routes
	routeOptions: {
		"": OptionsGroup<CheckOptions>
		check: OptionsGroup<CheckOptions>
		"check/$...files": OptionsGroup<CheckOptions>
		schemas: OptionsGroup<CheckOptions>
		"schemas/pull": OptionsGroup<CheckOptions>
		completion: ReturnType<typeof helpOption>
		"completion/$target": ReturnType<typeof helpOption>
		"completion/install": ReturnType<typeof helpOption>
		"completion/install/$target": ReturnType<typeof helpOption>
	}
}

const definition: Definition = {
	cliName: "correctly",
	cliDescription:
		"Validate JSON, JSONC, YAML and TOML using associations in correctly.config.ts.\n" +
		"Exit 0: valid; 1: document errors; 2: configuration, schema, or execution errors.\n" +
		"Formatting does not affect validation. See the package guide for configuration.\n" +
		"Editor assistance: correctly-lsp --stdio",
	routes,
	routeOptions: {
		"": { ...checkOptions, description: "Show help." },
		check: checkOptions,
		"check/$...files": checkOptions,
		schemas: { ...checkOptions, description: "Manage vendored schemas." },
		"schemas/pull": {
			...checkOptions,
			description:
				"Vendor configured schemas and their references (requires online mode).",
		},
		completion: helpOption("Print a completion setup artifact."),
		"completion/$target": helpOption("Print a completion setup artifact."),
		"completion/install": helpOption(
			"Install completions for a shell or Carapace.",
		),
		"completion/install/$target": helpOption(
			"Install completions for a shell or Carapace.",
		),
	},
	positionalCompletions: {
		"check/$...files": { fileSystem: "files" },
		"completion/$target": { choices: completionTargets },
		"completion/install/$target": { choices: completionTargets },
	},
}

export const correctlyCli: ReturnType<typeof cli<Definition, typeof routes>> =
	cli<Definition, typeof routes>(definition)
