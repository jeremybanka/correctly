import { defineConfig } from "correctly"
import { ajv } from "correctly/validators/ajv"

export default defineConfig({
	files: ["project.json", "project.jsonc", "project.yaml", "project.toml"],
	associations: [
		{
			name: "Project",
			files: ["project.*"],
			validate: ajv({ schema: "project.schema.json" }),
		},
	],
})
