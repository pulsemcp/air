import { execFile } from "child_process";
import type { CacheRefreshResult } from "@pulsemcp/air-core";
import { updateProviderCaches, type NpmInstallLatest } from "./update.js";
import {
  upgradeExtensions,
  type ExtensionUpgradePlan,
  type NpmInstallExtensions,
  type UpgradeExtensionsResult,
} from "./upgrade.js";
import { compareVersions } from "./versions.js";

/** The npm package the CLI ships as — the thing `npm install -g` targets. */
export const AIR_CLI_PACKAGE = "@pulsemcp/air-cli";

/** Which half of the install a bump belongs to. */
export type VersionBumpKind = "cli" | "extension";

/** One package this run would move, as shown to the user before confirming. */
export interface VersionBump {
  kind: VersionBumpKind;
  packageName: string;
  /** Version installed today, or null when the package is not installed. */
  currentVersion: string | null;
  /**
   * What this bump moves the package to: a concrete version for the CLI, and
   * the lockstep range (`~MAJOR.MINOR.0`) for an extension, which is what
   * actually gets written into `<airJsonDir>/package.json`.
   */
  target: string;
}

/**
 * What happened to the version-check half of the run.
 *
 * Everything except `"applied"` means **nothing was installed**. The default
 * is deliberately one of the skip states: a bump only ever happens on an
 * explicit `assumeYes` or a `confirm` callback that answered yes.
 */
export type UpgradeDecision =
  /** No package needed a bump. */
  | "not-needed"
  /** `dryRun` was set — the plan was computed and discarded. */
  | "dry-run"
  /** `upgrade: false` (`--no-upgrade`) — the plan was shown, not run. */
  | "disabled"
  /** A `confirm` callback was asked and said no. */
  | "declined"
  /**
   * No `confirm` callback and no `assumeYes`. This is the non-TTY default:
   * a caller that cannot ask a human never installs on its own initiative.
   */
  | "non-interactive"
  /** The bumps were installed. */
  | "applied";

export interface VersionCheckResult {
  /** Version of the CLI that is running right now. */
  cliCurrentVersion: string;
  /** Latest published version, or null when the registry lookup failed. */
  cliLatestVersion: string | null;
  /** The CLI version the extension line was (or would be) aligned to. */
  targetCliVersion: string | null;
  /** Every package that needs a bump, CLI first. Empty means up to date. */
  bumps: VersionBump[];
  decision: UpgradeDecision;
  /** True when `npm install -g` actually ran. */
  cliUpgraded: boolean;
  /** Every extension entry considered, including skipped and up-to-date ones. */
  extensionPlans: ExtensionUpgradePlan[];
  /**
   * The extension upgrade outcome — the applied one when installs ran, the
   * dry-run plan otherwise, and null when extensions were not inspected.
   */
  extensions: UpgradeExtensionsResult | null;
  /** Non-fatal problems worth printing (e.g. a failed registry lookup). */
  warnings: string[];
}

/** What the version check found, handed to `onPlan` before anything runs. */
export interface UpdatePlan {
  cliCurrentVersion: string;
  cliLatestVersion: string | null;
  bumps: VersionBump[];
  extensionPlans: ExtensionUpgradePlan[];
  warnings: string[];
}

export interface RunUpdateResult {
  /** Provider cache refresh results, keyed by provider scheme. */
  cacheResults: Record<string, CacheRefreshResult[]>;
  /**
   * The message from a failed cache refresh, or null when it succeeded.
   *
   * A refresh failure does not abort the run. The commonest cause is an
   * extension that is too old (or missing) to load — which is exactly the
   * state the version check below repairs, so aborting here would take away
   * the only command that can fix it. The caller decides what to do with a
   * failure that nothing repaired; the CLI exits non-zero.
   */
  cacheRefreshError: string | null;
  versionCheck: VersionCheckResult;
}

/** Hook used by tests to stub the registry lookup for the latest version. */
export type LatestVersionLookup = (
  packageName: string
) => Promise<string | null>;

/** Hook used by tests to stub the global `npm install -g` invocation. */
export type NpmInstallGlobal = (
  specifier: string
) => Promise<{ ok: boolean; stderr: string }>;

