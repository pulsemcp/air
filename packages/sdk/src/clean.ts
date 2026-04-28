import { resolve, dirname } from "path";
import {
  getAirJsonPath,
  loadAirConfig,
  type CleanSessionResult,
} from "@pulsemcp/air-core";
import { findAdapter, listAvailableAdapters } from "./adapter-registry.js";
import { loadExtensions } from "./extension-loader.js";

export interface CleanSessionOptions {
  /** Agent adapter name (e.g., "claude"). */
  adapter: string;
  /** Target directory whose AIR-managed artifacts should be removed. Defaults to process.cwd(). */
  target?: string;
  /**
   * Path to air.json. Used only to locate adapter packages installed under
   * `~/.air/node_modules/`. The clean operation itself does not require an
   * air.json — it reads the on-disk manifest. Uses AIR_CONFIG env or
   * `~/.air/air.json` when omitted; if no air.json exists, adapter
   * resolution falls back to the SDK's normal Node module search.
   */
  config?: string;
  /** Print what would be removed without modifying disk. */
  dryRun?: boolean;
  /** Skip skill removal — manifest entry for skills is preserved. */
  keepSkills?: boolean;
  /** Skip hook removal — manifest entry for hooks is preserved. */
  keepHooks?: boolean;
  /** Skip MCP server removal — manifest entry for MCP servers is preserved. */
  keepMcpServers?: boolean;
}

export interface CleanSessionSdkResult extends CleanSessionResult {
  /** Display name of the adapter that performed the clean. */
  adapterDisplayName: string;
}

/**
 * Remove every artifact AIR has previously written to a target directory.
 *
 * Resolves the adapter (from extensions if an air.json is available, then
 * from the adapter registry) and delegates to its `cleanSession()` method.
 * Throws a clear error when the adapter is not installed or doesn't
 * implement `cleanSession`.
 */
export async function cleanSession(
  options: CleanSessionOptions
): Promise<CleanSessionSdkResult> {
  const targetDir = resolve(options.target ?? process.cwd());

  const airJsonPath = options.config ?? getAirJsonPath();
  const airJsonDir = airJsonPath ? dirname(resolve(airJsonPath)) : undefined;
  const searchDirs = airJsonDir ? [airJsonDir] : undefined;

  let adapter =
    airJsonPath && airJsonDir
      ? await findAdapterFromAirJson(options.adapter, airJsonPath, airJsonDir)
      : null;
  if (!adapter) {
    adapter = await findAdapter(options.adapter, { searchDirs });
  }
  if (!adapter) {
    const available = await listAvailableAdapters({ searchDirs });
    const availableMsg =
      available.length > 0
        ? `Available: ${available.join(", ")}`
        : "No adapters installed";
    throw new Error(
      `No adapter found for "${options.adapter}". ${availableMsg}.\n` +
        `Install an adapter: npm install @pulsemcp/air-adapter-${options.adapter}`
    );
  }

  if (!adapter.cleanSession) {
    throw new Error(
      `Adapter "${options.adapter}" does not support clean. ` +
        `Update the adapter package or remove AIR-managed files manually.`
    );
  }

  const result = await adapter.cleanSession(targetDir, {
    dryRun: options.dryRun,
    keepSkills: options.keepSkills,
    keepHooks: options.keepHooks,
    keepMcpServers: options.keepMcpServers,
  });

  return { ...result, adapterDisplayName: adapter.displayName };
}

async function findAdapterFromAirJson(
  name: string,
  airJsonPath: string,
  airJsonDir: string
) {
  try {
    const airConfig = loadAirConfig(airJsonPath);
    if (!airConfig.extensions?.length) return null;
    const loaded = await loadExtensions(airConfig.extensions, airJsonDir);
    return loaded.adapters.find((ext) => ext.adapter?.name === name)?.adapter ?? null;
  } catch {
    return null;
  }
}
