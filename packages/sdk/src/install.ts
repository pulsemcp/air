import { resolve, dirname, join } from "path";
import { existsSync } from "fs";
import { execFile } from "child_process";
import { loadAirConfig, getAirJsonPath } from "@pulsemcp/air-core";

export interface InstallExtensionsOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
  /** npm install prefix (--prefix). Defaults to the directory containing air.json. */
  prefix?: string;
}

export interface InstallExtensionsResult {
  /** Extensions that were already installed. */
  alreadyInstalled: string[];
  /** Extensions that were installed by this call. */
  installed: string[];
  /** Extensions that were skipped (local paths, not npm packages). */
  skipped: string[];
}

/**
 * Strip a version suffix from an npm specifier for node_modules lookup.
 * E.g., "@scope/pkg@1.2.3" → "@scope/pkg", "pkg@^2.0.0" → "pkg".
 * Bare specifiers without a version are returned unchanged.
 */
function stripVersion(specifier: string): string {
  // Scoped: @scope/name@version → split on the second @
  if (specifier.startsWith("@")) {
    const slashIdx = specifier.indexOf("/");
    if (slashIdx !== -1) {
      const afterSlash = specifier.slice(slashIdx + 1);
      const atIdx = afterSlash.indexOf("@");
      if (atIdx !== -1) {
        return specifier.slice(0, slashIdx + 1 + atIdx);
      }
    }
    return specifier;
  }
  // Unscoped: name@version → split on first @
  const atIdx = specifier.indexOf("@");
  if (atIdx > 0) {
    return specifier.slice(0, atIdx);
  }
  return specifier;
}

/**
 * Check if an npm package is installed under a given prefix.
 *
 * Checks for the package directory in `<prefix>/node_modules/<name>`.
 * Strips version suffixes from the specifier before checking.
 * This works for both CJS and ESM-only packages, unlike `require.resolve`
 * which fails for packages that only export `import` conditions.
 */
function isPackageInstalled(specifier: string, prefix: string): boolean {
  const name = stripVersion(specifier);
  return existsSync(join(prefix, "node_modules", name));
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
 * Install missing extensions declared in air.json.
 *
 * Reads the `extensions` array from air.json, checks which npm packages
 * are already present in node_modules, and installs any missing ones
 * using `npm install` with the specified prefix.
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
  const seen = new Set<string>();

  for (const specifier of extensions) {
    if (typeof specifier !== "string") continue;
    if (seen.has(specifier)) continue;
    seen.add(specifier);

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
      await npmInstall(["--prefix", prefix, ...toInstall]);
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
