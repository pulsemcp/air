import { resolve, dirname } from "path";
import {
  getAirJsonPath,
  loadAirConfig,
  resolveArtifacts,
  resolveReference,
  emptyArtifacts,
  type ResolvedArtifacts,
  type RootEntry,
  type AgentSessionConfig,
  type StartCommand,
  type LocalArtifacts,
} from "@pulsemcp/air-core";
import { findAdapter, listAvailableAdapters } from "./adapter-registry.js";
import { loadExtensions } from "./extension-loader.js";
import { checkProviderFreshness } from "./cache-freshness.js";

export interface StartSessionOptions {
  /** Root to activate by name. */
  root?: string;
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
  /** Check whether the agent CLI is installed. Defaults to true. */
  checkAvailability?: boolean;
  /**
   * Git protocol override for git-based catalog providers. Takes precedence
   * over the `gitProtocol` field in air.json.
   */
  gitProtocol?: "ssh" | "https";
  /**
   * Directory to scan for adapter-owned local artifacts (e.g. skills
   * checked into `.claude/skills/`). Defaults to `process.cwd()`. Set to
   * `null` to skip the local scan entirely.
   */
  localScanDir?: string | null;
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
  /** Warnings from provider cache freshness checks (e.g., stale GitHub clones). */
  warnings?: string[];
  /**
   * Artifacts discovered in the target directory outside of AIR's
   * management (e.g. skills checked into `.claude/skills/`). Populated
   * when the adapter implements `listLocalArtifacts` and `localScanDir`
   * is not set to `null`.
   */
  localArtifacts?: LocalArtifacts;
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
  const airJsonPath = options?.config || getAirJsonPath();
  const airJsonDir = airJsonPath ? dirname(resolve(airJsonPath)) : undefined;
  const searchDirs = airJsonDir ? [airJsonDir] : undefined;

  // Load extensions first so extension-provided adapters are found
  let artifacts: ResolvedArtifacts;
  let adapter = null;

  let warnings: string[] = [];

  if (airJsonPath) {
    const airConfig = loadAirConfig(airJsonPath);
    const loaded = await loadExtensions(
      airConfig.extensions || [],
      airJsonDir!
    );

    // Check extension-provided adapters first
    adapter =
      loaded.adapters.find((ext) => ext.adapter?.name === agent)?.adapter ??
      null;

    const providers = loaded.providers
      .map((ext) => ext.provider!)
      .filter(Boolean);
    const providerOptions: Record<string, unknown> = {};
    if (options?.gitProtocol !== undefined) {
      providerOptions.gitProtocol = options.gitProtocol;
    }
    artifacts = await resolveArtifacts(airJsonPath, {
      providers,
      providerOptions,
    });

    // Check freshness of provider caches (non-blocking — warnings only)
    warnings = await checkProviderFreshness(airConfig, providers);
  } else {
    artifacts = emptyArtifacts();
  }

  // Fall back to registry lookup with search dirs
  if (!adapter) {
    adapter = await findAdapter(agent, { searchDirs });
  }
  if (!adapter) {
    const available = await listAvailableAdapters({ searchDirs });
    const availableMsg =
      available.length > 0
        ? `Available: ${available.join(", ")}`
        : "No adapters installed";
    throw new Error(
      `No adapter found for "${agent}". ${availableMsg}.\n` +
        `Install an adapter: npm install @pulsemcp/air-adapter-${agent}`
    );
  }

  let root: RootEntry | undefined;
  if (options?.root) {
    const res = resolveReference(artifacts.roots, options.root, undefined);
    if (res.status === "missing") {
      throw new Error(
        `Root "${options.root}" not found. Available roots: ${Object.keys(artifacts.roots).join(", ") || "(none)"}`
      );
    }
    if (res.status === "ambiguous") {
      throw new Error(
        `Root "${options.root}" is ambiguous across scopes — candidates: ` +
          `${res.candidates.join(", ")}. Use the qualified form to disambiguate.`
      );
    }
    root = artifacts.roots[res.qualified];
  }

  const sessionConfig = adapter.generateConfig(artifacts, root);
  const agentAvailable = (options?.checkAvailability ?? true)
    ? await adapter.isAvailable()
    : undefined;
  const startCommand = adapter.buildStartCommand(sessionConfig);

  let localArtifacts: LocalArtifacts | undefined;
  if (options?.localScanDir !== null && adapter.listLocalArtifacts) {
    const scanDir = options?.localScanDir ?? process.cwd();
    try {
      localArtifacts = await adapter.listLocalArtifacts(scanDir);
    } catch {
      // Best-effort scan — a failure here must not break session startup.
    }
  }

  return {
    artifacts,
    root,
    sessionConfig,
    agentAvailable,
    startCommand,
    adapterDisplayName: adapter.displayName,
    warnings: warnings.length > 0 ? warnings : undefined,
    localArtifacts,
  };
}