export interface RunUpdateOptions {
  /**
   * Version of the CLI that is running. The SDK cannot read this for itself —
   * the CLI's own package.json is the source of truth — so the caller passes
   * it in.
   */
  cliVersion: string;
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
  /** Forwarded to {@link updateProviderCaches}. Defaults to true. */
  autoHeal?: boolean;
  /** Git protocol override for git-based catalog providers. */
  gitProtocol?: "ssh" | "https";
  /**
   * Run the version check's install step at all. False (`--no-upgrade`) still
   * computes and reports the plan — it just never installs.
   * Defaults to true.
   */
  upgrade?: boolean;
  /** Include the extension tree in the version check. Defaults to true. */
  extensions?: boolean;
  /** Assume confirmation — the scripting path (`--yes`). Defaults to false. */
  assumeYes?: boolean;
  /** Plan only: refresh caches, report the plan, install nothing. */
  dryRun?: boolean;
  /**
   * Asked once, before anything is installed, when a bump is available.
   *
   * **Omitting it means no bump happens** unless `assumeYes` is set. That is
   * the whole safety property: the CLI supplies this callback only when both
   * stdin and stdout are a TTY, so a non-interactive caller — CI, a pipeline,
   * a wrapper script — can never be surprised by an unattended
   * `npm install -g`.
   */
  confirm?: (bumps: VersionBump[]) => Promise<boolean>;
  /**
   * Called as soon as the provider caches have been refreshed, before the
   * registry is consulted. Lets a caller render the run as it happens rather
   * than in one burst at the end — which matters because {@link confirm} is
   * asked in the middle of it.
   */
  onCachesRefreshed?: (
    cacheResults: Record<string, CacheRefreshResult[]>
  ) => void;
  /** Called once the plan is known, immediately before the decision is made. */
  onPlan?: (plan: UpdatePlan) => void;
  /** Test hook replacing the `npm view <pkg> version` lookup. */
  getLatestVersion?: LatestVersionLookup;
  /** Test hook replacing the real `npm install -g`. */
  runNpmInstallGlobal?: NpmInstallGlobal;
  /** Test hook replacing the extension `npm install`. */
  runNpmInstall?: NpmInstallExtensions;
  /** Test hook replacing the provider auto-heal `npm install <pkg>@latest`. */
  runNpmInstallLatest?: NpmInstallLatest;
}

/**
 * Default {@link LatestVersionLookup} — `npm view <pkg> version`.
 *
 * Resolves to null rather than rejecting when the registry is unreachable;
 * a version check that cannot see the registry degrades to "no bump known",
 * which is the safe direction.
 */
const defaultLatestVersion: LatestVersionLookup = (packageName) =>
  new Promise((resolveResult) => {
    execFile(
      "npm",
      ["view", packageName, "version"],
      { encoding: "utf-8" },
      (err, stdout) => {
        if (err) {
          resolveResult(null);
          return;
        }
        const version = String(stdout).trim();
        resolveResult(version.length > 0 ? version : null);
      }
    );
  });

/**
 * Default {@link NpmInstallGlobal} — `npm install -g <spec>`.
 *
 * Inherits stdout and stderr so npm's own progress output reaches the
 * terminal, exactly as it did when this shelled out from the CLI. Tests never
 * reach this path; they pass their own hook.
 */
const defaultNpmInstallGlobal: NpmInstallGlobal = (specifier) =>
  new Promise((resolveResult) => {
    execFile(
      "npm",
      ["install", "-g", specifier],
      { stdio: ["pipe", "inherit", "inherit"] } as Parameters<
        typeof execFile
      >[2],
      (err, _stdout, stderr) => {
        if (err) {
          resolveResult({
            ok: false,
            stderr: stderr?.toString() || String(err),
          });
        } else {
          resolveResult({ ok: true, stderr: "" });
        }
      }
    );
  });

/**
 * The whole of `air update` (and its deprecated `air upgrade` alias): refresh
 * provider caches, then check the CLI *and* every extension declared in
 * air.json for a newer published version, and install only with consent.
 *
 * The two halves used to be two commands whose boundary was invisible until a
 * user hit it — `air update` refreshed caches without ever touching the CLI,
 * `air upgrade` bumped the CLI without ever refreshing a cache — so typing
 * the name that matched your mental model left you in a silent partial state
 * (issue #132).
 *
 * The cache refresh always runs: it changes no versions, so there is nothing
 * to consent to. The version check never installs on its own initiative. It
 * installs when `assumeYes` is set, or when a `confirm` callback answers yes;
 * with neither, it reports `"non-interactive"` and installs nothing. That
 * ordering is what keeps CI safe — a pipeline that has no human to ask never
 * gets an unattended `npm install -g`.
 *
 * @throws Error if the global CLI install fails, or if the extension upgrade
 * fails (which restores the manifest before throwing — see
 * {@link upgradeExtensions}).
 */
