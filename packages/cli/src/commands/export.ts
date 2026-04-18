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
      "--plugin <id...>",
      "Plugin ID to export (repeatable: --plugin a --plugin b, or variadic: --plugin a b). Defaults to all plugins when omitted."
    )
    .option(
      "--marketplace-name <name>",
      "Override the marketplace display name in the index file"
    )
    .option(
      "--marketplace-description <description>",
      "Override the marketplace description in the index file"
    )
    .option(
      "--marketplace-owner <name>",
      "Marketplace owner name (required by Claude Co-work)"
    )
    .action(
      async (
        emitter: string,
        options: {
          output: string;
          config?: string;
          plugin?: string[];
          marketplaceName?: string;
          marketplaceDescription?: string;
          marketplaceOwner?: string;
        }
      ) => {
        try {
          const result = await exportMarketplace({
            config: options.config,
            emitter,
            output: options.output,
            plugins: options.plugin,
            marketplaceName: options.marketplaceName,
            marketplaceDescription: options.marketplaceDescription,
            marketplaceOwner: options.marketplaceOwner
              ? { name: options.marketplaceOwner }
              : undefined,
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
