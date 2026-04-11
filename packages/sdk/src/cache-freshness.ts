import type { AirConfig, CatalogProvider } from "@pulsemcp/air-core";

/**
 * Collect all URI paths from an air.json config and check their freshness
 * against the providers that handle them. Returns warning strings.
 *
 * This is best-effort: network failures or missing checkFreshness
 * implementations are silently ignored.
 */
export async function checkProviderFreshness(
  airConfig: AirConfig,
  providers: CatalogProvider[]
): Promise<string[]> {
  // Collect all paths from artifact arrays
  const allPaths = [
    ...(airConfig.skills || []),
    ...(airConfig.references || []),
    ...(airConfig.mcp || []),
    ...(airConfig.plugins || []),
    ...(airConfig.roots || []),
    ...(airConfig.hooks || []),
  ];

  // Group URIs by provider scheme
  const urisByScheme = new Map<string, string[]>();
  for (const p of allPaths) {
    const match = p.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):\/\//);
    if (!match) continue;
    const scheme = match[1].toLowerCase();
    if (scheme === "file") continue;
    const list = urisByScheme.get(scheme) || [];
    list.push(p);
    urisByScheme.set(scheme, list);
  }

  const warnings: string[] = [];

  for (const provider of providers) {
    if (!provider.checkFreshness) continue;
    const uris = urisByScheme.get(provider.scheme);
    if (!uris || uris.length === 0) continue;

    try {
      const freshnessWarnings = await provider.checkFreshness(uris);
      for (const w of freshnessWarnings) {
        warnings.push(w.message);
      }
    } catch {
      // Freshness check is best-effort — never block on failure
    }
  }

  return warnings;
}
