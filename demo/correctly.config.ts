import { defineConfig, json } from "correctly"
import { ajv } from "correctly/validators/ajv"

export default defineConfig({
	files: ["valid.json", "invalid.json", "missing-name.json"],
	associations: [
		{
			name: "Project",
			files: ["*.json"],
			parse: json(),
			validate: ajv({ schema: "project.schema.json" }),
		},
	],
})
