import { Command } from "commander";
import { smartInit, InitFromRepoError } from "@pulsemcp/air-sdk";

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
        const result = smartInit({
          path: options.path,
          force: options.force,
        });

        if (result.mode === "repo") {
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
        } else {
          console.log(
            `Initialized AIR configuration at ${result.airJsonPath}`
          );
          console.log(
            "\nair.json is the composition point for your sessions — each artifact field" +
              "\n(skills, mcp, roots, hooks, references, plugins) accepts an ARRAY of index" +
              "\npaths. Mix local directories and/or remote catalogs; later entries override" +
              "\nearlier ones by ID. Example:"
          );
          console.log(
            '\n  {\n    "name": "my-config",\n    "skills": [\n      "./skills/skills.json",\n      "github://acme/shared-catalog/skills/skills.json"\n    ]\n  }'
          );
          console.log(
            "\nSee https://github.com/pulsemcp/air/blob/main/docs/guides/composition-and-overrides.md" +
              "\nValidate with: air validate ~/.air/air.json"
          );
        }
      } catch (err) {
        if (err instanceof InitFromRepoError && err.code === "EXISTS") {
          console.error(`Error: ${err.message} Use --force to overwrite.`);
          process.exit(1);
        }
        const message =
          err instanceof Error ? err.message : "Unknown error";
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  return cmd;
}
