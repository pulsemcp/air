import { Command } from "commander";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  detectSchemaType,
  detectSchemaFromValue,
  isValidSchemaType,
  type SchemaType,
} from "../lib/schemas.js";
import { validateJson } from "../lib/validator.js";

export function validateCommand(): Command {
  const cmd = new Command("validate")
    .description("Validate a JSON file against its AIR schema")
    .argument("<file>", "Path to the JSON file to validate")
    .option(
      "--schema <type>",
      "Override schema detection (air, skills, references, mcp, plugins, roots, hooks)"
    )
    .action((file: string, options: { schema?: string }) => {
      const filePath = resolve(process.cwd(), file);

      // Load and parse JSON first (needed for $schema detection)
      let data: unknown;
      try {
        const content = readFileSync(filePath, "utf-8");
        data = JSON.parse(content);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        console.error(`Error: Could not read or parse "${file}": ${message}`);
        process.exit(1);
      }

      // Determine schema type: --schema flag > $schema in JSON > filename substring
      let schemaType: SchemaType | null = null;

      if (options.schema) {
        if (!isValidSchemaType(options.schema)) {
          console.error(
            `Error: Unknown schema type "${options.schema}". Valid types: air, skills, references, mcp, plugins, roots, hooks`
          );
          process.exit(1);
        }
        schemaType = options.schema;
      }

      if (!schemaType && data && typeof data === "object" && !Array.isArray(data)) {
        const schemaValue = (data as Record<string, unknown>).$schema;
        if (typeof schemaValue === "string") {
          schemaType = detectSchemaFromValue(schemaValue);
        }
      }

      if (!schemaType) {
        schemaType = detectSchemaType(file);
      }

      if (!schemaType) {
        console.error(
          `Error: Could not detect schema type for "${file}". Use --schema to specify.`
        );
        process.exit(1);
      }

      // Validate
      const result = validateJson(data, schemaType);

      if (result.valid) {
        console.log(`✓ ${file} is valid (schema: ${schemaType})`);
        process.exit(0);
      } else {
        console.error(`✗ ${file} has validation errors (schema: ${schemaType}):`);
        for (const error of result.errors) {
          console.error(`  ${error.path}: ${error.message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}
