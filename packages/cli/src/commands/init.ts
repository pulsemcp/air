import { relative } from "path";
import { Command } from "commander";
import { smartInit } from "@pulsemcp/air-sdk";

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

          if (result.scaffolded.length > 0) {
            console.log(
              `\nScaffolded ${result.scaffolded.length} local file(s) for layering on top of the discovered catalog:`
            );
            for (const file of result.scaffolded) {
              console.log(
                `  [${file.kind}] ${relative(result.airDir, file.path)}`
              );
            }
          }

          console.log(`\nConfig written to ${result.airJsonPath}`);
          console.log(
            "Local entries in the index files above override the discovered catalog by ID."
          );
        } else if (result.mode === "topup") {
          if (result.scaffolded.length === 0) {
            console.log(
              `AIR configuration at ${result.airDir} is already fully scaffolded — nothing to do.`
            );
            console.log(
              "To regenerate air.json from scratch, re-run with --force."
            );
            console.log(
              "\nValidate anytime with: air validate " + result.airJsonPath
            );
          } else {
            console.log(
              `Topped up existing AIR configuration at ${result.airDir}`
            );
            console.log(
              `\nAdded ${result.scaffolded.length} missing file(s):`
            );
            for (const file of result.scaffolded) {
              console.log(
                `  [${file.kind}] ${relative(result.airDir, file.path)}`
              );
            }
            console.log(
              "\nYour existing air.json was left untouched. Open the directory" +
                "\nin your editor — each new index file has a $schema reference," +
                "\nso you'll get autocomplete as you add entries."
            );
            console.log(
              "\nValidate anytime with: air validate " + result.airJsonPath
            );
          }
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
        const message =
          err instanceof Error ? err.message : "Unknown error";
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  return cmd;
}
