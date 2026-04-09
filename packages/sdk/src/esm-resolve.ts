import { readFileSync } from "fs";
import { join, resolve } from "path";

/**
 * Resolve the ESM entry point for a package installed in `dir/node_modules/`.
 *
 * Reads the package's `package.json` and inspects the `exports` and `module`
 * fields to find a usable ESM entry point. Handles:
 * - `exports` as a bare string
 * - `exports["."].import` as a string or `{ default: "..." }` object
 * - `exports.import` as a string or `{ default: "..." }` object
 * - `module` field fallback
 *
 * @returns Absolute path to the ESM entry file, or `null` if not resolvable.
 */
export function resolveEsmEntry(
  packageName: string,
  dir: string
): string | null {
  try {
    const packageDir = join(dir, "node_modules", packageName);
    const pkgJson = JSON.parse(
      readFileSync(join(packageDir, "package.json"), "utf-8")
    );

    const exports = pkgJson.exports;
    let entry: string | undefined;

    if (typeof exports === "string") {
      entry = exports;
    } else if (exports?.["."]?.import) {
      const imp = exports["."].import;
      entry = typeof imp === "string" ? imp : imp?.default;
    } else if (exports?.import) {
      const imp = exports.import;
      entry = typeof imp === "string" ? imp : imp?.default;
    } else if (pkgJson.module) {
      entry = pkgJson.module;
    }

    if (entry) {
      return resolve(packageDir, entry);
    }
    return null;
  } catch {
    return null;
  }
}
