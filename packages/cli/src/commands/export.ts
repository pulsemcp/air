import { Command } from "commander";
import { exportMarketplace } from "@pulsemcp/air-sdk";

export function exportCommand(): Command {
  const cmd = new Command("export")
    .description(
      "Export AIR plugins as a distributable marketplace directory for a target format (e.g., Claude Co-work)"
    )
    .argument(
      "<emitter>",
      "Target emitter format (e.g., cowork)"
    )
    .requiredOption(
      "--output <dir>",
      "Output directory for the marketplace"
    )
    .option(
      "--config <path>",
      "Path to air.json (defaults to AIR_CONFIG env or ~/.air/air.json)"
    )
    .option(
      "--plugins <ids>",
      "Comma-separated plugin IDs to export (defaults to all plugins)"
    )
    .option(
      "--marketplace-name <name>",
      "Override the marketplace display name in the index file"
    )
    .option(
      "--marketplace-description <description>",
      "Override the marketplace description in the index file"
    )
    .action(
      async (
        emitter: string,
        options: {
          output: string;
          config?: string;
          plugins?: string;
          marketplaceName?: string;
          marketplaceDescription?: string;
        }
      ) => {
        try {
          const result = await exportMarketplace({
            config: options.config,
            emitter,
            output: options.output,
            plugins: options.plugins
              ? options.plugins.split(",").map((s) => s.trim())
              : undefined,
            marketplaceName: options.marketplaceName,
            marketplaceDescription: options.marketplaceDescription,
          });

          const { marketplace } = result;
          console.log(JSON.stringify(marketplace, null, 2));
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