export async function runUpdate(
  options: RunUpdateOptions
): Promise<RunUpdateResult> {
  const cliVersion = options.cliVersion;
  const upgradeEnabled = options.upgrade ?? true;
  const extensionsEnabled = options.extensions ?? true;
  const dryRun = options.dryRun ?? false;
  const warnings: string[] = [];

  // 1. Refresh provider caches. No version changes, so no prompt — this is
  //    the half that behaves exactly as `air update` always has.
  //
  //    A failure here is reported, not thrown. Loading a provider is how the
  //    refresh runs, and a provider too old or too broken to load is the very
  //    condition the version check below fixes — so this must not become the
  //    step that stops a user from reaching it.
  let cacheResults: Record<string, CacheRefreshResult[]> = {};
  let cacheRefreshError: string | null = null;
  try {
    cacheResults = (
      await updateProviderCaches({
        config: options.config,
        autoHeal: options.autoHeal,
        gitProtocol: options.gitProtocol,
        runNpmInstallLatest: options.runNpmInstallLatest,
      })
    ).results;
  } catch (err) {
    cacheRefreshError = err instanceof Error ? err.message : String(err);
    warnings.push(`Provider cache refresh failed: ${cacheRefreshError}`);
  }
  options.onCachesRefreshed?.(cacheResults);

  // 2. Check the CLI against the registry.
  const getLatestVersion = options.getLatestVersion ?? defaultLatestVersion;
  const cliLatestVersion = await getLatestVersion(AIR_CLI_PACKAGE);

  const cliNeedsBump = Boolean(
    cliLatestVersion && compareVersions(cliLatestVersion, cliVersion) > 0
  );

  // The version line extensions are held to is the one the CLI will be on
  // *after* this run: the published version when we are bumping to it, the
  // running one when it is already current. With no registry answer we do not
  // know either, so the extension half is skipped rather than pinned to a
  // line that may already be stale.
  const targetCliVersion = cliLatestVersion
    ? cliNeedsBump
      ? cliLatestVersion
      : cliVersion
    : null;

  if (!cliLatestVersion) {
    warnings.push(
      `Could not reach the npm registry to check ${AIR_CLI_PACKAGE} — ` +
        "skipping the version check. Re-run `air update` once it is reachable."
    );
  }

  // 3. Plan the extension half. Always a dry run: nothing is written until
  //    after the confirmation below.
  let extensionPlans: ExtensionUpgradePlan[] = [];
  let extensions: UpgradeExtensionsResult | null = null;
  if (extensionsEnabled && targetCliVersion) {
    extensions = await upgradeExtensions({
      config: options.config,
      cliVersion: targetCliVersion,
      dryRun: true,
    });
    extensionPlans = extensions.plans;
  }

  const bumps: VersionBump[] = [];
  if (cliNeedsBump) {
    bumps.push({
      kind: "cli",
      packageName: AIR_CLI_PACKAGE,
      currentVersion: cliVersion,
      target: cliLatestVersion!,
    });
  }
  for (const plan of extensionPlans) {
    if (plan.action !== "upgrade") continue;
    bumps.push({
      kind: "extension",
      packageName: plan.packageName,
      currentVersion: plan.installedVersion,
      target: plan.targetConstraint!,
    });
  }

  options.onPlan?.({
    cliCurrentVersion: cliVersion,
    cliLatestVersion,
    bumps,
    extensionPlans,
    warnings,
  });

  // 4. Decide. Every branch but the last two leaves the tree untouched, and
  //    the default with no way to ask is to leave it untouched too.
  let decision: UpgradeDecision;
  if (bumps.length === 0) {
    decision = "not-needed";
  } else if (!upgradeEnabled) {
    decision = "disabled";
  } else if (dryRun) {
    decision = "dry-run";
  } else if (options.assumeYes) {
    decision = "applied";
  } else if (options.confirm) {
    decision = (await options.confirm(bumps)) ? "applied" : "declined";
  } else {
    decision = "non-interactive";
  }

  if (decision !== "applied") {
    return {
      cacheResults,
      cacheRefreshError,
      versionCheck: {
        cliCurrentVersion: cliVersion,
        cliLatestVersion,
        targetCliVersion,
        bumps,
        decision,
        cliUpgraded: false,
        extensionPlans,
        extensions,
        warnings,
      },
    };
  }

  // 5. Apply. The CLI goes first so the extension line is pinned to the
  //    version that is actually installed when this returns.
  let cliUpgraded = false;
  if (cliNeedsBump) {
    const runNpmInstallGlobal =
      options.runNpmInstallGlobal ?? defaultNpmInstallGlobal;
    const outcome = await runNpmInstallGlobal(`${AIR_CLI_PACKAGE}@latest`);
    if (!outcome.ok) {
      throw new Error(
        `npm install -g ${AIR_CLI_PACKAGE}@latest failed. ` +
          "If this is a permissions issue, try running with sudo or fix your npm prefix." +
          (outcome.stderr ? `\n${outcome.stderr.trim()}` : "")
      );
    }
    cliUpgraded = true;
  }

  if (extensionsEnabled && targetCliVersion && bumps.some((b) => b.kind === "extension")) {
    extensions = await upgradeExtensions({
      config: options.config,
      cliVersion: targetCliVersion,
      dryRun: false,
      runNpmInstall: options.runNpmInstall,
    });
    extensionPlans = extensions.plans;
  }

  return {
    cacheResults,
    cacheRefreshError,
    versionCheck: {
      cliCurrentVersion: cliVersion,
      cliLatestVersion,
      targetCliVersion,
      bumps,
      decision,
      cliUpgraded,
      extensionPlans,
      extensions,
      warnings,
    },
  };
}
