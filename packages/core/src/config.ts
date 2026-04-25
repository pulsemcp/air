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
import {
  LOCAL_SCOPE,
  deriveScope,
  qualifyId,
  parseQualifiedId,
  isQualified,
  resolveReference,
  type QualifiedId,
} from "./scope.js";

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
 * One contribution of artifacts coming from a single catalog source. Each
 * source carries the scope its entries should be qualified under.
 */
interface ArtifactContribution<T> {
  /** Scope assigned to every shortname in this contribution. */
  scope: string;
  /** Human-readable label for diagnostics (path or URI). */
  source: string;
  /** Shortname → entry, as authored in the index file. */
  entries: Record<string, T>;
}

/**
 * Load every contribution for a single artifact type and return them as a
 * flat list. Each contribution preserves the scope of the catalog it came
 * from so qualification can happen during merging.
 */
async function loadContributions<T>(
  paths: { path: string; scope: string }[],
  baseDir: string,
  providers: CatalogProvider[]
): Promise<ArtifactContribution<T>[]> {
  const contributions: ArtifactContribution<T>[] = [];

  for (const { path: p, scope } of paths) {
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
    contributions.push({ scope, source: p, entries: resolved });
  }

  return contributions;
}

/**
 * Merge per-source contributions into a single `@scope/id`-keyed map.
 *
 * Composition rules:
 *   - Every entry is qualified `@scope/id` using the contribution's scope.
 *   - Two contributions producing the same qualified ID hard-fail with a
 *     diagnostic that names both sources.
 *   - Two contributions producing the same shortname under different scopes
 *     both land in the map. Cross-scope shortname collisions are reported by
 *     {@link warnCrossScopeShortnames} *after* `exclude` runs, so excluding
 *     one of the colliding artifacts silences the warning.
 *
 * Returns the merged map plus a `sources` map that records which contribution
 * each qualified ID came from — used later for the post-exclude warning pass.
 */
function mergeContributions<T>(
  contributions: ArtifactContribution<T>[],
  artifactType: string
): { merged: Record<QualifiedId, T>; sources: Map<QualifiedId, string> } {
  const merged: Record<QualifiedId, T> = {};
  const sourceByQualified = new Map<QualifiedId, string>();

  for (const contribution of contributions) {
    for (const [shortname, entry] of Object.entries(contribution.entries)) {
      if (isQualified(shortname)) {
        throw new Error(
          `Artifact index entry must use a bare shortname; got qualified ID ` +
            `"${shortname}" in ${contribution.source}. Scopes are assigned by ` +
            `the catalog source, not by authors.`
        );
      }
      const qualified = qualifyId(contribution.scope, shortname);

      const existingSource = sourceByQualified.get(qualified);
      if (existingSource !== undefined) {
        throw new Error(
          `Duplicate ${artifactType} ID "${qualified}" produced by both ` +
            `"${existingSource}" and "${contribution.source}". Two catalogs ` +
            `with the same scope contributed the same shortname; rename one ` +
            `or remove the duplicate from your air.json.`
        );
      }
      sourceByQualified.set(qualified, contribution.source);
      merged[qualified] = entry;
    }
  }

  return { merged, sources: sourceByQualified };
}

/**
 * Emit one warning per shortname that survives `exclude` under more than one
 * scope. Running this after {@link applyExclude} means excluding either side
 * of the collision silences the warning.
 */
