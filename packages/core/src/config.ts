import { readFileSync, readdirSync, existsSync, type Dirent } from "fs";
import { resolve, dirname } from "path";
import ignore, { type Ignore } from "ignore";
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
import {
  detectSchemaType,
  detectSchemaFromValue,
  type SchemaType,
} from "./schemas.js";

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
 * Resolve relative `path` fields in artifact entries to absolute paths.
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
    resolved[key] = updated as T;
  }
  return resolved;
}

/**
 * Load and merge entries from an array of index file paths.
 * Local paths are resolved relative to baseDir.
 * URI paths (with schemes) are delegated to the matching CatalogProvider.
 *
 * After loading, relative `path` fields in entries are resolved
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
  /**
   * Runtime options passed to each provider's optional `configure()` method.
   * Values here take precedence over equivalent fields read from air.json
   * (e.g., `gitProtocol`). Providers ignore unknown keys.
   */
  providerOptions?: Record<string, unknown>;
}

/**
 * Merge air.json-level provider fields with runtime overrides and dispatch
 * the result to each provider's optional `configure()` method.
 *
 * Precedence (lowest to highest, later wins):
 *   1. `airConfig.<field>` — values declared in air.json
 *   2. Well-known AIR env vars — currently `AIR_GIT_PROTOCOL` for `gitProtocol`
 *   3. `providerOptions.<field>` — CLI-sourced overrides from the SDK
 *
 * This mirrors the user-facing contract documented in docs/configuration.md:
 * CLI flag > env var > air.json > default.
 */
export function configureProviders(
  providers: CatalogProvider[],
  airConfig: AirConfig,
  providerOptions?: Record<string, unknown>
): void {
  const merged: Record<string, unknown> = {};

  // Tier 1 (lowest): air.json
  if (airConfig.gitProtocol !== undefined) {
    merged.gitProtocol = airConfig.gitProtocol;
  }

  // Tier 2: well-known AIR env vars override air.json
  if (process.env.AIR_GIT_PROTOCOL !== undefined) {
    merged.gitProtocol = process.env.AIR_GIT_PROTOCOL;
  }

  // Tier 3 (highest): runtime overrides (CLI flag threaded from SDK)
  if (providerOptions) {
    for (const [k, v] of Object.entries(providerOptions)) {
      if (v !== undefined) merged[k] = v;
    }
  }

  if (Object.keys(merged).length === 0) return;
  for (const provider of providers) {
    provider.configure?.(merged);
  }
}

/**
 * Artifact types recognized as catalog-expandable primitives.
 */
type ArtifactType =
  | "skills"
  | "references"
  | "mcp"
  | "plugins"
  | "roots"
  | "hooks";

const ARTIFACT_TYPES: ArtifactType[] = [
  "skills",
  "references",
  "mcp",
  "plugins",
  "roots",
  "hooks",
];

/**
 * Directories never descended into when discovering artifact indexes in a
 * catalog. Covers common build/vendor dirs and VCS internals.
 */
const CATALOG_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "target",
  "vendor",
]);

/** Maximum directory depth walked under a catalog root (root itself is depth 0). */
const CATALOG_MAX_DEPTH = 3;

interface DiscoveredIndex {
  /** Absolute path to the index file. */
  absPath: string;
  /** Path relative to the catalog root, forward-slash separated. For deterministic ordering. */
  relPath: string;
  /** Artifact type the index provides. */
  type: ArtifactType;
}

/**
 * Read a JSON index file and confirm it is a plausible AIR artifact index of
 * the given expected type. Returns the detected type or null to signal skip.
 *
 * A declared `$schema` always takes precedence over filename detection — a
 * file named `roots.json` whose `$schema` points at a non-AIR schema is
 * skipped entirely. Unparseable JSON, arrays, and primitives are skipped.
 */
function detectIndexType(
  absPath: string,
  filename: string
): ArtifactType | null {
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const obj = data as Record<string, unknown>;

  let detected: SchemaType | null = null;

  if (typeof obj.$schema === "string") {
    const bySchema = detectSchemaFromValue(obj.$schema);
    if (bySchema === null) return null;
    detected = bySchema;
  } else {
    detected = detectSchemaType(filename);
  }

  if (detected === null) return null;
  if (detected === "air") return null;
  if (!ARTIFACT_TYPES.includes(detected as ArtifactType)) return null;
  return detected as ArtifactType;
}

/**
 * Walk a catalog root directory and return all artifact index files found
 * within `CATALOG_MAX_DEPTH` levels, skipping `CATALOG_SKIP_DIRS`, hidden
 * entries, and anything matched by a root-level `.gitignore` if present.
 *
 * Files are returned sorted by relative path (alphabetic, depth-naive) so
 * that "later wins" collision semantics within a single catalog are stable
 * across machines and filesystems.
 */
function discoverCatalogIndexes(catalogDir: string): DiscoveredIndex[] {
  if (!existsSync(catalogDir)) return [];

  const ig: Ignore = ignore();
  const rootGitignore = resolve(catalogDir, ".gitignore");
  if (existsSync(rootGitignore)) {
    try {
      ig.add(readFileSync(rootGitignore, "utf-8"));
    } catch {
      // best effort — a broken .gitignore doesn't block discovery
    }
  }

  const discovered: DiscoveredIndex[] = [];

  function recurse(currentDir: string, depth: number, relDir: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(".")) continue;

      const rel = relDir === "" ? name : `${relDir}/${name}`;
      const absPath = resolve(currentDir, name);

      if (entry.isDirectory()) {
        if (CATALOG_SKIP_DIRS.has(name)) continue;
        // The `ignore` library expects paths without a leading slash; directory
        // matching conventionally uses a trailing slash.
        if (ig.ignores(`${rel}/`)) continue;
        if (depth + 1 > CATALOG_MAX_DEPTH) continue;
        recurse(absPath, depth + 1, rel);
      } else if (entry.isFile()) {
        if (!name.endsWith(".json")) continue;
        if (ig.ignores(rel)) continue;
        const type = detectIndexType(absPath, name);
        if (!type) continue;
        discovered.push({ absPath, relPath: rel, type });
      }
    }
  }

  recurse(catalogDir, 0, "");

  discovered.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return discovered;
}

