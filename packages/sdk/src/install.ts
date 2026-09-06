import { resolve, dirname, join } from "path";
import { existsSync, readFileSync } from "fs";
import { execFile } from "child_process";
import { loadAirConfig, getAirJsonPath } from "@pulsemcp/air-core";
import {
  readInstalledVersion,
  satisfiesRange,
  specifierRange,
  stripVersion,
} from "./versions.js";

export interface InstallExtensionsOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
  /** npm install prefix (--prefix). Defaults to the directory containing air.json. */
  prefix?: string;
}

/** An installed extension whose version does not satisfy its declared range. */
export interface ExtensionVersionMismatch {
  /** The specifier as it appears in air.json. */
  specifier: string;
  /** The specifier with any version suffix stripped. */
  packageName: string;
  /** The version found under `<prefix>/node_modules`. */
  installedVersion: string;
  /** The range it failed to satisfy. */
  requiredRange: string;
  /** Where that range came from. */
  source: "air.json" | "package.json";
}

export interface InstallExtensionsResult {
  /** Extensions that were already installed at a satisfying version. */
  alreadyInstalled: string[];
  /** Extensions that were installed by this call. */
  installed: string[];
  /** Extensions that were skipped (local paths, not npm packages). */
  skipped: string[];
  /**
   * Extensions that were present but at a version outside their declared
   * range, and were therefore reinstalled. Each also appears in `installed`.
   */
  mismatched: ExtensionVersionMismatch[];
}

/**
 * Check if an extension specifier is a local path (not an npm package).
 */
function isLocalPath(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/")
  );
}

/**
 * Read the `dependencies` map from `<prefix>/package.json`.
 *
 * This is the manifest `air upgrade` rewrites, so it carries the version
 * range AIR itself wants for each extension even when `air.json` names the
 * package without one.
 */
function readPrefixDependencies(prefix: string): Record<string, string> {
  const manifestPath = join(prefix, "package.json");
  if (!existsSync(manifestPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const deps = parsed?.dependencies;
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) return {};
    const out: Record<string, string> = {};
    for (const [name, range] of Object.entries(
      deps as Record<string, unknown>
    )) {
      if (typeof range === "string") out[name] = range;
    }
    return out;
  } catch {
    return {};
  }
}

/** What {@link inspectPackage} concluded about one extension specifier. */
interface PackageState {
  /** True when the package is present *and* satisfies its declared range. */
  satisfied: boolean;
  /** The npm spec to install when `satisfied` is false. */
  installSpec: string;
  /** Set when the package is present but at a non-satisfying version. */
  mismatch?: ExtensionVersionMismatch;
}

/**
 * Decide whether an npm package under `prefix` is usable as-is.
 *
 * Presence alone is not enough: AIR publishes every package in the monorepo
 * off one shared version line, so a directory left behind by an install from
 * several releases ago is exactly the failure this check exists to catch. The
 * desired range comes from the specifier itself when it carries one, and
 * otherwise from `<prefix>/package.json` — the manifest `air upgrade` writes.
 *
 * When no range is known, or the range or installed version uses syntax
 * {@link satisfiesRange} does not model, this falls back to the historical
 * existence-only answer rather than reinstalling on a guess.
 */
function inspectPackage(
  specifier: string,
  prefix: string,
  declared: Record<string, string>
): PackageState {
  const name = stripVersion(specifier);

  if (!existsSync(join(prefix, "node_modules", name))) {
    return { satisfied: false, installSpec: specifier };
  }

  const fromSpecifier = specifierRange(specifier);
  const range = fromSpecifier ?? declared[name] ?? null;
  if (!range) return { satisfied: true, installSpec: specifier };

  const installedVersion = readInstalledVersion(name, prefix);
  if (!installedVersion) return { satisfied: true, installSpec: specifier };

  if (satisfiesRange(installedVersion, range) !== false) {
    return { satisfied: true, installSpec: specifier };
  }

  return {
    satisfied: false,
    // Honour the manifest's range rather than pulling @latest, so a reinstall
    // driven by package.json cannot silently widen what the user asked for.
    installSpec: fromSpecifier ? specifier : `${name}@${range}`,
    mismatch: {
      specifier,
      packageName: name,
      installedVersion,
      requiredRange: range,
      source: fromSpecifier ? "air.json" : "package.json",
    },
  };
}

/**
 * Run `npm install` asynchronously and return a promise.
 */
function npmInstall(
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "npm",
      ["install", ...args],
      { stdio: "pipe" } as Parameters<typeof execFile>[2],
      (err, stdout, stderr) => {
        if (err) {
          reject(
            Object.assign(err, {
              stdout: stdout?.toString() ?? "",
              stderr: stderr?.toString() ?? "",
            })
          );
        } else {
          resolve({
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
          });
        }
      }
    );
  });
}

/**
 * Install missing or out-of-range extensions declared in air.json.
 *
 * Reads the `extensions` array from air.json, checks which npm packages are
 * already present in node_modules at a version satisfying their declared
 * range, and installs the rest using `npm install` with the specified prefix.
 *
 * Local path extensions (starting with ./, ../, or /) are skipped since
 * they don't need npm installation.
 *
 * @throws Error if air.json is not found, or if npm install fails.
 */
export async function installExtensions(
  options?: InstallExtensionsOptions
): Promise<InstallExtensionsResult> {
  const airJsonPath = options?.config || getAirJsonPath();
  if (!airJsonPath) {
    throw new Error(
      "No air.json found. Specify a config path or set AIR_CONFIG env var."
    );
  }

  const airConfig = loadAirConfig(airJsonPath);
  const extensions = airConfig.extensions || [];

  if (extensions.length === 0) {
    return {
      alreadyInstalled: [],
      installed: [],
      skipped: [],
      mismatched: [],
    };
  }

  const prefix = options?.prefix
    ? resolve(options.prefix)
    : dirname(resolve(airJsonPath));
  const declared = readPrefixDependencies(prefix);

  const alreadyInstalled: string[] = [];
  const toInstall: string[] = [];
  const installSpecs: string[] = [];
  const skipped: string[] = [];
  const mismatched: ExtensionVersionMismatch[] = [];
  const seen = new Set<string>();

  for (const specifier of extensions) {
    if (typeof specifier !== "string") continue;
    if (seen.has(specifier)) continue;
    seen.add(specifier);

    if (isLocalPath(specifier)) {
      skipped.push(specifier);
      continue;
    }

    const state = inspectPackage(specifier, prefix, declared);
    if (state.satisfied) {
      alreadyInstalled.push(specifier);
      continue;
    }

    toInstall.push(specifier);
    installSpecs.push(state.installSpec);
    if (state.mismatch) mismatched.push(state.mismatch);
  }

  if (installSpecs.length > 0) {
    try {
      await npmInstall(["--prefix", prefix, ...installSpecs]);
    } catch (err) {
      const stderr =
        err instanceof Error && "stderr" in err
          ? String((err as { stderr: unknown }).stderr)
          : "";
      throw new Error(
        `npm install failed for: ${installSpecs.join(", ")}${stderr ? `\n${stderr}` : ""}`
      );
    }
  }

  return {
    alreadyInstalled,
    installed: toInstall,
    skipped,
    mismatched,
  };
}
