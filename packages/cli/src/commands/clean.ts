import { Command } from "commander";
import { cleanSession } from "@pulsemcp/air-sdk";

export function cleanCommand(): Command {
  const cmd = new Command("clean")
    .description(
      "Remove every artifact AIR has previously written to a target directory (skill / hook directories, MCP server keys, manifest). The adapter is read from the manifest by default — pass it explicitly only to override."
    )
    .argument(
      "[adapter]",
      "Agent adapter to use (e.g., claude). Inferred from the manifest when omitted."
    )
    .option(
      "--target <dir>",
      "Target directory to clean (defaults to cwd)",
      process.cwd()
    )
    .option(
      "--dry-run",
      "Print what would be removed without modifying disk"
    )
    .option(
      "--keep-skills",
      "Don't remove skill directories — preserve them in the manifest"
    )
    .option(
      "--keep-hooks",
      "Don't remove hook directories or AIR-managed hook entries from settings.json"
    )
    .option(
      "--keep-mcp",
      "Don't remove AIR-managed MCP server keys from .mcp.json"
    )
    .option(
      "--config <path>",
      "Path to air.json (only used to locate adapter packages installed via `air install`; defaults to AIR_CONFIG env or ~/.air/air.json)"
    )
    .action(
      async (
        adapter: string | undefined,
        options: {
          target: string;
          dryRun?: boolean;
          keepSkills?: boolean;
          keepHooks?: boolean;
          keepMcp?: boolean;
          config?: string;
        }
      ) => {
        try {
          const result = await cleanSession({
            adapter,
            target: options.target,
            config: options.config,
            dryRun: options.dryRun,
            keepSkills: options.keepSkills,
            keepHooks: options.keepHooks,
            keepMcpServers: options.keepMcp,
          });

          const prefix = options.dryRun ? "Would remove" : "Removed";

          if (!result.manifestExisted) {
            console.error(
              `No AIR manifest found for ${options.target}. Nothing to clean.`
            );
            return;
          }

          const totalRemoved =
            result.removedSkills.length +
            result.removedHooks.length +
            result.removedMcpServers.length;

          console.error(
            `${prefix} ${totalRemoved} artifact(s) from ${options.target}:`
          );

          if (result.removedSkills.length > 0) {
            console.error(`  Skills: ${result.removedSkills.join(", ")}`);
          }
          if (result.removedHooks.length > 0) {
            console.error(`  Hooks: ${result.removedHooks.join(", ")}`);
          }
          if (result.removedMcpServers.length > 0) {
            console.error(
              `  MCP servers: ${result.removedMcpServers.join(", ")}`
            );
          }

          if (result.mcpConfigPath) {
            console.error(
              `  ${options.dryRun ? "Would update" : "Updated"} ${result.mcpConfigPath}`
            );
          }
          if (result.settingsPath) {
            console.error(
              `  ${options.dryRun ? "Would update" : "Updated"} ${result.settingsPath}`
            );
          }
          if (result.manifestRemoved) {
            console.error(`  Removed manifest ${result.manifestPath}`);
          } else if (!options.dryRun && result.manifestExisted) {
            console.error(
              `  Updated manifest ${result.manifestPath} (kept entries preserved)`
            );
          }

          console.log(JSON.stringify(result, null, 2));
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error(`Error: ${message}`);
          process.exit(1);
        }
      }
    );

  return cmd;
}
