import { resolve } from "path";
import {
  getAirJsonPath,
  resolveArtifacts,
  type RootEntry,
  type PreparedSession,
} from "@pulsemcp/air-core";
import { findAdapter, listAvailableAdapters } from "./adapter-registry.js";
import { detectRoot } from "./root-detection.js";

export interface PrepareSessionOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
  /** Root to activate by name. Auto-detected from targetDir's git context if omitted. */
  root?: string;
  /** Target directory to prepare. Defaults to process.cwd(). */
  target?: string;
  /** Agent adapter name. Defaults to "claude". */
  adapter?: string;
  /** Skill IDs to activate (overrides root defaults). */
  skills?: string[];
  /** MCP server IDs to activate (overrides root defaults). */
  mcpServers?: string[];
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
 * Resolves artifacts, finds/auto-detects the root, and delegates to the adapter's
 * prepareSession() to write .mcp.json, inject skills, etc.
 *
 * @throws Error if the adapter is not found, air.json is not found, or the specified root doesn't exist.
 */
export async function prepareSession(
  options?: PrepareSessionOptions
): Promise<PrepareSessionResult> {
  const adapterName = options?.adapter ?? "claude";
  const adapter = await findAdapter(adapterName);
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

  const airJsonPath = options?.config ?? getAirJsonPath();
  if (!airJsonPath) {
    throw new Error(
      "No air.json found. Specify a config path or set AIR_CONFIG env var."
    );
  }

  const artifacts = await resolveArtifacts(airJsonPath);

  let root: RootEntry | undefined;
  let rootAutoDetected = false;

  if (options?.root) {
    root = artifacts.roots[options.root];
    if (!root) {
      throw new Error(
        `Root "${options.root}" not found. Available roots: ${Object.keys(artifacts.roots).join(", ") || "(none)"}`
      );
    }
  } else {
    const targetDir = resolve(options?.target ?? process.cwd());
    root = detectRoot(artifacts.roots, targetDir);
    if (root) {
      rootAutoDetected = true;
    }
  }

  const session = await adapter.prepareSession(
    artifacts,
    options?.target ?? process.cwd(),
    {
      root,
      skillOverrides: options?.skills,
      mcpServerOverrides: options?.mcpServers,
    }
  );

  return { session, root, rootAutoDetected };
}
