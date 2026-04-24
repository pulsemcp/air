import { execFileSync } from "child_process";
import { readFileSync, readdirSync, existsSync, type Dirent } from "fs";
import { resolve, relative, sep, basename } from "path";
import {
  detectSchemaType,
  detectSchemaFromValue,
  type SchemaType,
} from "@pulsemcp/air-core";

/** Artifact-index types that map to a catalog layout directory. */
const CATALOG_TYPES = [
  "skills",
  "references",
  "mcp",
  "plugins",
  "roots",
  "hooks",
] as const satisfies readonly Exclude<SchemaType, "air">[];

type CatalogType = (typeof CATALOG_TYPES)[number];

/** Directories never descended into during discovery. */
const SKIP_DIRS = new Set([
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

/** Maximum directory depth walked under the anchor (anchor itself is depth 0). */
const MAX_DEPTH = 3;

export interface DiscoveredCatalog {
  /** Absolute path to the catalog directory. */
  path: string;
  /** Path relative to the discovery anchor. */
  relPath: string;
  /** Artifact types found under the catalog that match the `<type>/<type>.json` layout. */
  types: CatalogType[];
  /** Count of entries per discovered type, for prompt summaries. */
  entryCounts: Partial<Record<CatalogType, number>>;
}

export interface DiscoveredLooseIndex {
  /** Artifact type inferred from the filename and/or `$schema`. */
  type: CatalogType;
  /** Absolute path to the index file. */
  path: string;
  /** Path relative to the discovery anchor. */
  relPath: string;
  /** Count of top-level entries in the index (excluding `$schema`). */
  entryCount: number;
}

export interface DiscoveredAirJson {
  /** Absolute path to the air.json file. */
  path: string;
  /** Path relative to the discovery anchor. */
  relPath: string;
}

export interface DiscoveryResult {
  /** Absolute path to the directory discovery was anchored at (git root or fallback). */
  anchor: string;
  /** Whether the anchor was determined via `git rev-parse` (true) or a cwd fallback (false). */
  anchorIsGitRoot: boolean;
  /** Catalog directories — `<anchor>/<type>/<type>.json` layouts. */
  catalogs: DiscoveredCatalog[];
  /** Bare artifact index files that are not part of a full catalog layout. */
  looseIndexes: DiscoveredLooseIndex[];
  /** Nested `air.json` files. */
  airJsons: DiscoveredAirJson[];
}

export interface DiscoverIndexesOptions {
  /** Maximum walk depth below the anchor. Default: 3. */
  maxDepth?: number;
  /** Override the skiplist. Default: common build/output dirs + node_modules/.git. */
  skipDirs?: Set<string>;
}

/**
 * Resolve the discovery anchor for a target directory.
 * Returns the git root when inside a repo, otherwise the target itself.
 */
export function resolveAnchor(targetDir: string): {
  anchor: string;
  isGitRoot: boolean;
} {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: targetDir,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }).trim();
    if (root) {
      return { anchor: resolve(root), isGitRoot: true };
    }
  } catch {
    // Not a git repo or git not installed — fall through.
  }
  return { anchor: resolve(targetDir), isGitRoot: false };
}

/**
 * Read a JSON file and verify it is (a) parseable, (b) an object, and
 * (c) plausibly an AIR artifact index of the expected type.
 *
 * Validation rules:
 * - The file must parse as a JSON object (not array/primitive/null).
 * - A missing `$schema` is allowed — filename-based detection is sufficient.
 * - When `$schema` is present, it must resolve to the expected artifact type;
 *   a contradictory or non-AIR schema causes the file to be skipped.
 *
 * Returns the parsed data when valid, or `null` to signal "skip this file".
 */
function readAndValidateIndex(
  filePath: string,
  expectedType: CatalogType
): Record<string, unknown> | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }
  if (
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data)
  ) {
    return null;
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.$schema === "string") {
    const schemaType = detectSchemaFromValue(obj.$schema);
    if (schemaType === null) return null;
    if (schemaType !== expectedType) return null;
  }
  return obj;
}

/** Count top-level artifact entries in a validated index (excludes `$schema`). */
function countEntries(data: Record<string, unknown>): number {
  let count = 0;
  for (const key of Object.keys(data)) {
    if (key === "$schema") continue;
    count++;
  }
  return count;
}

function readAirJson(filePath: string): boolean {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return false;
  }
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return false;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== "string") return false;
  if (typeof obj.$schema === "string") {
    const schemaType = detectSchemaFromValue(obj.$schema);
    if (schemaType !== null && schemaType !== "air") return false;
  }
  return true;
}

/**
 * Walk `anchor` up to `maxDepth` levels, yielding all files that might be
 * AIR index candidates. Skips hidden directories and the configured skiplist.
 * Hidden files (e.g. `.somefile.json`) are skipped. `.claude/skills/` is
 * intentionally NOT scanned — local `.claude/` skills are adapter-owned and
 * not managed through AIR discovery.
 */
function* walkJsonFiles(
  anchor: string,
  maxDepth: number,
  skipDirs: Set<string>
): Generator<string> {
  function* recurse(dir: string, depth: number): Generator<string> {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(".")) continue;
      const full = resolve(dir, name);
      if (entry.isDirectory()) {
        if (skipDirs.has(name)) continue;
        if (depth + 1 > maxDepth) continue;
        yield* recurse(full, depth + 1);
      } else if (entry.isFile()) {
        if (name.endsWith(".json")) {
          yield full;
        }
      }
    }
  }
  yield* recurse(anchor, 0);
}

