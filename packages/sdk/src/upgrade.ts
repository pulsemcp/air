import { execFile } from "child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { loadAirConfig, getAirJsonPath } from "@pulsemcp/air-core";
import {
  compareVersions,
  lockstepRange,
  parseVersion,
  rangeIsWithinMinorLine,
  readInstalledVersion,
  satisfiesRange,
  specifierRange,
  stripVersion,
} from "./versions.js";

/**
 * Packages that ride the AIR lockstep version line. Every package published
 * from the AIR monorepo shares one version, so an extension in this namespace
 * is compatible with a given CLI exactly when it sits on the same
 * `MAJOR.MINOR`. Third-party extensions version independently and are never
 * touched.
 */
const FIRST_PARTY_PREFIX = "@pulsemcp/air-";

/** Why a given extension was left alone. */
export type ExtensionUpgradeSkipReason =
  | "local-path"
  | "third-party"
  | "explicitly-pinned"
  | "ahead-of-cli"
  | "unknown-cli-version";

/** What `upgradeExtensions` decided to do about one extension. */
export type ExtensionUpgradeAction = "upgrade" | "up-to-date" | "skipped";

export interface ExtensionUpgradePlan {
  /** The specifier exactly as it appears in air.json's `extensions`. */
  specifier: string;
  /** The specifier with any version suffix stripped. */
  packageName: string;
  /** Version found under `<prefix>/node_modules`, or null if not installed. */
  installedVersion: string | null;
  /** The range currently declared in `<prefix>/package.json`, if any. */
  currentConstraint: string | null;
  /** The range this upgrade would write. Null for skipped entries. */
  targetConstraint: string | null;
  action: ExtensionUpgradeAction;
  /** Set when `action` is "skipped". */
  skipReason?: ExtensionUpgradeSkipReason;
  /** Human-readable explanation, always set for skipped entries. */
  detail?: string;
}

export interface UpgradeExtensionsOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
  /**
   * npm install prefix. Defaults to the directory containing air.json — the
   * same directory the extension loader resolves from, which is the whole
   * point: the global npm tree is not where extensions get loaded from.
   */
  prefix?: string;
  /**
   * Version of the CLI the extensions should be brought in line with. This is
   * the *upgraded* CLI version, not the one currently executing.
   */
  cliVersion: string;
  /**
   * Plan only — do not touch package.json and do not run npm install.
   * Defaults to false.
   */
  dryRun?: boolean;
  /** Test hook replacing the real `npm install` invocation. */
  runNpmInstall?: NpmInstallExtensions;
}

/**
 * Hook used by tests to stub out the real `npm install`. Resolves with the
 * install outcome rather than rejecting, so the caller can roll back cleanly.
 *
 * Implementations reconcile `<prefix>/node_modules` against the dependency
 * ranges already written into `<prefix>/package.json`.
 */
export type NpmInstallExtensions = (
  prefix: string
) => Promise<{ ok: boolean; stderr: string }>;

export interface UpgradeExtensionsResult {
  /** False when no air.json could be located — nothing was inspected. */
  configFound: boolean;
  /** Resolved air.json path, or null when none was found. */
  airJsonPath: string | null;
  /** Directory npm was (or would be) pointed at. */
  prefix: string;
  /** Path to the manifest whose dependencies were rewritten. */
  manifestPath: string;
  /** CLI version the extensions were aligned to. */
  cliVersion: string;
  /** The range written for first-party packages, or null if unusable. */
  targetConstraint: string | null;
  /** One entry per unique extension specifier, in air.json order. */
  plans: ExtensionUpgradePlan[];
  /** Package names whose constraint was rewritten and which were reinstalled. */
  upgraded: string[];
  /** True when `<prefix>/package.json` was written. */
  manifestUpdated: boolean;
  /** True when nothing was written because `dryRun` was set. */
  dryRun: boolean;
}

/**
 * Default {@link NpmInstallExtensions} — runs a bare
 * `npm install --prefix <prefix>`.
 *
 * Deliberately passes no package specs. npm rewrites `dependencies` when it is
 * handed one (`~0.13.0` comes back as `^0.13.1`), which both loses the range
 * this module chose and makes the next `air upgrade` see a constraint it does
 * not recognise. Given no specs, npm leaves package.json untouched and simply
 * reconciles the tree and the lockfile against the ranges already written
 * there.
 */
