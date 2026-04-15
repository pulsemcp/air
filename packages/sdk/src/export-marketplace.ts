import { dirname, resolve } from "path";
import {
  loadAirConfig,
  getAirJsonPath,
  resolveArtifacts,
  type BuiltMarketplace,
} from "@pulsemcp/air-core";
import { loadExtensions, type LoadedExtensions } from "./extension-loader.js";

export interface ExportMarketplaceOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
  /** Target emitter name (e.g., "cowork"). Required. */
  emitter: string;
  /** Output directory for the marketplace. Required. */
  output: string;
  /** Plugin IDs to export. If omitted, exports all defined plugins. */
  plugins?: string[];
  /** Override the marketplace display name. */
  marketplaceName?: string;
  /** Override the marketplace description. */
  marketplaceDescription?: string;
  /** Marketplace owner (required by some formats, e.g. Claude Co-work). */
  marketplaceOwner?: { name: string; email?: string };
  /** Pre-loaded extensions (avoids double loading when CLI has already loaded them). */
  extensions?: LoadedExtensions;
}

export interface ExportMarketplaceResult {
  /** The built marketplace result from the emitter. */
  marketplace: BuiltMarketplace;
}

export async function exportMarketplace(
  options: ExportMarketplaceOptions
): Promise<ExportMarketplaceResult> {
  const airJsonPath = options.config ?? getAirJsonPath();
  if (!airJsonPath) {
    throw new Error(
      "No air.json found. Specify a config path or set AIR_CONFIG env var."
    );
  }

  const airJsonDir = dirname(resolve(airJsonPath));

  let loaded: LoadedExtensions;
  if (options.extensions) {
    loaded = options.extensions;
  } else {
    const airConfig = loadAirConfig(airJsonPath);
    loaded = await loadExtensions(airConfig.extensions || [], airJsonDir);
  }

  const emitter = loaded.emitters.find(
    (ext) => ext.emitter?.name === options.emitter
  )?.emitter;
  if (!emitter) {
    const available = loaded.emitters
      .map((ext) => ext.emitter!.name)
      .filter(Boolean);
    const availableMsg =
      available.length > 0
        ? `Available: ${available.join(", ")}`
        : "No emitters installed";
    throw new Error(
      `No emitter found for "${options.emitter}". ${availableMsg}.`
    );
  }

  const providers = loaded.providers
    .map((ext) => ext.provider!)
    .filter(Boolean);
  const artifacts = await resolveArtifacts(airJsonPath, { providers });

  const pluginIds =
    options.plugins ?? Object.keys(artifacts.plugins);

  if (pluginIds.length === 0) {
    throw new Error("No plugins to export. Define plugins in your air.json.");
  }

  const marketplace = await emitter.buildMarketplace(
    artifacts,
    pluginIds,
    resolve(options.output),
    {
      marketplaceName: options.marketplaceName,
      marketplaceDescription: options.marketplaceDescription,
      marketplaceOwner: options.marketplaceOwner,
    }
  );

  return { marketplace };
}
