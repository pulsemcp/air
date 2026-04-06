import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import type {
  AirConfig,
  ResolvedArtifacts,
  SkillEntry,
  ReferenceEntry,
  McpServerEntry,
  PluginEntry,
  RootEntry,
  HookEntry,
  CatalogProvider,
} from "./types.js";

function loadJsonFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content);
}

function stripSchema(
  data: Record<string, unknown>
): Record<string, unknown> {
  const { $schema, ...rest } = data;
  return rest;
}

/**
 * Check if a path string contains a URI scheme (e.g., "github://", "s3://").
 */
function getScheme(path: string): string | null {
  const match = path.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):\/\//);
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  // "file" scheme is handled as local filesystem, not a provider
  if (scheme === "file") return null;
  return scheme;
}

/**
 * Resolve relative `path` and `file` fields in artifact entries to absolute paths.
 * sourceDir is the directory containing the index file (local or remote clone).
 */
function resolveEntryPaths<T>(
  entries: Record<string, T>,
  sourceDir: string
): Record<string, T> {
  const resolved: Record<string, T> = {};
  for (const [key, entry] of Object.entries(entries)) {
    const e = entry as Record<string, unknown>;
    const updated = { ...e };

    if (typeof e.path === "string" && !e.path.startsWith("/")) {
      updated.path = resolve(sourceDir, e.path as string);
    }
    if (typeof e.file === "string" && !e.file.startsWith("/")) {
      updated.file = resolve(sourceDir, e.file as string);
    }

    resolved[key] = updated as T;
  }
  return resolved;
}

/**
 * Load and merge entries from an array of index file paths.
 * Local paths are resolved relative to baseDir.
 * URI paths (with schemes) are delegated to the matching CatalogProvider.
 *
 * After loading, relative `path` and `file` fields in entries are resolved
 * to absolute paths, so downstream consumers don't need source directory context.
 */
async function loadAndMerge<T>(
  paths: string[],
  baseDir: string,
  providers: CatalogProvider[]
): Promise<Record<string, T>> {
  let merged: Record<string, T> = {};

  for (const p of paths) {
    const scheme = getScheme(p);
    let data: Record<string, unknown>;
    let sourceDir: string;

    if (scheme) {
      const provider = providers.find((prov) => prov.scheme === scheme);
      if (!provider) {
        throw new Error(
          `No catalog provider registered for scheme "${scheme}://" (path: ${p}). ` +
            `Install an extension that handles this scheme.`
        );
      }
      data = await provider.resolve(p, baseDir);
      // Use provider's resolveSourceDir if available, otherwise fall back to baseDir
      sourceDir = provider.resolveSourceDir?.(p) ?? baseDir;
    } else {
      const resolvedPath = resolve(baseDir, p);
      data = loadJsonFile(resolvedPath);
      sourceDir = dirname(resolvedPath);
    }

    const entries = stripSchema(data) as Record<string, T>;
    const resolved = resolveEntryPaths(entries, sourceDir);
    merged = { ...merged, ...resolved };
  }

  return merged;
}

export function loadAirConfig(airJsonPath: string): AirConfig {
  const content = readFileSync(airJsonPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Default path to the user-level air.json.
 */
export function getDefaultAirJsonPath(): string {
  return resolve(
    process.env.HOME || process.env.USERPROFILE || "~",
    ".air",
    "air.json"
  );
}

/**
 * Get the air.json path, respecting AIR_CONFIG env var override.
 * Returns null if the file doesn't exist.
 */
export function getAirJsonPath(): string | null {
  const path = process.env.AIR_CONFIG || getDefaultAirJsonPath();
  return existsSync(path) ? path : null;
}

export interface ResolveOptions {
  /** Catalog providers for resolving remote URIs (github://, s3://, etc.) */
  providers?: CatalogProvider[];
}

/**
 * Resolve all artifacts from an air.json file.
 * Each artifact property is an array of paths; files merge in order.
 * Remote URIs are delegated to the matching CatalogProvider.
 *
 * All `path` and `file` fields in resolved entries are absolute paths,
 * making artifacts self-contained regardless of source location.
 */
export async function resolveArtifacts(
  airJsonPath: string,
  options?: ResolveOptions
): Promise<ResolvedArtifacts> {
  const airConfig = loadAirConfig(airJsonPath);
  const baseDir = dirname(resolve(airJsonPath));
  const providers = options?.providers || [];

  const resolved: ResolvedArtifacts = {
    skills: await loadAndMerge<SkillEntry>(
      airConfig.skills || [],
      baseDir,
      providers
    ),
    references: await loadAndMerge<ReferenceEntry>(
      airConfig.references || [],
      baseDir,
      providers
    ),
    mcp: await loadAndMerge<McpServerEntry>(
      airConfig.mcp || [],
      baseDir,
      providers
    ),
    plugins: await loadAndMerge<PluginEntry>(
      airConfig.plugins || [],
      baseDir,
      providers
    ),
    roots: await loadAndMerge<RootEntry>(
      airConfig.roots || [],
      baseDir,
      providers
    ),
    hooks: await loadAndMerge<HookEntry>(
      airConfig.hooks || [],
      baseDir,
      providers
    ),
  };

  return expandPlugins(resolved);
}

/**
 * Merge two resolved artifact sets. Override wins for matching IDs.
 * Composite plugins are re-expanded after merging so that newly
 * added plugins that reference existing ones are fully resolved.
 */
export function mergeArtifacts(
  base: ResolvedArtifacts,
  override: ResolvedArtifacts
): ResolvedArtifacts {
  return expandPlugins({
    skills: { ...base.skills, ...override.skills },
    references: { ...base.references, ...override.references },
    mcp: { ...base.mcp, ...override.mcp },
    plugins: { ...base.plugins, ...override.plugins },
    roots: { ...base.roots, ...override.roots },
    hooks: { ...base.hooks, ...override.hooks },
  });
}

/**
 * Deduplicate an array of strings, keeping the last occurrence of each value.
 * This ensures parent declarations take precedence over child plugin declarations
 * when arrays are concatenated as [...childIds, ...parentIds].
 */
function deduplicateIds(arr: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!seen.has(arr[i])) {
      seen.add(arr[i]);
      result.unshift(arr[i]);
    }
  }
  return result;
}