const defaultNpmInstall: NpmInstallExtensions = (prefix) =>
  new Promise((resolveResult) => {
    execFile(
      "npm",
      ["install", "--prefix", prefix, "--no-audit", "--no-fund"],
      { stdio: "pipe" } as Parameters<typeof execFile>[2],
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

/** Read `<prefix>/package.json`, returning null when absent or unparseable. */
function readManifest(manifestPath: string): Record<string, unknown> | null {
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readDependencies(
  manifest: Record<string, unknown> | null
): Record<string, string> {
  const deps = manifest?.dependencies;
  if (!deps || typeof deps !== "object" || Array.isArray(deps)) return {};
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(deps as Record<string, unknown>)) {
    if (typeof range === "string") out[name] = range;
  }
  return out;
}

/**
 * Bring the extension tree under `<airJsonDir>/node_modules` in line with the
 * CLI version.
 *
 * AIR publishes every package in the monorepo off one shared version line, but
 * `air upgrade` historically only touched the global `@pulsemcp/air-cli`
 * install. Extensions are loaded from `<airJsonDir>/node_modules` — never from
 * the global tree — so a CLI upgrade alone leaves the code that actually runs
 * several versions behind.
 *
 * This rewrites the `dependencies` entry for each first-party extension in
 * `<prefix>/package.json` to `~MAJOR.MINOR.0` of the upgraded CLI, then runs a
 * bare `npm install --prefix <prefix>` so npm reconciles the tree against
 * those ranges. Entries it deliberately does not touch:
 *
 * - local path extensions (`./…`, `../…`, `/…`), which npm does not manage
 * - packages outside `@pulsemcp/air-`, which are not on the lockstep line
 * - specifiers that pin a version in air.json, which state the user's intent
 * - packages already installed *ahead* of the CLI, to avoid a downgrade
 *
 * On npm failure the manifest is restored to its previous contents and an
 * error is thrown, so a failed upgrade never leaves the manifest describing a
 * tree that does not exist on disk.
 *
 * @throws Error if npm install fails.
 */
export async function upgradeExtensions(
  options: UpgradeExtensionsOptions
): Promise<UpgradeExtensionsResult> {
  const airJsonPath = options.config ?? getAirJsonPath();
  const cliVersion = options.cliVersion;
  const dryRun = options.dryRun ?? false;

  if (!airJsonPath) {
    return {
      configFound: false,
      airJsonPath: null,
      prefix: "",
      manifestPath: "",
      cliVersion,
      targetConstraint: lockstepRange(cliVersion),
      plans: [],
      upgraded: [],
      manifestUpdated: false,
      dryRun,
    };
  }

  const prefix = options.prefix
    ? resolve(options.prefix)
    : dirname(resolve(airJsonPath));
  const manifestPath = resolve(prefix, "package.json");
  const targetConstraint = lockstepRange(cliVersion);

  const airConfig = loadAirConfig(airJsonPath);
  const extensions = airConfig.extensions ?? [];

  const manifest = readManifest(manifestPath);
  const declared = readDependencies(manifest);

  const plans: ExtensionUpgradePlan[] = [];
  const seen = new Set<string>();

  for (const specifier of extensions) {
    if (typeof specifier !== "string") continue;
    if (seen.has(specifier)) continue;
    seen.add(specifier);

    const packageName = stripVersion(specifier);
    const base: Omit<ExtensionUpgradePlan, "action"> = {
      specifier,
      packageName,
      installedVersion: null,
      currentConstraint: declared[packageName] ?? null,
      targetConstraint: null,
    };

    if (
      specifier.startsWith("./") ||
      specifier.startsWith("../") ||
      specifier.startsWith("/")
    ) {
      plans.push({
        ...base,
        action: "skipped",
        skipReason: "local-path",
        detail: "local path extension — not managed by npm",
      });
      continue;
    }

    base.installedVersion = readInstalledVersion(packageName, prefix);

    if (!packageName.startsWith(FIRST_PARTY_PREFIX)) {
      plans.push({
        ...base,
        action: "skipped",
        skipReason: "third-party",
        detail: `not a ${FIRST_PARTY_PREFIX}* package — its versions are not tied to the CLI`,
      });
      continue;
    }

    const pinned = specifierRange(specifier);
    if (pinned) {
      plans.push({
        ...base,
        action: "skipped",
        skipReason: "explicitly-pinned",
        detail: `air.json pins "${pinned}" — leaving it alone`,
      });
      continue;
    }

    // Without a usable target range there is nothing meaningful to write.
    if (!targetConstraint) {
      plans.push({
        ...base,
        action: "skipped",
        skipReason: "unknown-cli-version",
        detail: `cannot derive a version range from CLI version "${cliVersion}"`,
      });
      continue;
    }

    const installedVersion = base.installedVersion;

    // Refuse to walk a package backwards. A user who has deliberately
    // installed an extension newer than the CLI's line keeps it.
    if (
      installedVersion &&
      compareVersions(installedVersion, cliVersion) > 0 &&
      satisfiesRange(installedVersion, targetConstraint) !== true
    ) {
      plans.push({
        ...base,
        action: "skipped",
        skipReason: "ahead-of-cli",
        detail: `installed ${installedVersion} is ahead of the CLI (${cliVersion}) — refusing to downgrade`,
      });
      continue;
    }

    base.targetConstraint = targetConstraint;

    // A constraint counts as current when it is the one we would write, or
    // when it already confines the package to the CLI's minor line by some
    // other spelling (`^0.13.1`, say — what npm leaves behind when it saves a
    // dependency itself). Rewriting those would reinstall on every run.
    const cli = parseVersion(cliVersion)!;
    const constraintCurrent =
      base.currentConstraint !== null &&
      (base.currentConstraint === targetConstraint ||
        rangeIsWithinMinorLine(base.currentConstraint, cli.major, cli.minor));
    const treeCurrent =
      installedVersion !== null &&
      satisfiesRange(installedVersion, targetConstraint) === true;

    plans.push({
      ...base,
      action: constraintCurrent && treeCurrent ? "up-to-date" : "upgrade",
    });
  }

  const toUpgrade = plans.filter((p) => p.action === "upgrade");

  if (dryRun || toUpgrade.length === 0) {
    return {
      configFound: true,
      airJsonPath,
      prefix,
      manifestPath,
      cliVersion,
      targetConstraint,
      plans,
      upgraded: [],
      manifestUpdated: false,
      dryRun,
    };
  }

  const previousManifest = existsSync(manifestPath)
    ? readFileSync(manifestPath, "utf-8")
    : null;

  const nextManifest: Record<string, unknown> = manifest
    ? { ...manifest }
    : { name: "air-extensions", private: true, version: "0.0.0" };
  const nextDeps: Record<string, string> = { ...declared };
  for (const plan of toUpgrade) {
    nextDeps[plan.packageName] = plan.targetConstraint!;
  }
  // `npm install` reconciles the whole tree against this manifest, and prunes
  // anything it does not declare. Any extension air.json names and that is
  // present on disk but missing from `dependencies` would therefore be
  // *deleted* by the reconcile below — so record what is already installed
  // before handing npm the file. This preserves exactly the entries this
  // upgrade deliberately declined to touch.
  for (const plan of plans) {
    if (plan.skipReason === "local-path") continue;
    if (nextDeps[plan.packageName] !== undefined) continue;
    if (plan.installedVersion === null) continue;
    nextDeps[plan.packageName] =
      specifierRange(plan.specifier) ?? plan.installedVersion;
  }
  nextManifest.dependencies = nextDeps;
  writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2) + "\n");

  const runNpmInstall = options.runNpmInstall ?? defaultNpmInstall;
  const outcome = await runNpmInstall(prefix);

  if (!outcome.ok) {
    // Restore the manifest so a failed upgrade leaves no half-applied state.
    try {
      if (previousManifest === null) {
        unlinkSync(manifestPath);
      } else {
        writeFileSync(manifestPath, previousManifest);
      }
    } catch {
      // Best effort — the thrown error below is the real signal.
    }
    const names = toUpgrade.map((p) => p.packageName).join(", ");
    throw new Error(
      `npm install failed for extensions: ${names}\n` +
        `${manifestPath} was restored to its previous contents. ` +
        `Retry manually with: npm install --prefix ${prefix} ` +
        toUpgrade
          .map((p) => `${p.packageName}@${p.targetConstraint}`)
          .join(" ") +
        (outcome.stderr ? `\n${outcome.stderr.trim()}` : "")
    );
  }

  return {
    configFound: true,
    airJsonPath,
    prefix,
    manifestPath,
    cliVersion,
    targetConstraint,
    plans,
    upgraded: toUpgrade.map((p) => p.packageName),
    manifestUpdated: true,
    dryRun: false,
  };
}