/**
 * Resolve a single catalog entry (local path or provider URI) to a local
 * directory ready to be walked for index discovery. Throws for URIs whose
 * scheme has no registered provider, or whose provider does not support
 * catalog discovery (missing `resolveCatalogDir`).
 */
async function resolveCatalogRoot(
  catalog: string,
  baseDir: string,
  providers: CatalogProvider[]
): Promise<string> {
  const scheme = getScheme(catalog);
  if (!scheme) {
    return resolve(baseDir, catalog);
  }

  const provider = providers.find((prov) => prov.scheme === scheme);
  if (!provider) {
    throw new Error(
      `No catalog provider registered for scheme "${scheme}://" (catalog: ${catalog}). ` +
        `Install an extension that handles this scheme.`
    );
  }
  if (!provider.resolveCatalogDir) {
    throw new Error(
      `Provider for "${scheme}://" does not support catalog discovery — ` +
        `it lacks resolveCatalogDir(). Upgrade the provider extension or ` +
        `reference its artifact indexes via explicit per-type arrays.`
    );
  }

  return await provider.resolveCatalogDir(catalog);
}

/**
 * Expand every entry in `catalogs[]` into a per-type map of absolute index
 * file paths. Each catalog is resolved to a local directory and walked for
 * artifact index files (depth-capped, gitignore-aware, skip-listed).
 *
 * Within a single catalog, files of the same type discovered at multiple
 * locations are merged in sorted relPath order with later-wins semantics —
 * the downstream `loadAndMerge` consumes the returned arrays in order and
 * applies the same "later wins by ID" rule as everywhere else in AIR.
 *
 * Across catalogs, catalogs earlier in `catalogs[]` are processed first so
 * that later catalogs override earlier ones, matching the existing contract.
 */
async function expandAllCatalogs(
  catalogs: string[],
  baseDir: string,
  providers: CatalogProvider[]
): Promise<Record<ArtifactType, string[]>> {
  const result: Record<ArtifactType, string[]> = {
    skills: [],
    references: [],
    mcp: [],
    plugins: [],
    roots: [],
    hooks: [],
  };

  for (const catalog of catalogs) {
    const catalogDir = await resolveCatalogRoot(catalog, baseDir, providers);
    const discovered = discoverCatalogIndexes(catalogDir);
    for (const entry of discovered) {
      result[entry.type].push(entry.absPath);
    }
  }

  return result;
}


/**
 * Resolve all artifacts from an air.json file.
 * Each artifact property is an array of paths; files merge in order.
 * Remote URIs are delegated to the matching CatalogProvider.
 *
 * `catalogs` entries are expanded first via directory-walking discovery —
 * each catalog is resolved to a local directory (cloned by the relevant
 * provider for remote URIs) and walked up to `CATALOG_MAX_DEPTH` levels
 * for artifact index files. Files are identified by `$schema` (preferred)
 * or filename, and grouped by artifact type. Skip-listed directories
 * (node_modules, .git, dist, build, etc.) and entries matched by a
 * root-level `.gitignore` are not descended into. Explicit per-type
 * arrays layer on top of catalog-discovered indexes.
 *
 * All `path` fields in resolved entries are absolute paths,
 * making artifacts self-contained regardless of source location.
 */
export async function resolveArtifacts(
  airJsonPath: string,
  options?: ResolveOptions
): Promise<ResolvedArtifacts> {
  const airConfig = loadAirConfig(airJsonPath);
  const baseDir = dirname(resolve(airJsonPath));
  const providers = options?.providers || [];
  const catalogs = airConfig.catalogs || [];

  // Configure providers with merged options: air.json fields are the base,
  // explicit providerOptions override them. Providers ignore unknown keys.
  configureProviders(providers, airConfig, options?.providerOptions);

  const fromCatalogs = await expandAllCatalogs(catalogs, baseDir, providers);

  function paths(type: ArtifactType, explicit: string[]): string[] {
    return [...fromCatalogs[type], ...explicit];
  }

  const resolved: ResolvedArtifacts = {
    skills: await loadAndMerge<SkillEntry>(
      paths("skills", airConfig.skills || []),
      baseDir,
      providers
    ),
    references: await loadAndMerge<ReferenceEntry>(
      paths("references", airConfig.references || []),
      baseDir,
      providers
    ),
    mcp: await loadAndMerge<McpServerEntry>(
      paths("mcp", airConfig.mcp || []),
      baseDir,
      providers
    ),
    plugins: await loadAndMerge<PluginEntry>(
      paths("plugins", airConfig.plugins || []),
      baseDir,
      providers
    ),
    roots: await loadAndMerge<RootEntry>(
      paths("roots", airConfig.roots || []),
      baseDir,
      providers
    ),
    hooks: await loadAndMerge<HookEntry>(
      paths("hooks", airConfig.hooks || []),
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
 *
 * Returns a new ResolvedArtifacts object; the input is not mutated.
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
