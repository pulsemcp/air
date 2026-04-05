import { Command } from "commander";
import { initConfig } from "@pulsemcp/air-sdk";

export function initCommand(): Command {
  const cmd = new Command("init")
    .description("Initialize a new AIR configuration at ~/.air/")
    .action(() => {
      try {
        const result = initConfig();

        console.log(`Initialized AIR configuration at ${result.airDir}/:`);
        for (const file of result.createdFiles) {
          console.log(`  ${file}`);
        }
        console.log(
          "\nEdit air.json to configure your setup. Run 'air validate ~/.air/air.json' to check."
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  return cmd;
}
