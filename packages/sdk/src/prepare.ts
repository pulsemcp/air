import { resolve, dirname } from "path";
import {
  loadAirConfig,
  getAirJsonPath,
  resolveArtifacts,
  type RootEntry,
  type PreparedSession,
} from "@pulsemcp/air-core";
import { findAdapter, listAvailableAdapters } from "./adapter-registry.js";
import { detectRoot } from "./root-detection.js";
import { loadExtensions, type LoadedExtensions } from "./extension-loader.js";
import { runTransforms } from "./transform-runner.js";
import { readFileSync } from "fs";
import type { McpConfig } from "@pulsemcp/air-core";
import {
  findUnresolvedVars,
  unresolvedVarsMessage,
} from "./validate-config.js";

export interface PrepareSessionOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
  /** Root to activate by name. Auto-detected from targetDir's git context if omitted. */
  root?: string;
  /** Target directory to prepare. Defaults to process.cwd(). */
  target?: string;
  /** Agent adapter name (e.g., "claude"). Required. */
  adapter: string;
  /** Skill IDs to activate (overrides root defaults). */
  skills?: string[];
  /** MCP server IDs to activate (overrides root defaults). */
  mcpServers?: string[];
  /**
   * Skip merging subagent roots' artifacts into the parent session.
   * Orchestrators that manage subagent composition externally should set this.
   */
  skipSubagentMerge?: boolean;
  /**
   * Parsed CLI option values contributed by extensions.
   * Passed through to transforms via TransformContext.options.
   */
  extensionOptions?: Record<string, unknown>;
  /**
   * Skip the final validation that checks for unresolved ${VAR} patterns.
   * Use when partial resolution is intentional (e.g., orchestrators that
   * resolve remaining variables themselves).
   */
  skipValidation?: boolean;
  /**
   * Pre-loaded extensions. When provided, the SDK skips loading extensions
   * from air.json — useful when the CLI has already loaded them to discover
   * contributed CLI options.
   */
  extensions?: LoadedExtensions;
}

export interface PrepareSessionResult {
  /** The prepared session result from the adapter. */
  session: PreparedSession;
  /** The auto-detected or specified root, if any. */
  root?: RootEntry;
  /** Whether the root was auto-detected (true) or explicitly specified (false/undefined). */
  rootAutoDetected?: boolean;
}

/**
 * Prepare a target directory for an agent session.
 *
 * Loads extensions from air.json, resolves artifacts (using providers from
 * extensions), delegates to the adapter's prepareSession() to write .mcp.json
 * and inject skills, then runs transforms in declaration order.
 *
 * @throws Error if the adapter is not found, air.json is not found, or the specified root doesn't exist.
 */
export async function prepareSession(
  options: PrepareSessionOptions
): Promise<PrepareSessionResult> {
  const airJsonPath = options.config ?? getAirJsonPath();
  if (!airJsonPath) {
    throw new Error(
      "No air.json found. Specify a config path or set AIR_CONFIG env var."
    );
  }

  // Use pre-loaded extensions or load from air.json
  let loaded: LoadedExtensions;
  if (options.extensions) {
    loaded = options.extensions;
  } else {
    const airConfig = loadAirConfig(airJsonPath);
    const airJsonDir = dirname(resolve(airJsonPath));
    loaded = await loadExtensions(airConfig.extensions || [], airJsonDir);
  }

  // Find adapter: prefer extension-provided, fall back to registry
  const adapterName = options.adapter;
  let adapter =
    loaded.adapters.find((ext) => ext.adapter?.name === adapterName)?.adapter ??
    null;
  if (!adapter) {
    adapter = await findAdapter(adapterName);
  }
  if (!adapter) {
    const available = await listAvailableAdapters();
    const availableMsg =
      available.length > 0
        ? `Available: ${available.join(", ")}`
        : "No adapters installed";
    throw new Error(
      `No adapter found for "${adapterName}". ${availableMsg}.`
    );
  }

  // Extract providers from extensions and resolve artifacts
  const providers = loaded.providers
    .map((ext) => ext.provider!)
    .filter(Boolean);
  const artifacts = await resolveArtifacts(airJsonPath, { providers });

  // Detect or validate root
  let root: RootEntry | undefined;
  let rootAutoDetected = false;

  if (options.root) {
    root = artifacts.roots[options.root];
    if (!root) {
      throw new Error(
        `Root "${options.root}" not found. Available roots: ${Object.keys(artifacts.roots).join(", ") || "(none)"}`
      );
    }
  } else {
    const targetDir = resolve(options.target ?? process.cwd());
    root = detectRoot(artifacts.roots, targetDir);
    if (root) {
      rootAutoDetected = true;
    }
  }

  // Adapter writes .mcp.json and injects skills (no secret resolution)
  const session = await adapter.prepareSession(
    artifacts,
    options.target ?? process.cwd(),
    {
      root,
      skillOverrides: options.skills,
      mcpServerOverrides: options.mcpServers,
      skipSubagentMerge: options.skipSubagentMerge,
    }
  );

  // Run transforms in extension-list order on the written .mcp.json
  const mcpConfigPath = session.configFiles.find((f) =>
    f.endsWith(".mcp.json")
  );

  if (loaded.transforms.length > 0 && mcpConfigPath) {
    await runTransforms({
      transforms: loaded.transforms,
      mcpConfigPath,
      targetDir: options.target ?? process.cwd(),
      root,
      artifacts,
      extensionOptions: options.extensionOptions ?? {},
    });
  }

  // Final validation: ensure no unresolved ${VAR} patterns remain
  if (!options.skipValidation && mcpConfigPath) {
    const config: McpConfig = JSON.parse(
      readFileSync(mcpConfigPath, "utf-8")
    );
    const unresolved = findUnresolvedVars(config);
    if (unresolved.length > 0) {
      throw new Error(unresolvedVarsMessage(mcpConfigPath, unresolved));
    }
  }

  return { session, root, rootAutoDetected };
}
