import { relative } from "path";
import { Command } from "commander";
import { smartInit, InitFromRepoError } from "@pulsemcp/air-sdk";

export function initCommand(): Command {
  const cmd = new Command("init")
    .description(
      "Initialize an AIR configuration — discovers artifact files in the current git repo and generates ~/.air/air.json with GitHub resolvers, or scaffolds a blank ~/.air/ workspace when no repo is detected"
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
            `Initialized AIR configuration at ${result.airDir}`
          );
          console.log(`\nScaffolded ${result.scaffolded.length} file(s):`);
          for (const file of result.scaffolded) {
            console.log(`  [${file.kind}] ${relative(result.airDir, file.path)}`);
          }
          console.log(
            "\nOpen the directory in your editor — each index file has a $schema" +
              "\nreference, so you'll get autocomplete as you add entries." +
              "\nREADME.md has worked examples for every artifact type."
          );
          console.log(
            "\nValidate anytime with: air validate " + result.airJsonPath
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
