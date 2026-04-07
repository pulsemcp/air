import { Command } from "commander";
import { installExtensions } from "@pulsemcp/air-sdk";

export function installCommand(): Command {
  const cmd = new Command("install")
    .description(
      "Install extension packages declared in air.json that are not yet available"
    )
    .option(
      "--config <path>",
      "Path to air.json (defaults to AIR_CONFIG env or ~/.air/air.json)"
    )
    .option(
      "--prefix <dir>",
      "npm install prefix directory (defaults to the directory containing air.json)"
    )
    .action(
      async (options: {
        config?: string;
        prefix?: string;
      }) => {
        try {
          const result = await installExtensions({
            config: options.config,
            prefix: options.prefix,
          });

          if (result.installed.length > 0) {
            console.error(
              `Installed: ${result.installed.join(", ")}`
            );
          }
          if (result.alreadyInstalled.length > 0) {
            console.error(
              `Already installed: ${result.alreadyInstalled.join(", ")}`
            );
          }
          if (result.skipped.length > 0) {
            console.error(
              `Skipped (local paths): ${result.skipped.join(", ")}`
            );
          }

          // Output structured JSON to stdout for orchestrator consumption
          console.log(JSON.stringify(result, null, 2));
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown error";
          console.error(`Error: ${message}`);
          process.exit(1);
        }
      }
    );

  return cmd;
}
