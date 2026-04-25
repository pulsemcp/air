import { resolve, dirname } from "path";
import {
  loadAirConfig,
  getAirJsonPath,
  resolveArtifacts,
  resolveReference,
  type ResolvedArtifacts,
  type RootEntry,
  type PreparedSession,
  type McpConfig,
} from "@pulsemcp/air-core";
import { findAdapter, listAvailableAdapters } from "./adapter-registry.js";
import { detectRoot } from "./root-detection.js";
import { loadExtensions, type LoadedExtensions } from "./extension-loader.js";
import { runTransforms } from "./transform-runner.js";
import { checkProviderFreshness } from "./cache-freshness.js";
import { existsSync, readFileSync } from "fs";
import {
  findUnresolvedVars,
  findUnresolvedHookVars,
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
  /** Hook IDs to activate (overrides root defaults). */
  hooks?: string[];
  /** Plugin IDs to activate (overrides root defaults). */
  plugins?: string[];
  /** Skill IDs to add on top of (merged) root defaults. */
  addSkills?: string[];
  /** MCP server IDs to add on top of (merged) root defaults. */
  addMcpServers?: string[];
  /** Hook IDs to add on top of (merged) root defaults. */
  addHooks?: string[];
  /** Plugin IDs to add on top of (merged) root defaults. */
  addPlugins?: string[];
  /** Skill IDs to remove from (merged) root defaults. */
  removeSkills?: string[];
  /** MCP server IDs to remove from (merged) root defaults. */
  removeMcpServers?: string[];
  /** Hook IDs to remove from (merged) root defaults. */
  removeHooks?: string[];
  /** Plugin IDs to remove from (merged) root defaults. */
  removePlugins?: string[];
  /**
   * Start from an empty set instead of root defaults when computing additions
   * and removals. Use to opt out of all root-declared defaults (including
   * subagent-root unions) and activate only the artifacts explicitly added.
   */
  withoutDefaults?: boolean;
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
  /**
   * Git protocol override for git-based catalog providers (e.g., github://).
   * Takes precedence over the `gitProtocol` field in air.json. Typical
   * sources: a CLI flag or programmatic opt-in to HTTPS.
   */
  gitProtocol?: "ssh" | "https";
}

export interface PrepareSessionResult {
  /** The prepared session result from the adapter. */
  session: PreparedSession;
  /** The auto-detected or specified root, if any. */
  root?: RootEntry;
  /** Whether the root was auto-detected (true) or explicitly specified (false/undefined). */
  rootAutoDetected?: boolean;
  /** Warnings from provider cache freshness checks (e.g., stale GitHub clones). */
  warnings?: string[];
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

  const airJsonDir = dirname(resolve(airJsonPath));
  const searchDirs = [airJsonDir];

  // Load air.json config (needed for extensions and freshness checks)
  const airConfig = loadAirConfig(airJsonPath);

  // Use pre-loaded extensions or load from air.json
  let loaded: LoadedExtensions;
  if (options.extensions) {
    loaded = options.extensions;
  } else {
    loaded = await loadExtensions(airConfig.extensions || [], airJsonDir);
  }