function warnCrossScopeShortnames(
  artifacts: ResolvedArtifacts,
  sourcesByType: Record<ArtifactType, Map<QualifiedId, string>>,
  warnings: string[]
): void {
  for (const type of ARTIFACT_TYPES) {
    const pool = artifacts[type] as Record<string, unknown>;
    const sources = sourcesByType[type];
    const scopesByShortname = new Map<string, Map<string, string>>();

    for (const qualified of Object.keys(pool)) {
      const { scope, id: shortname } = parseQualifiedId(qualified);
      const source = sources.get(qualified) ?? "(unknown source)";
      let scopeMap = scopesByShortname.get(shortname);
      if (!scopeMap) {
        scopeMap = new Map<string, string>();
        scopesByShortname.set(shortname, scopeMap);
      }
      scopeMap.set(scope, source);
    }

    for (const [shortname, scopeMap] of scopesByShortname) {
      if (scopeMap.size <= 1) continue;
      const scopeList = [...scopeMap.entries()]
        .map(([scope, source]) => `@${scope} (from ${source})`)
        .join(", ");
      warnings.push(
        `Cross-scope shortname collision: ${type} "${shortname}" is ` +
          `provided by ${scopeMap.size} scopes — ${scopeList}. Short references ` +
          `to "${shortname}" without a scope are ambiguous; use the qualified ` +
          `form "@scope/${shortname}" to disambiguate.`
      );
    }
  }
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
  /**
   * Sink for non-fatal warnings (e.g. cross-scope shortname collisions, stale
   * `exclude` entries). When omitted, core writes warnings to `console.warn`.
   */
  onWarning?: (message: string) => void;
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
 * Files are returned sorted by relative path.
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
 * One catalog source's contribution to per-type index lists, with the scope
 * that should be applied to every artifact discovered in that catalog.
 */
interface CatalogExpansion {
  scope: string;
  paths: Record<ArtifactType, string[]>;
}

/**
 * Expand every entry in `catalogs[]` into per-type index file paths grouped
 * by scope. Each catalog is resolved to a local directory and walked for
 * artifact index files (depth-capped, gitignore-aware, skip-listed); the
 * scope assigned to those files comes from the provider's `getScope(uri)`,
 * or `local` for filesystem catalogs and providers without `getScope`.
 */
async function expandAllCatalogs(
  catalogs: string[],
  baseDir: string,
  providers: CatalogProvider[]
): Promise<CatalogExpansion[]> {
  const expansions: CatalogExpansion[] = [];

  for (const catalog of catalogs) {
    const catalogDir = await resolveCatalogRoot(catalog, baseDir, providers);
    const discovered = discoverCatalogIndexes(catalogDir);
    const scope = deriveScope(catalog, providers);

    const paths: Record<ArtifactType, string[]> = {
      skills: [],
      references: [],
      mcp: [],
      plugins: [],
      roots: [],
      hooks: [],
    };
    for (const entry of discovered) {
      paths[entry.type].push(entry.absPath);
    }
    expansions.push({ scope, paths });
  }

  return expansions;
}

/**
 * Canonicalize every reference field in an artifact body to its qualified
 * form. References that fail to resolve (missing or ambiguous) populate
 * `errors` so callers can fail composition with all problems at once.
 *
 * `fromScope` is the scope of the artifact that owns the reference — used
 * to apply the intra-catalog rule (a short reference inside a catalog binds
 * to that catalog's scope first).
 */
function canonicalizeReferences(
  artifacts: ResolvedArtifacts,
  excluded: Set<QualifiedId>,
  errors: string[]
): ResolvedArtifacts {
  type RefField =
    | { kind: "skill"; entry: SkillEntry }
    | { kind: "hook"; entry: HookEntry }
    | { kind: "plugin"; entry: PluginEntry }
    | { kind: "root"; entry: RootEntry };

  const result: ResolvedArtifacts = {
    skills: { ...artifacts.skills },
    references: { ...artifacts.references },
    mcp: { ...artifacts.mcp },
    plugins: { ...artifacts.plugins },
    roots: { ...artifacts.roots },
    hooks: { ...artifacts.hooks },
  };

  /**
   * For a `missing` reference, decide whether the target was specifically
   * dropped by `air.json#exclude`. Exact qualified-ID match wins; otherwise a
   * short reference matches any excluded entry whose shortname matches `ref`.
   * The list of matching excluded IDs is returned so the error can name them.
   */
  function excludedMatches(ref: string): QualifiedId[] {
    if (isQualified(ref)) {
      return excluded.has(ref) ? [ref] : [];
    }
    const matches: QualifiedId[] = [];
    for (const id of excluded) {
      if (parseQualifiedId(id).id === ref) matches.push(id);
    }
    return matches;
  }

  function resolveList(
    list: string[] | undefined,
    pool: Record<string, unknown>,
    fromScope: string,
    poolType: string,
    ownerLabel: string,
    field: string
  ): string[] | undefined {
    if (!list) return undefined;
    const out: string[] = [];
    for (const ref of list) {
      const res = resolveReference(pool, ref, fromScope);
      if (res.status === "ok") {
        out.push(res.qualified);
      } else if (res.status === "missing") {
        const matches = excludedMatches(ref);
        if (matches.length > 0) {
          errors.push(
            `${ownerLabel}.${field} references ${poolType} "${ref}", ` +
              `which is removed by air.json#exclude (${matches.join(", ")}). ` +
              `Drop the exclude entry or also remove every artifact that ` +
              `references it.`
          );
        } else {
          errors.push(
            `${ownerLabel}.${field} references unknown ${poolType} "${ref}". ` +
              `Available qualified IDs: ${listIds(pool)}.`
          );
        }
      } else {
        errors.push(
          `${ownerLabel}.${field} reference "${ref}" is ambiguous across ` +
            `scopes — candidates: ${res.candidates.join(", ")}. ` +
            `Use the qualified form to disambiguate.`
        );
      }
    }
    return out;
  }

  function processOwner(
    qualified: QualifiedId,
    owner: RefField
  ): void {
    const { scope } = parseQualifiedId(qualified);
    const ownerLabel = qualified;

    if (owner.kind === "skill" || owner.kind === "hook") {
      const next = { ...owner.entry };
      next.references = resolveList(
        next.references,
        result.references,
        scope,
        "reference",
        ownerLabel,
        "references"
      );
      if (owner.kind === "skill") result.skills[qualified] = next as SkillEntry;
      else result.hooks[qualified] = next as HookEntry;
    } else if (owner.kind === "plugin") {
      const next: PluginEntry = { ...owner.entry };
      next.skills = resolveList(
        next.skills,
        result.skills,
        scope,
        "skill",
        ownerLabel,
        "skills"
      );
      next.mcp_servers = resolveList(
        next.mcp_servers,
        result.mcp,
        scope,
        "mcp",
        ownerLabel,
        "mcp_servers"
      );
      next.hooks = resolveList(
        next.hooks,
        result.hooks,
        scope,
        "hook",
        ownerLabel,
        "hooks"
      );
      next.plugins = resolveList(
        next.plugins,
        result.plugins,
        scope,
        "plugin",
        ownerLabel,
        "plugins"
      );
      result.plugins[qualified] = next;
    } else {
      const next: RootEntry = { ...owner.entry };
      next.default_skills = resolveList(
        next.default_skills,
        result.skills,
        scope,
        "skill",
        ownerLabel,
        "default_skills"
      );
      next.default_mcp_servers = resolveList(
        next.default_mcp_servers,
        result.mcp,
        scope,
        "mcp",
        ownerLabel,
        "default_mcp_servers"
      );
      next.default_plugins = resolveList(
        next.default_plugins,
        result.plugins,
        scope,
        "plugin",
        ownerLabel,
        "default_plugins"
      );
      next.default_hooks = resolveList(
        next.default_hooks,
        result.hooks,
        scope,
        "hook",
        ownerLabel,
        "default_hooks"
      );
      next.default_subagent_roots = resolveList(
        next.default_subagent_roots,
        result.roots,
        scope,
        "root",
        ownerLabel,
        "default_subagent_roots"
      );
      result.roots[qualified] = next;
    }
  }

  for (const [qualified, entry] of Object.entries(artifacts.skills)) {
    processOwner(qualified, { kind: "skill", entry });
  }
  for (const [qualified, entry] of Object.entries(artifacts.hooks)) {
    processOwner(qualified, { kind: "hook", entry });
  }
  for (const [qualified, entry] of Object.entries(artifacts.plugins)) {
    processOwner(qualified, { kind: "plugin", entry });
  }
  for (const [qualified, entry] of Object.entries(artifacts.roots)) {
    processOwner(qualified, { kind: "root", entry });
  }

  return result;
}

function listIds(pool: Record<string, unknown>): string {
  const keys = Object.keys(pool);
  if (keys.length === 0) return "(none)";
  if (keys.length > 8) {
    return `${keys.slice(0, 8).join(", ")}, … (${keys.length} total)`;
  }
  return keys.join(", ");
}

/**
 * Apply `air.json#exclude` to a resolved artifact set. Excluded qualified IDs
 * disappear from every artifact map; entries that don't match anything are
 * surfaced as warnings so typos in `exclude` are visible to authors.
 */
function applyExclude(
  artifacts: ResolvedArtifacts,
  exclude: string[],
  warnings: string[]
): { artifacts: ResolvedArtifacts; excluded: Set<string> } {
  if (exclude.length === 0) {
    return { artifacts, excluded: new Set() };
  }

  const excludeSet = new Set<string>();
  for (const id of exclude) {
    if (!isQualified(id)) {
      throw new Error(
        `air.json "exclude" entries must be qualified IDs (@scope/id); got "${id}".`
      );
    }
    excludeSet.add(id);
  }

  const result: ResolvedArtifacts = {
    skills: {},
    references: {},
    mcp: {},
    plugins: {},
    roots: {},
    hooks: {},
  };
  const seen = new Set<string>();

  for (const type of ARTIFACT_TYPES) {
    const src = artifacts[type] as Record<string, unknown>;
    const dst = result[type] as Record<string, unknown>;
    for (const [id, entry] of Object.entries(src)) {
      if (excludeSet.has(id)) {
        seen.add(id);
        continue;
      }
      dst[id] = entry;
    }
  }

  for (const id of excludeSet) {
    if (!seen.has(id)) {
      warnings.push(
        `air.json "exclude" entry "${id}" did not match any resolved ` +
          `artifact. Remove it or check for typos.`
      );
    }
  }

  return { artifacts: result, excluded: excludeSet };
}

/**
 * Resolve all artifacts from an air.json file.
 *
 * Every artifact is canonically `@scope/id`:
 *   - Catalog providers supply scope via `getScope(uri)` (e.g. the GitHub
 *     provider returns `owner/repo`).
 *   - Local catalogs and per-type arrays default to scope `local`.
 *
 * Composition is union-only: catalogs and per-type arrays *contribute*
 * artifacts. The only way to remove an artifact is via `air.json#exclude`,
 * which lists qualified IDs to drop from the resolved set. Two contributors
 * producing the same qualified ID hard-fail; same shortname under different
 * scopes warns and both qualified IDs appear in the result.
 *
 * Reference fields inside artifact bodies (skill.references, plugin.skills,
 * root.default_skills, …) are canonicalized to qualified IDs at resolution
 * time. References inside a catalog's own indexes resolve to that catalog's
 * scope first; cross-catalog references must use the qualified form when
 * the shortname is ambiguous.
 *
 * All `path` fields are absolute, making artifacts self-contained regardless
 * of source location.
 */
export async function resolveArtifacts(
  airJsonPath: string,
  options?: ResolveOptions
): Promise<ResolvedArtifacts> {
  const airConfig = loadAirConfig(airJsonPath);
  const baseDir = dirname(resolve(airJsonPath));
  const providers = options?.providers || [];
  const catalogs = airConfig.catalogs || [];
  const onWarning =
    options?.onWarning ?? ((msg: string) => console.warn(`warning: ${msg}`));
  const warnings: string[] = [];

  // Configure providers with merged options: air.json fields are the base,
  // explicit providerOptions override them. Providers ignore unknown keys.
  configureProviders(providers, airConfig, options?.providerOptions);

  const expansions = await expandAllCatalogs(catalogs, baseDir, providers);

  function pathsFor(type: ArtifactType): { path: string; scope: string }[] {
    const list: { path: string; scope: string }[] = [];
    for (const expansion of expansions) {
      for (const p of expansion.paths[type]) {
        list.push({ path: p, scope: expansion.scope });
      }
    }
    for (const p of (airConfig[type] as string[] | undefined) || []) {
      // Per-type arrays default to LOCAL_SCOPE, but a provider URI in a
      // per-type array still gets its provider scope so artifacts from
      // different orgs/repos cannot collide under @local/<id>.
      list.push({ path: p, scope: deriveScope(p, providers) });
    }
    return list;
  }

  const sourcesByType: Record<ArtifactType, Map<QualifiedId, string>> = {
    skills: new Map(),
    references: new Map(),
    mcp: new Map(),
    plugins: new Map(),
    roots: new Map(),
    hooks: new Map(),
  };

  async function load<T>(type: ArtifactType): Promise<Record<string, T>> {
    const paths = pathsFor(type);
    const contributions = await loadContributions<T>(paths, baseDir, providers);
    const { merged, sources } = mergeContributions<T>(contributions, type);
    sourcesByType[type] = sources;
    return merged;
  }

  const resolved: ResolvedArtifacts = {
    skills: await load<SkillEntry>("skills"),
    references: await load<ReferenceEntry>("references"),
    mcp: await load<McpServerEntry>("mcp"),
    plugins: await load<PluginEntry>("plugins"),
    roots: await load<RootEntry>("roots"),
    hooks: await load<HookEntry>("hooks"),
  };

  // Apply exclude before reference canonicalization so dropped IDs cannot
  // satisfy references and a clear "missing reference" error surfaces.
  const { artifacts: filtered, excluded } = applyExclude(
    resolved,
    airConfig.exclude || [],
    warnings
  );

  // Cross-scope shortname collisions are reported on the post-exclude pool, so
  // excluding one side of the collision silences the warning automatically.
  warnCrossScopeShortnames(filtered, sourcesByType, warnings);

  const refErrors: string[] = [];
  const canonical = canonicalizeReferences(filtered, excluded, refErrors);
  if (refErrors.length > 0) {
    throw new Error(
      `Reference resolution failed:\n  - ${refErrors.join("\n  - ")}`
    );
  }

  for (const w of warnings) onWarning(w);

  return expandPlugins(canonical);
}

/**
 * Combine two resolved artifact sets by union. Inputs must already be
 * qualified (`@scope/id`); a duplicate qualified ID across the two inputs
 * is rejected with a clear diagnostic. Composite plugins are re-expanded
 * after merging.
 *
 * `mergeArtifacts` is a low-level helper used to layer two pre-resolved
 * sets — for example, an external orchestrator merging a parent session's
 * artifacts with a subagent's. Most callers should compose at the air.json
 * level (catalogs + exclude) instead.
 */
export function mergeArtifacts(
  base: ResolvedArtifacts,
  overlay: ResolvedArtifacts
): ResolvedArtifacts {
  function unionOrThrow<T>(
    a: Record<string, T>,
    b: Record<string, T>,
    label: string
  ): Record<string, T> {
    const out: Record<string, T> = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (k in out) {
        throw new Error(
          `mergeArtifacts: duplicate ${label} ID "${k}" in both base and overlay. ` +
            `Override is not supported — drop one source via air.json#exclude.`
        );
      }
      out[k] = v;
    }
    return out;
  }

  return expandPlugins({
    skills: unionOrThrow(base.skills, overlay.skills, "skill"),
    references: unionOrThrow(base.references, overlay.references, "reference"),
    mcp: unionOrThrow(base.mcp, overlay.mcp, "mcp"),
    plugins: unionOrThrow(base.plugins, overlay.plugins, "plugin"),
    roots: unionOrThrow(base.roots, overlay.roots, "root"),
    hooks: unionOrThrow(base.hooks, overlay.hooks, "hook"),
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
 * - All IDs are already qualified (`@scope/id`) at this stage.
 * - Child plugins are expanded depth-first in declaration order.
 * - Parent's direct declarations come last (later wins via dedup).
 * - Circular references are rejected with a clear error message.
 * - Plugins without a `plugins` field are returned unchanged.
 * - The `plugins` array on each entry is preserved as metadata.
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
