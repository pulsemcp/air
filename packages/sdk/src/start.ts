import {
  getAirJsonPath,
  resolveArtifacts,
  emptyArtifacts,
  type ResolvedArtifacts,
  type RootEntry,
  type AgentSessionConfig,
  type StartCommand,
} from "@pulsemcp/air-core";
import { findAdapter, listAvailableAdapters } from "./adapter-registry.js";

export interface StartSessionOptions {
  /** Root to activate by name. */
  root?: string;
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
  /** Check whether the agent CLI is installed. Defaults to true. */
  checkAvailability?: boolean;
}

export interface StartSessionResult {
  /** The resolved artifacts. */
  artifacts: ResolvedArtifacts;
  /** The matched root, if any. */
  root?: RootEntry;
  /** The generated session config. */
  sessionConfig: AgentSessionConfig;
  /** Whether the agent CLI is available on PATH. Undefined if checkAvailability was false. */
  agentAvailable: boolean | undefined;
  /** The command to start the agent. */
  startCommand: StartCommand;
  /** The agent adapter display name. */
  adapterDisplayName: string;
}

/**
 * Prepare to start an agent session.
 *
 * Resolves artifacts, finds the adapter, generates config, checks availability,
 * and builds the start command. Does NOT actually execute the agent.
 *
 * @throws Error if the adapter is not found or the specified root doesn't exist.
 */
export async function startSession(
  agent: string,
  options?: StartSessionOptions
): Promise<StartSessionResult> {
  const adapter = await findAdapter(agent);
  if (!adapter) {
    const available = await listAvailableAdapters();
    const availableMsg =
      available.length > 0
        ? `Available: ${available.join(", ")}`
        : "No adapters installed";
    throw new Error(
      `No adapter found for "${agent}". ${availableMsg}.\n` +
        `Install an adapter: npm install @pulsemcp/air-adapter-${agent}`
    );
  }

  const airJsonPath = options?.config || getAirJsonPath();
  const artifacts = airJsonPath
    ? await resolveArtifacts(airJsonPath)
    : emptyArtifacts();

  let root: RootEntry | undefined;
  if (options?.root) {
    root = artifacts.roots[options.root];
    if (!root) {
      throw new Error(
        `Root "${options.root}" not found. Available roots: ${Object.keys(artifacts.roots).join(", ") || "(none)"}`
      );
    }
  }

  const sessionConfig = adapter.generateConfig(artifacts, root);
  const agentAvailable = (options?.checkAvailability ?? true)
    ? await adapter.isAvailable()
    : undefined;
  const startCommand = adapter.buildStartCommand(sessionConfig);

  return {
    artifacts,
    root,
    sessionConfig,
    agentAvailable,
    startCommand,
    adapterDisplayName: adapter.displayName,
  };
}
