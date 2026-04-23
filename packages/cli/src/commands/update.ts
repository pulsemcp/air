import { Command } from "commander";
import { updateProviderCaches } from "@pulsemcp/air-sdk";
import { parseGitProtocolFlag } from "./git-protocol.js";

export function updateCommand(): Command {
  const cmd = new Command("update")
    .description(
      "Refresh cached provider data (e.g., GitHub repository clones). " +
        "Auto-upgrades stale provider extensions when needed."
    )
    .option(
      "--config <path>",
      "Path to air.json (defaults to AIR_CONFIG env or ~/.air/air.json)"
    )
    .option(
      "--no-auto-heal",
      "Do not auto-upgrade provider extensions that are too old to refresh their cache"
    )
    .option(
      "--git-protocol <protocol>",
      "Protocol used by git-based catalog providers: \"ssh\" (default) or \"https\". Overrides the gitProtocol field in air.json."
    )
    .action(
      async (options: {
        config?: string;
        autoHeal?: boolean;
        gitProtocol?: string;
      }) => {
        const gitProtocol = parseGitProtocolFlag(options.gitProtocol);
        try {
          const { results } = await updateProviderCaches({
            config: options.config,
            autoHeal: options.autoHeal,
            gitProtocol,
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
              const icon = entry.updated ? "✓" : "·";
              console.log(`  ${icon} ${entry.label} — ${entry.message}`);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error(`Error: ${message}`);
          process.exit(1);
        }
      }
    );

  return cmd;
}
