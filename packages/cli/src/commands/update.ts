import { createRequire } from "node:module";
import { Command } from "commander";
import {
  runUpdate,
  type CacheRefreshResult,
  type ExtensionUpgradePlan,
  type RunUpdateResult,
  type UpdatePlan,
  type VersionBump,
} from "@pulsemcp/air-sdk";
import { parseGitProtocolFlag } from "./git-protocol.js";
import { isInteractiveTTY, promptYesNo } from "../prompts.js";

interface UpdateOptions {
  config?: string;
  autoHeal?: boolean;
  gitProtocol?: string;
  upgrade?: boolean;
  extensions?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}

/** Print the provider cache refresh half of the run. */
function reportCaches(
  cacheResults: Record<string, CacheRefreshResult[]>,
  cacheRefreshError: string | null
): void {
  console.log("Refreshing provider caches…");

  // A failed refresh also yields no results, so say which of the two happened
  // rather than printing a reassuring "none found" over an error.
  if (cacheRefreshError) {
    console.log(`  ✗ cache refresh failed — ${cacheRefreshError}`);
    return;
  }

  const schemes = Object.keys(cacheResults);
  if (schemes.length === 0) {
    console.log("  · no providers with cached data found");
    return;
  }

  for (const scheme of schemes) {
    const entries = cacheResults[scheme];
    if (entries.length === 0) {
      console.log(`  · ${scheme}:// — no cached entries`);
      continue;
    }
    for (const entry of entries) {
      const icon = entry.updated ? "✓" : "·";
      console.log(`  ${icon} ${entry.label} — ${entry.message}`);
    }
  }
}

/** Render the bump table, one aligned line per package. */
function formatBumps(bumps: VersionBump[]): string[] {
  const width = Math.max(...bumps.map((b) => b.packageName.length));
  return bumps.map(
    (b) =>
      `  ${b.packageName.padEnd(width)}  ${b.currentVersion ?? "(not installed)"} → ${b.target}`
  );
}

/**
 * Print the version check as soon as it is known — before the confirmation
 * prompt, which is the whole point: the user is shown what would change and
 * then asked about exactly that.
 */
function reportPlan(plan: UpdatePlan): void {
  console.log(`\nCurrent version: ${plan.cliCurrentVersion}`);
  if (
    plan.cliLatestVersion &&
    plan.cliLatestVersion !== plan.cliCurrentVersion
  ) {
    console.log(`Latest version: ${plan.cliLatestVersion}`);
  }

  for (const warning of plan.warnings) {
    console.error(`Warning: ${warning}`);
  }

  if (plan.bumps.length > 0) {
    console.log("\nVersion check:");
    for (const line of formatBumps(plan.bumps)) {
      console.log(line);
    }
  }
}

/** Extensions that were deliberately left out of the bump list, with reasons. */
function reportSkippedExtensions(plans: ExtensionUpgradePlan[]): void {
  const skipped = plans.filter((p) => p.action === "skipped");
  if (skipped.length === 0) return;

  console.log("\nExtensions not upgraded:");
  for (const plan of skipped) {
    console.log(`  · ${plan.specifier} — ${plan.detail}`);
  }
}

/**
 * Print what a `--dry-run` would have done, reusing the wording of the
 * commands that would actually run so the preview is checkable by eye.
 */
function reportDryRun(result: RunUpdateResult): void {
  const { versionCheck } = result;
  console.log("\nDry run — nothing was installed.");

  if (versionCheck.bumps.some((b) => b.kind === "cli")) {
    console.log("  Would run: npm install -g @pulsemcp/air-cli@latest");
  }

  const extensionBumps = versionCheck.extensionPlans.filter(
    (p) => p.action === "upgrade"
  );
  if (extensionBumps.length > 0 && versionCheck.extensions) {
    const pins = extensionBumps
      .map((p) => `${p.packageName}: "${p.targetConstraint}"`)
      .join(", ");
    console.log(
      `  Would pin in ${versionCheck.extensions.manifestPath}: ${pins}`
    );
    console.log(
      `  Would run: npm install --prefix ${versionCheck.extensions.prefix}`
    );
  }
}

