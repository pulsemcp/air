import type { AgentAdapter, AirExtension } from "@pulsemcp/air-core";

/**
 * Known adapter packages. The CLI tries to dynamically import each one.
 * If the package is installed, its adapter is available. If not, it's skipped.
 */
const KNOWN_ADAPTERS: { name: string; packageName: string }[] = [
  { name: "claude", packageName: "@pulsemcp/air-adapter-claude" },
];

/**
 * Find an adapter by agent name.
 * Returns null if the adapter package isn't installed.
 */
export async function findAdapter(
  name: string
): Promise<AgentAdapter | null> {
  // Check known adapters first
  for (const known of KNOWN_ADAPTERS) {
    if (known.name === name) {
      try {
        const mod = await import(known.packageName);
        const ext = mod.default as AirExtension | undefined;
        return ext?.adapter ?? null;
      } catch {
        return null;
      }
    }
  }

  // Try convention-based package name: @pulsemcp/air-adapter-{name}
  try {
    const mod = await import(`@pulsemcp/air-adapter-${name}`);
    const ext = mod.default as AirExtension | undefined;
    return ext?.adapter ?? null;
  } catch {
    return null;
  }
}

/**
 * List all available adapter names (installed packages only).
 */
export async function listAvailableAdapters(): Promise<string[]> {
  const available: string[] = [];
  for (const known of KNOWN_ADAPTERS) {
    try {
      await import(known.packageName);
      available.push(known.name);
    } catch {
      // Not installed
    }
  }
  return available;
}
