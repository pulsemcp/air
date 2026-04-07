import { Command } from "commander";
import { existsSync, unlinkSync } from "fs";
import { initConfig, initFromRepo, getDefaultAirJsonPath } from "@pulsemcp/air-sdk";

export function initCommand(): Command {
  const cmd = new Command("init")
    .description(
      "Initialize an AIR configuration — discovers artifact files in the current git repo and generates ~/.air/air.json with GitHub resolvers"
    )
    .option("--force", "Overwrite existing air.json if it exists")
    .option(
      "--path <path>",
      "Output path for air.json (defaults to ~/.air/air.json)"
    )
    .action((options: { force?: boolean; path?: string }) => {
      try {
        // Try repo-based init first — discovers artifacts and generates
        // GitHub resolver URIs from the current git repository.
        const result = initFromRepo({
          path: options.path,
          force: options.force,
        });

        if (result.overwritten) {
          console.log(`Overwrote existing config at ${result.airJsonPath}`);
        }

        console.log(
          `Initialized AIR configuration from ${result.repo} (branch: ${result.branch})`
        );
        console.log(`\nDiscovered ${result.discovered.length} artifact file(s):`);
        for (const artifact of result.discovered) {
          console.log(`  [${artifact.type}] ${artifact.repoPath}`);
        }
        console.log(`\nConfig written to ${result.airJsonPath}`);
      } catch (repoErr) {
        const repoMessage =
          repoErr instanceof Error ? repoErr.message : String(repoErr);

        // If the config already exists and --force was not used, exit with the error.
        if (
          repoMessage.includes("already exists") &&
          !options.force
        ) {
          console.error(
            `Error: ${repoMessage} Use --force to overwrite.`
          );
          process.exit(1);
        }

        // If we're not in a git repo or have no artifacts, fall back to blank init.
        if (
          repoMessage.includes("Not inside a git repository") ||
          repoMessage.includes("No git remote") ||
          repoMessage.includes("Could not parse GitHub") ||
          repoMessage.includes("No AIR artifact index files")
        ) {
          try {
            // When --force is set and an existing config blocks initConfig,
            // remove it first since initConfig does not support overwriting.
            if (options.force) {
              const targetPath = options.path ?? getDefaultAirJsonPath();
              if (existsSync(targetPath)) {
                unlinkSync(targetPath);
              }
            }

            const result = initConfig({ path: options.path });

            console.log(
              `Initialized AIR configuration at ${result.airJsonPath}`
            );
            console.log(
              "\nEdit air.json to configure your setup. Run 'air validate ~/.air/air.json' to check."
            );
          } catch (initErr) {
            const message =
              initErr instanceof Error ? initErr.message : "Unknown error";
            console.error(`Error: ${message}`);
            process.exit(1);
          }
          return;
        }

        // Unexpected error — report it
        console.error(`Error: ${repoMessage}`);
        process.exit(1);
      }
    });

  return cmd;
}
