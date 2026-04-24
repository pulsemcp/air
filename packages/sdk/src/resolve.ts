import { dirname, resolve } from "path";
import {
  loadAirConfig,
  getAirJsonPath,
  resolveArtifacts,
  type ResolvedArtifacts,
} from "@pulsemcp/air-core";
import { loadExtensions } from "./extension-loader.js";

export interface ResolveFullArtifactsOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
  /**
   * Git protocol override for git-based catalog providers (e.g., github://).
   * Takes precedence over the `gitProtocol` field in air.json.
   */
  gitProtocol?: "ssh" | "https";
}

/**
 * Load the active air.json, load declared extensions to obtain catalog
 * providers (e.g., github://), and resolve the full merged artifact tree.
 *
 * This is the programmatic equivalent of `air resolve --json`: it mirrors
 * the provider wiring that `prepareSession` does, stopping after
 * `resolveArtifacts` returns. It does not load adapters, detect roots,
 * or touch the filesystem beyond reading artifact indexes.
 *
 * @throws Error if no air.json is found.
 */
export async function resolveFullArtifacts(
  options: ResolveFullArtifactsOptions = {}
): Promise<ResolvedArtifacts> {
  const airJsonPath = options.config ?? getAirJsonPath();
  if (!airJsonPath) {
    throw new Error(
      "No air.json found. Specify a config path or set AIR_CONFIG env var."
    );
  }

  const airJsonDir = dirname(resolve(airJsonPath));
  const airConfig = loadAirConfig(airJsonPath);
  const loaded = await loadExtensions(airConfig.extensions || [], airJsonDir);

  const providers = loaded.providers
    .map((ext) => ext.provider!)
    .filter(Boolean);
  const providerOptions: Record<string, unknown> = {};
  if (options.gitProtocol !== undefined) {
    providerOptions.gitProtocol = options.gitProtocol;
  }

  return resolveArtifacts(airJsonPath, { providers, providerOptions });
}