  // Find adapter: prefer extension-provided, fall back to registry
  const adapterName = options.adapter;
  let adapter =
    loaded.adapters.find((ext) => ext.adapter?.name === adapterName)?.adapter ??
    null;
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
      `No adapter found for "${adapterName}". ${availableMsg}.`
    );
  }

  // Extract providers from extensions and resolve artifacts
  const providers = loaded.providers
    .map((ext) => ext.provider!)
    .filter(Boolean);
  const providerOptions: Record<string, unknown> = {};
  if (options.gitProtocol !== undefined) {
    providerOptions.gitProtocol = options.gitProtocol;
  }
  const artifacts = await resolveArtifacts(airJsonPath, {
    providers,
    providerOptions,
  });

  // Check freshness of provider caches (non-blocking — warnings only)
  const warnings = await checkProviderFreshness(airConfig, providers);

  // Detect or validate root
  let root: RootEntry | undefined;
  let rootAutoDetected = false;

  if (options.root) {
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
  } else {
    const targetDir = resolve(options.target ?? process.cwd());
    root = detectRoot(artifacts.roots, targetDir);
    if (root) {
      rootAutoDetected = true;
    }
  }

  // Compute per-category overrides. Explicit `skills`/`mcpServers`/`hooks`/
  // `plugins` values are final (from TUI/orchestrator selection). Otherwise,
  // any `add*`/`remove*`/`withoutDefaults` intent is applied on top of the
  // union of parent-root and subagent-root defaults.
  const merged = computeMergedDefaults(root, artifacts, options.skipSubagentMerge);
  const skillOverrides = resolveCategoryOverride(
    options.skills,
    merged.skillIds,
    options.addSkills,
    options.removeSkills,
    options.withoutDefaults,
    artifacts.skills
  );
  const mcpServerOverrides = resolveCategoryOverride(
    options.mcpServers,
    merged.mcpServerIds,
    options.addMcpServers,
    options.removeMcpServers,
    options.withoutDefaults,
    artifacts.mcp
  );
  const hookOverrides = resolveCategoryOverride(
    options.hooks,
    merged.hookIds,
    options.addHooks,
    options.removeHooks,
    options.withoutDefaults,
    artifacts.hooks
  );
  const pluginOverrides = resolveCategoryOverride(
    options.plugins,
    merged.pluginIds,
    options.addPlugins,
    options.removePlugins,
    options.withoutDefaults,
    artifacts.plugins
  );

  // Adapter writes .mcp.json and injects skills (no secret resolution)
  const session = await adapter.prepareSession(
    artifacts,
    options.target ?? process.cwd(),
    {
      root,
      skillOverrides,
      mcpServerOverrides,
      hookOverrides,
      pluginOverrides,
      skipSubagentMerge: options.skipSubagentMerge,
    }
  );

  // Run transforms in extension-list order on all config files (e.g., .mcp.json, settings.json)
  if (loaded.transforms.length > 0 && session.configFiles.length > 0) {
    await runTransforms({
      transforms: loaded.transforms,
      configFiles: session.configFiles,
      targetDir: options.target ?? process.cwd(),
      root,
      artifacts,
      extensionOptions: options.extensionOptions ?? {},
      hookPaths: session.hookPaths,
    });
  }

  // Final validation: ensure no unresolved ${VAR} patterns remain
  if (!options.skipValidation) {
    const allUnresolved: string[] = [];

    for (const configFile of session.configFiles) {
      if (!existsSync(configFile)) continue;
      const config: McpConfig = JSON.parse(readFileSync(configFile, "utf-8"));
      allUnresolved.push(...findUnresolvedVars(config));
    }

    if (session.hookPaths.length > 0) {
      allUnresolved.push(...findUnresolvedHookVars(session.hookPaths));
    }

    // Deduplicate
    const unique = [...new Set(allUnresolved)];
    if (unique.length > 0) {
      const targetDir = options.target ?? process.cwd();
      throw new Error(unresolvedVarsMessage(targetDir, unique));
    }
  }

  return {
    session,
    root,
    rootAutoDetected,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Merged default IDs across parent root and its subagent roots.
 */
export interface MergedArtifactDefaults {
  mcpServerIds: string[];
  skillIds: string[];
  hookIds: string[];
  pluginIds: string[];
}

/**
 * Compute the union of parent root and subagent roots' defaults for each
 * artifact category. Subagent merging can be disabled via `skipSubagentMerge`,
 * in which case only the parent root's defaults are returned.
 */
export function computeMergedDefaults(
  root: RootEntry | undefined,
  artifacts: ResolvedArtifacts,
  skipSubagentMerge = false
): MergedArtifactDefaults {
  const mcpSet = new Set(root?.default_mcp_servers ?? []);
  const skillSet = new Set(root?.default_skills ?? []);
  const hookSet = new Set(root?.default_hooks ?? []);
  const pluginSet = new Set(root?.default_plugins ?? []);

  if (!skipSubagentMerge) {
    for (const subId of root?.default_subagent_roots ?? []) {
      const sub = artifacts.roots[subId];
      if (!sub) continue;
      for (const id of sub.default_mcp_servers ?? []) mcpSet.add(id);
      for (const id of sub.default_skills ?? []) skillSet.add(id);
      for (const id of sub.default_hooks ?? []) hookSet.add(id);
      for (const id of sub.default_plugins ?? []) pluginSet.add(id);
    }
  }

  return {
    mcpServerIds: [...mcpSet],
    skillIds: [...skillSet],
    hookIds: [...hookSet],
    pluginIds: [...pluginSet],
  };
}

/**
 * Resolve the final override for a single artifact category.
 *
 * - If an explicit override is provided (e.g. from a TUI selection), it wins.
 * - Otherwise, if any add/remove/withoutDefaults intent is present, the
 *   merged defaults are the base, additions are unioned in, removals are
 *   subtracted, and `withoutDefaults` starts from an empty base.
 * - If no intent is expressed, returns `undefined` — the adapter uses its
 *   own default resolution.
 *
 * When a `pool` is supplied, short-form `add` and `remove` IDs are
 * canonicalized to their qualified form (e.g. `skill-a` → `@local/skill-a`)
 * via `resolveReference` so set operations match the canonical merged
 * defaults. Unknown short IDs pass through unchanged so the caller can
 * surface them as "(not found)". Ambiguous short IDs throw — the caller
 * must disambiguate with the qualified form before re-invoking.
 */
export function resolveCategoryOverride(
  explicitOverride: string[] | undefined,
  mergedDefaults: string[],
  add: string[] | undefined,
  remove: string[] | undefined,
  withoutDefaults: boolean | undefined,
  pool?: Record<string, unknown>
): string[] | undefined {
  if (explicitOverride !== undefined) return explicitOverride;
  const hasIntent =
    add !== undefined || remove !== undefined || (withoutDefaults ?? false);
  if (!hasIntent) return undefined;
  const canonicalize = (id: string, source: "add" | "remove"): string => {
    if (!pool) return id;
    const res = resolveReference(pool, id, undefined);
    if (res.status === "ok") return res.qualified;
    if (res.status === "ambiguous") {
      throw new Error(
        `${source} reference "${id}" is ambiguous across scopes — ` +
          `candidates: ${res.candidates.join(", ")}. ` +
          `Use the qualified form to disambiguate.`
      );
    }
    return id;
  };
  const base = withoutDefaults ? [] : mergedDefaults;
  const set = new Set(base);
  for (const id of add ?? []) set.add(canonicalize(id, "add"));
  for (const id of remove ?? []) set.delete(canonicalize(id, "remove"));
  return [...set];
}