/** Print the version-check half of the run, after any prompt has resolved. */
function reportOutcome(result: RunUpdateResult): void {
  const { versionCheck } = result;

  switch (versionCheck.decision) {
    case "not-needed":
      console.log("\nEverything is up to date.");
      break;
    case "check-failed":
      // Deliberately not "up to date": the warning above said the registry
      // was unreachable, and a line claiming everything is current would
      // contradict it.
      console.log(
        "\nCould not check for updates — nothing was installed. " +
          "Re-run `air update` once the registry is reachable."
      );
      break;
    case "disabled":
      console.log(
        "\n--no-upgrade: nothing was installed. " +
          "Re-run `air update` without it to upgrade."
      );
      break;
    case "dry-run":
      reportDryRun(result);
      break;
    case "declined":
      console.log("\nSkipped — nothing was installed.");
      break;
    case "non-interactive":
      // The single most important line in this command. A non-TTY caller —
      // CI, a pipeline, a wrapper script — is told exactly what it would take
      // to opt in, and is never bumped for having asked a question.
      console.log(
        "\nNot an interactive terminal — nothing was installed.\n" +
          "Re-run with --yes to upgrade without a prompt, " +
          "or run `air update` from a terminal to confirm interactively."
      );
      break;
    case "applied": {
      if (versionCheck.cliUpgraded) {
        console.log(
          `\nUpgraded @pulsemcp/air-cli: ${versionCheck.cliCurrentVersion} → ${versionCheck.cliLatestVersion}`
        );
      }
      const upgraded = versionCheck.extensions?.upgraded ?? [];
      if (upgraded.length > 0) {
        console.log(
          `Upgraded ${upgraded.length} extension(s): ${upgraded.join(", ")}`
        );
      }
      break;
    }
  }

  // Restored from the old `air upgrade`: without this, a first-time user with
  // no air.json gets a run that silently ignores the entire extension half.
  if (versionCheck.extensions && !versionCheck.extensions.configFound) {
    console.log(
      "\nNo air.json found — skipping the extension check. " +
        "Run `air init` first, or set AIR_CONFIG."
    );
  }

  reportSkippedExtensions(versionCheck.extensionPlans);
}

/**
 * Build the merged update command.
 *
 * `air update` and `air upgrade` are the same command. `update` is canonical;
 * `upgrade` is kept as a deprecated alias so existing scripts keep working
 * (issue #132).
 */
function buildUpdateCommand(name: string, deprecated: boolean): Command {
  const cmd = new Command(name)
    .description(
      deprecated
        ? "Deprecated alias for `air update`."
        : "Refresh cached provider data, then check the AIR CLI and every " +
            "extension declared in air.json for newer published versions. " +
            "The version check never installs without --yes or an interactive " +
            "confirmation. (The cache refresh may still repair a provider " +
            "extension too old to refresh its own cache — see --no-auto-heal.)"
    )
    .option(
      "--config <path>",
      "Path to air.json (defaults to AIR_CONFIG env or ~/.air/air.json)"
    )
    .option("-y, --yes", "Assume confirmation — upgrade without prompting")
    .option(
      "--no-upgrade",
      "Refresh provider caches only; report available version bumps but install nothing"
    )
    .option("--dry-run", "Show what would be installed without installing it")
    .option(
      "--no-extensions",
      "Leave the extension tree alone; only consider the CLI itself"
    )
    .option(
      "--no-auto-heal",
      "Do not auto-upgrade provider extensions that are too old to refresh their cache. " +
        "This repair is the one install the confirmation prompt does not cover"
    )
    .option(
      "--git-protocol <protocol>",
      'Protocol used by git-based catalog providers: "ssh" (default) or "https". Overrides the gitProtocol field in air.json.'
    )
    .action(async (options: UpdateOptions) => {
      if (deprecated) {
        console.error(
          "Warning: `air upgrade` is deprecated — use `air update` instead.\n" +
            "  The two commands are now one: `air update` refreshes provider caches " +
            "and upgrades\n  the CLI and its extensions together, asking before any " +
            "version bump.\n  In scripts, pass --yes to upgrade without a prompt.\n"
        );
      }

      const gitProtocol = parseGitProtocolFlag(options.gitProtocol);
      const require = createRequire(import.meta.url);
      const { version: cliVersion } = require("../../package.json");

      try {
        const result = await runUpdate({
          cliVersion,
          onCachesRefreshed: reportCaches,
          onPlan: reportPlan,
          config: options.config,
          autoHeal: options.autoHeal,
          gitProtocol,
          upgrade: options.upgrade,
          extensions: options.extensions,
          assumeYes: options.yes,
          dryRun: options.dryRun,
          // Supplied only when there is a human at the keyboard. Without it
          // the SDK refuses to install anything, which is what keeps an
          // unattended `npm install -g` out of CI.
          confirm: isInteractiveTTY()
            ? async (bumps: VersionBump[]) => {
                console.log("");
                return promptYesNo(
                  `Upgrade ${bumps.length === 1 ? "this package" : `these ${bumps.length} packages`}? [Y/n] `
                );
              }
            : undefined,
        });

        reportOutcome(result);

        // A cache refresh that failed and was not repaired by an upgrade is
        // still a failed run — exit non-zero so scripts notice. When an
        // upgrade *did* run, the likely cause was just fixed, so say so and
        // exit clean.
        if (result.cacheRefreshError) {
          if (result.versionCheck.decision === "applied") {
            console.log(
              "\nThe provider cache refresh failed before the upgrade — " +
                "re-run `air update` to complete it."
            );
          } else {
            process.exit(1);
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

export function updateCommand(): Command {
  return buildUpdateCommand("update", false);
}

/**
 * `air upgrade` — a deprecated alias for `air update` that prints a notice and
 * then does the same work. Deprecating is not removing: existing scripts and
 * muscle memory keep working.
 */
export function upgradeCommand(): Command {
  return buildUpdateCommand("upgrade", true);
}
