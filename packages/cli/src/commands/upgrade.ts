import { createRequire } from "node:module";
import { execSync } from "child_process";
import { Command } from "commander";
import {
  upgradeExtensions,
  type ExtensionUpgradePlan,
  type UpgradeExtensionsResult,
} from "@pulsemcp/air-sdk";

/** Render one planned extension change as a single console line. */
function formatPlan(plan: ExtensionUpgradePlan): string {
  const from = plan.installedVersion ?? "(not installed)";
  switch (plan.action) {
    case "upgrade":
      return `  ↑ ${plan.packageName} — ${from} → ${plan.targetConstraint}`;
    case "up-to-date":
      return `  · ${plan.packageName} — ${from} (up to date)`;
    default:
      return `  · ${plan.packageName} — skipped: ${plan.detail}`;
  }
}

function reportExtensions(
  result: UpgradeExtensionsResult,
  dryRun: boolean
): void {
  if (!result.configFound) {
    console.log(
      "\nNo air.json found — skipping extension upgrade. " +
        "Run `air init` first, or set AIR_CONFIG."
    );
    return;
  }

  if (result.plans.length === 0) {
    console.log(`\nNo extensions declared in ${result.airJsonPath}.`);
    return;
  }

  console.log(
    `\nExtensions in ${result.prefix} (target ${result.targetConstraint ?? "unknown"}):`
  );
  for (const plan of result.plans) {
    console.log(formatPlan(plan));
  }

  const changing = result.plans.filter((p) => p.action === "upgrade");
  if (changing.length === 0) {
    console.log("Extensions are already in lockstep with the CLI.");
    return;
  }

  if (dryRun) {
    const pins = changing
      .map((p) => `${p.packageName}: "${p.targetConstraint}"`)
      .join(", ");
    console.log(`Would pin in ${result.manifestPath}: ${pins}`);
    console.log(`Would run: npm install --prefix ${result.prefix}`);
    return;
  }

  console.log(`Upgraded ${result.upgraded.length} extension(s).`);
}

export function upgradeCommand(): Command {
  const cmd = new Command("upgrade")
    .description(
      "Upgrade the AIR CLI to the latest version, and bring the extensions " +
        "installed alongside air.json onto the same version line"
    )
    .option("--dry-run", "Show what would be run without executing")
    .option(
      "--config <path>",
      "Path to air.json (defaults to AIR_CONFIG env or ~/.air/air.json)"
    )
    .option(
      "--no-extensions",
      "Only upgrade the CLI; leave the extension tree untouched"
    )
    .action(
      async (options: {
        dryRun?: boolean;
        config?: string;
        extensions?: boolean;
      }) => {
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

        const alreadyCurrent = Boolean(
          latestVersion && latestVersion === currentVersion
        );

        if (latestVersion && !alreadyCurrent) {
          console.log(`Latest version: ${latestVersion}`);
        }

        if (alreadyCurrent) {
          console.log("Already up to date.");
        } else if (options.dryRun) {
          console.log("Would run: npm install -g @pulsemcp/air-cli@latest");
        } else {
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
        }

        if (options.extensions === false) {
          return;
        }

        // Extensions are loaded from <airJsonDir>/node_modules, never from the
        // global npm tree, so upgrading the CLI alone leaves the code that
        // actually runs behind. Bring that tree onto the same version line.
        //
        // The target is the version the CLI is on *after* this command: the
        // freshly installed one when we know it, or the running one when it
        // was already current. If the registry lookup failed we do not know
        // which version was installed, so we say so instead of pinning
        // extensions to a version line that may already be stale.
        const targetVersion = alreadyCurrent ? currentVersion : latestVersion;
        if (!targetVersion) {
          console.error(
            "\nWarning: could not determine the upgraded CLI version " +
              "(npm registry lookup failed) — skipping the extension upgrade. " +
              "Re-run `air upgrade` once the registry is reachable."
          );
          return;
        }

        try {
          const result = await upgradeExtensions({
            config: options.config,
            cliVersion: targetVersion,
            dryRun: options.dryRun ?? false,
          });
          reportExtensions(result, options.dryRun ?? false);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error(`\nError: extension upgrade failed: ${message}`);
          process.exit(1);
        }
      }
    );

  return cmd;
}
