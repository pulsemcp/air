import { createRequire } from "module";
import { join } from "path";
import { pathToFileURL } from "url";
import type { AgentAdapter, AirExtension } from "@pulsemcp/air-core";
import { resolveEsmEntry } from "./esm-resolve.js";

/**
 * Known adapter packages. The SDK tries to dynamically import each one.
 * If the package is installed, its adapter is available. If not, it's skipped.
 */
const KNOWN_ADAPTERS: { name: string; packageName: string }[] = [
  { name: "claude", packageName: "@pulsemcp/air-adapter-claude" },
];

export interface FindAdapterOptions {
  /**
   * Additional directories to search for adapter packages.
   * Typically the directory containing air.json (e.g. ~/.air/) so that
   * packages installed via `air install` are discoverable.
   */
  searchDirs?: string[];
}

/**
 * Try to import a package by name, optionally searching additional directories.
 * Returns the default export or null if the package isn't found.
 *
 * Uses createRequire for CJS packages and falls back to direct ESM entry
 * resolution for packages that only define `exports.import`.
 */
async function tryImportPackage(
  packageName: string,
  searchDirs?: string[]
): Promise<AirExtension | null> {
  // Try each search directory first (e.g. ~/.air/node_modules/)
  if (searchDirs) {
    for (const dir of searchDirs) {
      try {
        const req = createRequire(join(dir, "__placeholder.js"));
        const resolved = req.resolve(packageName);
        const mod = await import(pathToFileURL(resolved).href);
        return (mod.default as AirExtension) ?? null;
      } catch (err: unknown) {
        // For ESM-only packages, CJS resolution fails with
        // ERR_PACKAGE_PATH_NOT_EXPORTED. Try resolving the ESM entry directly.
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
          const esmEntry = resolveEsmEntry(packageName, dir);
          if (esmEntry) {
            try {
              const mod = await import(pathToFileURL(esmEntry).href);
              return (mod.default as AirExtension) ?? null;
            } catch {
              // Fall through to next directory or SDK-local
            }
          }
        }
        // Not found in this directory, try next
      }
    }
  }

  // Fall back to SDK-local resolution
  try {
    const mod = await import(packageName);
    return (mod.default as AirExtension) ?? null;
  } catch {
    return null;
  }
}

/**
 * Find an adapter by agent name.
 * Returns null if the adapter package isn't installed.
 *
 * Pass `searchDirs` to also look in directories outside the normal
 * Node resolution chain (e.g. the ~/.air/ directory where `air install`
 * places packages).
 */
export async function findAdapter(
  name: string,
  options?: FindAdapterOptions
): Promise<AgentAdapter | null> {
  const { searchDirs } = options ?? {};

  // Check known adapters first
  for (const known of KNOWN_ADAPTERS) {
    if (known.name === name) {
      const ext = await tryImportPackage(known.packageName, searchDirs);
      return ext?.adapter ?? null;
    }
  }

  // Try convention-based package name: @pulsemcp/air-adapter-{name}
  const ext = await tryImportPackage(
    `@pulsemcp/air-adapter-${name}`,
    searchDirs
  );
  return ext?.adapter ?? null;
}

/**
 * List all available adapter names (installed packages only).
 *
 * Pass `searchDirs` to also look in directories outside the normal
 * Node resolution chain.
 */
export async function listAvailableAdapters(
  options?: FindAdapterOptions
): Promise<string[]> {
  const { searchDirs } = options ?? {};
  const available: string[] = [];
  for (const known of KNOWN_ADAPTERS) {
    const ext = await tryImportPackage(known.packageName, searchDirs);
    if (ext) {
      available.push(known.name);
    }
  }
  return available;
}
