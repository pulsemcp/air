import { resolve, dirname } from "path";
import {
  getAirJsonPath,
  loadAirConfig,
  loadManifest,
  getManifestPath,
  type CleanSessionResult,
} from "@pulsemcp/air-core";
import { existsSync } from "fs";
import { findAdapter, listAvailableAdapters } from "./adapter-registry.js";
import { loadExtensions } from "./extension-loader.js";

export interface CleanSessionOptions {
  /**
   * Agent adapter name (e.g., "claude"). When omitted, the adapter is read
   * from the on-disk manifest written by the previous `prepareSession`. Pass
   * an explicit value only to override that lookup.
   */
  adapter?: string;
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
  options: CleanSessionOptions = {}
): Promise<CleanSessionSdkResult> {
  const targetDir = resolve(options.target ?? process.cwd());

  const adapterName = options.adapter ?? inferAdapterFromManifest(targetDir);
  if (!adapterName) {
    const manifestPath = getManifestPath(targetDir);
    if (existsSync(manifestPath)) {
      throw new Error(
        `Manifest at ${manifestPath} does not record which adapter wrote it ` +
          `(written by an older AIR version). Re-run with the adapter name, ` +
          `e.g. \`air clean claude\`.`
      );
    }
    throw new Error(
      `No AIR manifest found for ${targetDir} (looked for ${manifestPath}). ` +
        `Run \`air prepare <adapter>\` first, or pass the adapter name explicitly: ` +
        `\`air clean <adapter>\`.`
    );
  }

  const airJsonPath = options.config ?? getAirJsonPath();
  const airJsonDir = airJsonPath ? dirname(resolve(airJsonPath)) : undefined;
  const searchDirs = airJsonDir ? [airJsonDir] : undefined;

  let adapter =
    airJsonPath && airJsonDir
      ? await findAdapterFromAirJson(adapterName, airJsonPath, airJsonDir)
      : null;
  if (!adapter) {
    adapter = await findAdapter(adapterName, { searchDirs });
  }
  if (!adapter) {
    const available = await listAvailableAdapters({ searchDirs });
    const availableMsg =
      available.length > 0
        ? `Available: ${available.join(", ")}`
        : "No adapters installed";
    throw new Error(
      `No adapter found for "${adapterName}". ${availableMsg}.\n` +
        `Install an adapter: npm install @pulsemcp/air-adapter-${adapterName}`
    );
  }

  if (!adapter.cleanSession) {
    throw new Error(
      `Adapter "${adapterName}" does not support clean. ` +
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

/**
 * Read the prior-run manifest for `targetDir` and return the adapter name it
 * records. Returns null when no manifest exists, the manifest is corrupt, or
 * it predates the adapter field.
 */
function inferAdapterFromManifest(targetDir: string): string | null {
  const manifest = loadManifest(targetDir);
  return manifest?.adapter ?? null;
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
