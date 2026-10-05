# @correctlyjs/schemars

Schemars format assertions for [Correctly](https://www.npmjs.com/package/correctly), with independently reviewed compatibility eras.

Install `correctly` and `@correctlyjs/schemars` in the project. Correctly 0.1.x provides the supported validator API; Node 22.18 or later is required.

```ts
import { defineConfig } from "correctly"
import { ajv } from "correctly/validators/ajv"
import { schemars } from "@correctlyjs/schemars/ajv"

export default defineConfig({
	associations: [
		{
			files: ["turbo.json"],
			validate: ajv({
				schema: "https://turbo.build/schema.json",
				extensions: [schemars({ version: ">=0.8.15 <=0.8.22" })],
			}),
		},
	],
})
```

The `version` option selects the upstream Schemars contract. It is independent of this package's npm version. Every stable upstream release requires its own compatibility review and changeset; consecutive reviewed releases can ship together in an extension release; Correctly core has its own release cadence. The CLI and editors use the same project-installed implementation.

Seven reviewed eras cover every stable Schemars release from 0.8.15 through 1.2.2. The first era covers 0.8.15 through 0.8.22; the current era covers 1.2.1 through 1.2.2. Exact releases and closed ranges within one reviewed era are supported. Unknown versions, open ranges, and ranges crossing eras fail. Import `schemarsEras` and the `SchemarsEra`, `SchemarsVersion`, and `SchemarsVersionSelection` types from `@correctlyjs/schemars` to inspect the immutable TypeScript catalog and type reusable configuration. The factory accepts only reviewed releases and ordered ranges within one era at compile time, and checks them again at runtime. The Ajv factory lives at `@correctlyjs/schemars/ajv` and returns `AjvExtension` from `correctly/validators/ajv`.

See the [guide](docs/guide.md) for era-specific format assertions and precision limits, and the [maintainer workflow](https://github.com/jeremybanka/correctly/blob/main/packages/schemars/tests/public/fixtures/README.md) for pinned Rust generators and release review. Consumers do not need Rust.
