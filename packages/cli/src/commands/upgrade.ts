import { createRequire } from "node:module";
import { execSync } from "child_process";
import { Command } from "commander";

export function upgradeCommand(): Command {
  const cmd = new Command("upgrade")
    .description("Upgrade the AIR CLI to the latest version")
    .option("--dry-run", "Show what would be run without executing")
    .action((options: { dryRun?: boolean }) => {
      const require = createRequire(import.meta.url);
      const { version: currentVersion } = require("../../package.json");

      console.log(`Current version: ${currentVersion}`);

      // Check the registry for the latest published version
      let latestVersion: string | undefined;
      try {
        latestVersion = execSync("npm view @pulsemcp/air-cli version", {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
      } catch {
        // If registry check fails, proceed with install anyway
      }

      if (latestVersion && latestVersion === currentVersion) {
        console.log("Already up to date.");
        return;
      }

      if (latestVersion) {
        console.log(`Latest version: ${latestVersion}`);
      }

      if (options.dryRun) {
        console.log(
          "Would run: npm install -g @pulsemcp/air-cli@latest"
        );
        return;
      }

      console.log("Running: npm install -g @pulsemcp/air-cli@latest");

      try {
        execSync("npm install -g @pulsemcp/air-cli@latest", {
          encoding: "utf-8",
          stdio: "inherit",
        });

        if (latestVersion) {
          console.log(`\nUpgraded: ${currentVersion} → ${latestVersion}`);
        } else {
          console.log("\nUpgrade complete.");
        }
      } catch (err) {
        const detail = err instanceof Error ? `: ${err.message}` : "";
        console.error(`\nError: upgrade failed${detail}`);
        console.error(
          "If this is a permissions issue, try running with sudo or fix your npm prefix."
        );
        process.exit(1);
      }
    });

  return cmd;
}
