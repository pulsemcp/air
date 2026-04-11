import { dirname, resolve } from "path";
import {
  loadAirConfig,
  getAirJsonPath,
  type CacheRefreshResult,
} from "@pulsemcp/air-core";
import { loadExtensions } from "./extension-loader.js";

export interface UpdateProviderCachesOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
}

export interface UpdateProviderCachesResult {
  /** Results from each provider, keyed by provider scheme. */
  results: Record<string, CacheRefreshResult[]>;
}

/**
 * Refresh all provider caches.
 *
 * Loads extensions from air.json, finds providers that implement
 * refreshCache(), and calls them. Returns structured results.
 *
 * @throws Error if air.json is not found.
 */
export async function updateProviderCaches(
  options?: UpdateProviderCachesOptions
): Promise<UpdateProviderCachesResult> {
  const airJsonPath = options?.config ?? getAirJsonPath();
  if (!airJsonPath) {
    throw new Error(
      "No air.json found. Specify a config path or set AIR_CONFIG env var."
    );
  }

  const airJsonDir = dirname(resolve(airJsonPath));
  const airConfig = loadAirConfig(airJsonPath);
  const loaded = await loadExtensions(airConfig.extensions || [], airJsonDir);

  const results: Record<string, CacheRefreshResult[]> = {};

  for (const ext of loaded.providers) {
    const provider = ext.provider!;
    if (!provider.refreshCache) continue;

    results[provider.scheme] = await provider.refreshCache();
  }

  return { results };
}
