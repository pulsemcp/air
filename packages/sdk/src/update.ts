import { createRequire } from "module";
import { existsSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { pathToFileURL } from "url";
import {
  loadAirConfig,
  getAirJsonPath,
  getDefaultAirJsonPath,
  type CacheRefreshResult,
  type CatalogProvider,
  type AirExtension,
} from "@pulsemcp/air-core";
import { loadExtensions } from "./extension-loader.js";
import { resolveEsmEntry } from "./esm-resolve.js";

/**
 * Known provider packages, keyed by their cache directory name (scheme).
 * Used to auto-discover providers when air.json doesn't list them.
 */
const KNOWN_PROVIDERS: Record<string, string> = {
  github: "@pulsemcp/air-provider-github",
};

export interface UpdateProviderCachesOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
}

export interface UpdateProviderCachesResult {
  /** Results from each provider, keyed by provider scheme. */
  results: Record<string, CacheRefreshResult[]>;
}

/**
 * Get the AIR cache root directory (~/.air/cache).
 * Derived from getDefaultAirJsonPath() to stay in sync with core's
 * notion of the AIR home directory.
 */
function getCacheRoot(): string {
  return resolve(dirname(getDefaultAirJsonPath()), "cache");
}

/**
 * Scan ~/.air/cache/ for subdirectories, each representing a provider scheme
 * that has cached data on disk.
 */
function discoverCachedSchemes(): string[] {
  const cacheRoot = getCacheRoot();
  if (!existsSync(cacheRoot)) return [];

  try {
    return readdirSync(cacheRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Try to load a provider extension by package name, searching the given
 * directories for the installed package. Handles CJS, ESM-only, and
 * standard Node resolution.
 */
async function tryLoadProvider(
  packageName: string,
  searchDirs: string[]
): Promise<CatalogProvider | null> {
  for (const dir of searchDirs) {
    try {
      const req = createRequire(join(dir, "__placeholder.js"));
      const resolved = req.resolve(packageName);
      const mod = await import(pathToFileURL(resolved).href);
      return (mod.default as AirExtension)?.provider ?? null;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
        const esmEntry = resolveEsmEntry(packageName, dir);
        if (esmEntry) {
          try {
            const mod = await import(pathToFileURL(esmEntry).href);
            return (mod.default as AirExtension)?.provider ?? null;
          } catch {
            // Fall through to next directory
          }
        }
      }
      // Not found in this directory, try next
    }
  }

  // Fall back to standard Node resolution
  try {
    const mod = await import(packageName);
    return (mod.default as AirExtension)?.provider ?? null;
  } catch {
    return null;
  }
}

/**
 * Refresh all provider caches.
 *
 * Discovers providers in two ways:
 * 1. From air.json extensions (if air.json exists)
 * 2. By scanning ~/.air/cache/ for known provider cache directories
 *
 * This ensures cached data is refreshed even when the provider isn't
 * explicitly listed in air.json's extensions array.
 */
export async function updateProviderCaches(
  options?: UpdateProviderCachesOptions
): Promise<UpdateProviderCachesResult> {
  const airJsonPath = options?.config ?? getAirJsonPath();

  const providers = new Map<string, CatalogProvider>();
  let airJsonDir: string | null = null;

  // Load providers from air.json extensions if available
  if (airJsonPath) {
    airJsonDir = dirname(resolve(airJsonPath));
    const airConfig = loadAirConfig(airJsonPath);
    const loaded = await loadExtensions(airConfig.extensions || [], airJsonDir);

    for (const ext of loaded.providers) {
      const provider = ext.provider!;
      providers.set(provider.scheme, provider);
    }
  }

  // Discover additional providers from cache directory
  const cachedSchemes = discoverCachedSchemes();
  for (const scheme of cachedSchemes) {
    if (providers.has(scheme)) continue;

    const packageName = KNOWN_PROVIDERS[scheme];
    if (!packageName) continue;

    const searchDirs: string[] = [];
    if (airJsonDir) searchDirs.push(airJsonDir);
    const defaultAirDir = dirname(getDefaultAirJsonPath());
    if (defaultAirDir !== airJsonDir) searchDirs.push(defaultAirDir);

    const provider = await tryLoadProvider(packageName, searchDirs);
    if (provider?.refreshCache) {
      providers.set(scheme, provider);
    }
  }

  const results: Record<string, CacheRefreshResult[]> = {};

  for (const [scheme, provider] of providers) {
    if (!provider.refreshCache) continue;
    results[scheme] = await provider.refreshCache();
  }

  return { results };
}