/**
 * Find catalog layouts under the anchor.
 *
 * A catalog is a directory D such that `D/<type>/<type>.json` exists for at
 * least one of the six artifact types. The catalog's position is D itself
 * (so `air.json`'s `catalogs[]` receives a single entry for D, not six
 * per-type paths).
 *
 * Catalog detection is conservative — `D/skills/skills.json` must look like
 * a valid AIR skills index (parseable JSON object with a matching `$schema`
 * if declared) before D is considered a catalog.
 */
function findCatalogs(anchor: string): DiscoveredCatalog[] {
  // Map of catalog absolute path → set of types detected under it.
  const catalogs = new Map<string, DiscoveredCatalog>();

  function tryCatalogAt(dirPath: string): void {
    if (catalogs.has(dirPath)) return;
    const entryCounts: Partial<Record<CatalogType, number>> = {};
    const types: CatalogType[] = [];
    for (const type of CATALOG_TYPES) {
      const candidate = resolve(dirPath, type, `${type}.json`);
      if (!existsSync(candidate)) continue;
      const data = readAndValidateIndex(candidate, type);
      if (!data) continue;
      types.push(type);
      entryCounts[type] = countEntries(data);
    }
    if (types.length === 0) return;
    catalogs.set(dirPath, {
      path: dirPath,
      relPath: relative(anchor, dirPath) || ".",
      types,
      entryCounts,
    });
  }

  // The anchor itself is always a candidate root.
  tryCatalogAt(anchor);

  // Also scan subdirectories one level deep — this catches layouts where the
  // catalog lives under e.g. `config/` or `air/` rather than at the repo root.
  let entries: Dirent[];
  try {
    entries = readdirSync(anchor, { withFileTypes: true }) as Dirent[];
  } catch {
    return [...catalogs.values()];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith(".")) continue;
    if (SKIP_DIRS.has(name)) continue;
    // Per-type directories like `skills/` are themselves part of a catalog
    // *rooted at the anchor*, not a catalog on their own. They don't
    // contain `<type>/<type>.json` layouts inside themselves anyway, so
    // `tryCatalogAt` will quietly return. No special-case needed.
    tryCatalogAt(resolve(anchor, name));
  }

  return [...catalogs.values()];
}

/**
 * Discover AIR index files and `air.json` configs under `targetDir`.
 *
 * Anchor is the enclosing git root (via `git rev-parse --show-toplevel`)
 * if one exists, else `targetDir` itself. Walks up to `maxDepth` levels
 * deep, skipping `node_modules/`, `.git/`, build output dirs, and anything
 * starting with `.`. Every candidate file is validated via filename-based
 * schema detection plus optional `$schema` cross-check; unparseable or
 * non-AIR JSON files are silently skipped.
 *
 * Files found via a catalog layout are excluded from `looseIndexes` — the
 * catalog entry already covers them.
 */
export function discoverIndexes(
  targetDir: string,
  options?: DiscoverIndexesOptions
): DiscoveryResult {
  const { anchor, isGitRoot } = resolveAnchor(targetDir);
  const maxDepth = options?.maxDepth ?? MAX_DEPTH;
  const skipDirs = options?.skipDirs ?? SKIP_DIRS;

  const catalogs = findCatalogs(anchor);

  // Build a set of file paths already covered by a catalog so we don't
  // double-count them as loose indexes.
  const catalogCovered = new Set<string>();
  for (const cat of catalogs) {
    for (const type of cat.types) {
      catalogCovered.add(resolve(cat.path, type, `${type}.json`));
    }
  }

  const looseIndexes: DiscoveredLooseIndex[] = [];
  const airJsons: DiscoveredAirJson[] = [];

  for (const file of walkJsonFiles(anchor, maxDepth, skipDirs)) {
    if (catalogCovered.has(file)) continue;

    const name = basename(file);
    // End-with `.schema.json` is excluded by detectSchemaType.
    const type = detectSchemaType(name);
    if (!type) continue;

    if (type === "air") {
      if (readAirJson(file)) {
        airJsons.push({
          path: file,
          relPath: relative(anchor, file),
        });
      }
      continue;
    }

    if (!(CATALOG_TYPES as readonly string[]).includes(type)) continue;
    const data = readAndValidateIndex(file, type as CatalogType);
    if (!data) continue;
    looseIndexes.push({
      type: type as CatalogType,
      path: file,
      relPath: relative(anchor, file),
      entryCount: countEntries(data),
    });
  }

  // Stable ordering: shallowest first, then alphabetic. Makes test assertions
  // deterministic and produces predictable prompt output.
  const byPath = (a: { relPath: string }, b: { relPath: string }) => {
    const da = a.relPath.split(sep).length;
    const db = b.relPath.split(sep).length;
    if (da !== db) return da - db;
    return a.relPath.localeCompare(b.relPath);
  };
  catalogs.sort(byPath);
  looseIndexes.sort(byPath);
  airJsons.sort(byPath);

  return {
    anchor,
    anchorIsGitRoot: isGitRoot,
    catalogs,
    looseIndexes,
    airJsons,
  };
}

export type { CatalogType };
export { CATALOG_TYPES };
