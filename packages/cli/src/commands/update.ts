import { Command } from "commander";
import { updateProviderCaches } from "@pulsemcp/air-sdk";

export function updateCommand(): Command {
  const cmd = new Command("update")
    .description(
      "Refresh cached provider data (e.g., GitHub repository clones)"
    )
    .option(
      "--config <path>",
      "Path to air.json (defaults to AIR_CONFIG env or ~/.air/air.json)"
    )
    .action(async (options: { config?: string }) => {
      try {
        const { results } = await updateProviderCaches({
          config: options.config,
        });

        const schemes = Object.keys(results);
        if (schemes.length === 0) {
          console.log("No providers with cached data found.");
          return;
        }

        for (const scheme of schemes) {
          const entries = results[scheme];
          if (entries.length === 0) {
            console.log(`${scheme}:// — no cached entries`);
            continue;
          }

          for (const entry of entries) {
            const icon = entry.updated ? "\u2713" : "\u00b7";
            console.log(`  ${icon} ${entry.label} — ${entry.message}`);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  return cmd;
}
