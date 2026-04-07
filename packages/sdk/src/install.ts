import { resolve, dirname, join } from "path";
import { existsSync } from "fs";
import { execFileSync } from "child_process";
import { loadAirConfig, getAirJsonPath } from "@pulsemcp/air-core";

export interface InstallExtensionsOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
  /** npm install prefix (--prefix). Defaults to the directory containing air.json. */
  prefix?: string;
}

export interface InstallExtensionsResult {
  /** Extensions that were already installed (resolvable). */
  alreadyInstalled: string[];
  /** Extensions that were newly installed by this call. */
  installed: string[];
  /** Extensions that were skipped (local paths, not npm packages). */
  skipped: string[];
}

/**
 * Check if an npm package is installed under a given prefix.
 *
 * Checks for the package directory in `<prefix>/node_modules/<specifier>`.
 * This works for both CJS and ESM-only packages, unlike `require.resolve`
 * which fails for packages that only export `import` conditions.
 */
function isPackageInstalled(specifier: string, prefix: string): boolean {
  return existsSync(join(prefix, "node_modules", specifier));
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
 * Install missing extensions declared in air.json.
 *
 * Reads the `extensions` array from air.json, checks which npm packages
 * are already resolvable, and installs any missing ones using `npm install`
 * with the specified prefix.
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
    return { alreadyInstalled: [], installed: [], skipped: [] };
  }

  const prefix = options?.prefix
    ? resolve(options.prefix)
    : dirname(resolve(airJsonPath));

  const alreadyInstalled: string[] = [];
  const toInstall: string[] = [];
  const skipped: string[] = [];

  for (const specifier of extensions) {
    if (isLocalPath(specifier)) {
      skipped.push(specifier);
      continue;
    }

    if (isPackageInstalled(specifier, prefix)) {
      alreadyInstalled.push(specifier);
    } else {
      toInstall.push(specifier);
    }
  }

  if (toInstall.length > 0) {
    try {
      execFileSync("npm", ["install", "--prefix", prefix, ...toInstall], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      const stderr =
        err instanceof Error && "stderr" in err
          ? String((err as { stderr: unknown }).stderr)
          : "";
      throw new Error(
        `npm install failed for: ${toInstall.join(", ")}${stderr ? `\n${stderr}` : ""}`
      );
    }
  }

  return {
    alreadyInstalled,
    installed: toInstall,
    skipped,
  };
}