/**
 * Recursively expand plugin references.
 *
 * Each plugin may declare a `plugins` array referencing other plugins by ID.
 * This function resolves those references recursively, merging child plugins'
 * primitives (skills, mcp_servers, hooks) into the parent. The result is a
 * flat set of primitive IDs on each plugin — nesting is author convenience,
 * not a runtime concept.
 *
 * Semantics:
 * - Child plugins are expanded depth-first in declaration order
 * - Parent's direct declarations override children (later wins via dedup)
 * - Circular references are rejected with a clear error message
 * - Plugins without a `plugins` field are returned unchanged
 * - The `plugins` array on each entry is preserved as metadata (e.g., for
 *   UI display of the dependency graph) even though primitives are inlined
 */
export function expandPlugins(artifacts: ResolvedArtifacts): ResolvedArtifacts {
  const plugins = artifacts.plugins;
  const expanded = new Map<string, PluginEntry>();

  function expand(pluginId: string, ancestors: string[]): PluginEntry {
    if (expanded.has(pluginId)) {
      return expanded.get(pluginId)!;
    }

    const plugin = plugins[pluginId];
    if (!plugin) {
      throw new Error(
        `Plugin "${pluginId}" referenced by "${ancestors[ancestors.length - 1]}" not found in resolved artifacts`
      );
    }

    // Cycle detection
    const cycleIndex = ancestors.indexOf(pluginId);
    if (cycleIndex !== -1) {
      const cycle = [...ancestors.slice(cycleIndex), pluginId].join(" → ");
      throw new Error(`Circular plugin dependency detected: ${cycle}`);
    }

    // No child plugins — return as-is
    if (!plugin.plugins || plugin.plugins.length === 0) {
      expanded.set(pluginId, plugin);
      return plugin;
    }

    // Recursively expand child plugins and collect their primitives
    const childSkills: string[] = [];
    const childMcpServers: string[] = [];
    const childHooks: string[] = [];

    for (const childId of plugin.plugins) {
      const child = expand(childId, [...ancestors, pluginId]);
      if (child.skills) childSkills.push(...child.skills);
      if (child.mcp_servers) childMcpServers.push(...child.mcp_servers);
      if (child.hooks) childHooks.push(...child.hooks);
    }

    // Merge: children first, then parent's direct declarations (parent wins via dedup)
    const mergedSkills = deduplicateIds([
      ...childSkills,
      ...(plugin.skills || []),
    ]);
    const mergedMcpServers = deduplicateIds([
      ...childMcpServers,
      ...(plugin.mcp_servers || []),
    ]);
    const mergedHooks = deduplicateIds([
      ...childHooks,
      ...(plugin.hooks || []),
    ]);

    const expandedPlugin: PluginEntry = {
      ...plugin,
      skills: mergedSkills.length > 0 ? mergedSkills : undefined,
      mcp_servers: mergedMcpServers.length > 0 ? mergedMcpServers : undefined,
      hooks: mergedHooks.length > 0 ? mergedHooks : undefined,
    };

    expanded.set(pluginId, expandedPlugin);
    return expandedPlugin;
  }

  // Expand all plugins
  for (const pluginId of Object.keys(plugins)) {
    expand(pluginId, []);
  }

  // Build the new plugins record preserving insertion order
  const expandedPlugins: Record<string, PluginEntry> = {};
  for (const pluginId of Object.keys(plugins)) {
    expandedPlugins[pluginId] = expanded.get(pluginId)!;
  }

  return {
    ...artifacts,
    plugins: expandedPlugins,
  };
}

export function emptyArtifacts(): ResolvedArtifacts {
  return {
    skills: {},
    references: {},
    mcp: {},
    plugins: {},
    roots: {},
    hooks: {},
  };
}
