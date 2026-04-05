import { Command } from "commander";
import { validateFile } from "@pulsemcp/air-sdk";

export function validateCommand(): Command {
  const cmd = new Command("validate")
    .description("Validate a JSON file against its AIR schema")
    .argument("<file>", "Path to the JSON file to validate")
    .option(
      "--schema <type>",
      "Override schema detection (air, skills, references, mcp, plugins, roots, hooks)"
    )
    .action((file: string, options: { schema?: string }) => {
      try {
        const result = validateFile(file, { schema: options.schema });

        if (result.valid) {
          console.log(`\u2713 ${file} is valid (schema: ${result.schemaType})`);
          process.exit(0);
        } else {
          console.error(
            `\u2717 ${file} has validation errors (schema: ${result.schemaType}):`
          );
          for (const error of result.validation.errors) {
            console.error(`  ${error.path}: ${error.message}`);
          }
          process.exit(1);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  return cmd;
}
