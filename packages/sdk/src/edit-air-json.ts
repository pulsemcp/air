import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, relative, isAbsolute } from "path";
import { getDefaultAirJsonPath } from "@pulsemcp/air-core";
import type {
  DiscoveredCatalog,
  DiscoveredLooseIndex,
  DiscoveredAirJson,
  CatalogType,
} from "./discover-indexes.js";

const SCHEMA_BASE_URL =
  "https://raw.githubusercontent.com/pulsemcp/air/main/schemas";

const CATALOG_TYPES: readonly CatalogType[] = [
  "skills",
  "references",
  "mcp",
  "plugins",
  "roots",
  "hooks",
];

/** Shape of the entries we write — loose indexes get a type, catalogs get the catalogs[] slot. */
export interface AirJsonAddition {
  kind: "catalog" | "loose" | "airJson";
  /** Path or URI string written to air.json. */
  value: string;
  /** For loose/airJson entries, the artifact type slot the value was written to. */
  type?: CatalogType;
  /** Short human-readable summary used by the acceptance output. */
  label: string;
}

export interface EditAirJsonOptions {
  /** Override the default air.json path. */
  path?: string;
  /** Entries already persisted into air.json become no-ops. Default: true. */
  idempotent?: boolean;
}

export interface EditAirJsonResult {
  /** Absolute path to the air.json that was read/written. */
  airJsonPath: string;
  /** Entries that were newly added. */
  added: AirJsonAddition[];
  /** Entries that were already present and therefore skipped. */
  skipped: AirJsonAddition[];
  /** True if the scaffold was created because no air.json existed. */
  createdScaffold: boolean;
}

interface AirJsonShape {
  $schema?: string;
  name: string;
  description?: string;
  extensions?: string[];
  catalogs?: string[];
  skills?: string[];
  references?: string[];
  mcp?: string[];
  plugins?: string[];
  roots?: string[];
  hooks?: string[];
  [key: string]: unknown;
}

function loadOrScaffold(airJsonPath: string): {
  data: AirJsonShape;
  created: boolean;
} {
  if (!existsSync(airJsonPath)) {
    mkdirSync(dirname(airJsonPath), { recursive: true });
    const scaffold: AirJsonShape = {
      $schema: `${SCHEMA_BASE_URL}/air.schema.json`,
      name: "my-config",
      description: "Personal AIR configuration",
    };
    return { data: scaffold, created: true };
  }
  const raw = readFileSync(airJsonPath, "utf-8");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${airJsonPath} is not a JSON object — refusing to edit.`
    );
  }
  return { data: parsed as AirJsonShape, created: false };
}

/**
 * Normalize a path string for comparison against air.json entries. Entries
 * in air.json may be:
 * - absolute (`/abs/path/to/skills.json`)
 * - relative to the air.json directory (`./skills/skills.json`, `../foo/skills.json`)
 * - a URI (`github://…`) — passed through untouched
 *
 * We compare by absolute path when possible so "./skills/skills.json" and its
 * fully-resolved absolute twin are recognized as the same entry.
 */
function normalizeToAbsolute(
  entry: string,
  airJsonDir: string
): string {
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(entry)) return entry;
  if (isAbsolute(entry)) return resolve(entry);
  return resolve(airJsonDir, entry);
}

/**
 * Check whether `candidate` (an absolute path or URI) is already present in the
 * given list of air.json entries. Performs path normalization so absolute,
 * `./relative`, and `../relative` forms of the same file all collide.
 */
export function entryAlreadyListed(
  candidateAbsOrUri: string,
  list: string[] | undefined,
  airJsonDir: string
): boolean {
  if (!list || list.length === 0) return false;
  const isUri = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(candidateAbsOrUri);
  if (isUri) {
    return list.includes(candidateAbsOrUri);
  }
  const candidateAbs = resolve(candidateAbsOrUri);
  for (const entry of list) {
    const normalized = normalizeToAbsolute(entry, airJsonDir);
    if (normalized === candidateAbs) return true;
  }
  return false;
}

/**
 * Produce the relative path written to air.json for an absolute target.
 *
 * We emit `./` or `../`-prefixed relative paths for targets that live under
 * or above the air.json directory respectively. Targets on an entirely
 * different volume (uncommon) fall back to the absolute path.
 */
function toAirJsonRelPath(absTarget: string, airJsonDir: string): string {
  const rel = relative(airJsonDir, absTarget);
  if (!rel) return "./";
  if (rel.startsWith("..")) return rel;
  if (isAbsolute(rel)) return rel;
  return "./" + rel;
}

/**
 * Return all artifact-type entry arrays that are already present in the
 * air.json, defaulting each to `[]` if absent so callers can push without
 * pre-existence checks.
 */
function ensureArray(
  data: AirJsonShape,
  key:
    | "catalogs"
    | "skills"
    | "references"
    | "mcp"
    | "plugins"
    | "roots"
    | "hooks"
): string[] {
  if (!data[key]) data[key] = [];
  return data[key] as string[];
}

function formatLabel(
  kind: AirJsonAddition["kind"],
  target: string,
  type?: CatalogType
): string {
  if (kind === "catalog") return `catalog '${target}'`;
  if (kind === "airJson") return `air.json '${target}'`;
  return `${type} '${target}'`;
}

export interface AddDiscoveredEntries {
  catalogs?: DiscoveredCatalog[];
  looseIndexes?: DiscoveredLooseIndex[];
  airJsons?: DiscoveredAirJson[];
}

/**
 * Add discovered entries to the user's air.json.
 *
 * Catalogs go into `catalogs[]`. Loose indexes go into the matching per-type
 * array (`skills[]`, `mcp[]`, …). Nested `air.json` files land in
 * `catalogs[]` because they describe a full composition at their location —
 * the user can further edit the reference later. All additions are
 * idempotent: an entry already present in air.json is not duplicated.
 *
 * If the target air.json does not exist, a minimal scaffold is written
 * (no local index files — for a full workspace scaffold use `initConfig`).
 */
export function addDiscoveredToAirJson(
  entries: AddDiscoveredEntries,
  options?: EditAirJsonOptions
): EditAirJsonResult {
  const airJsonPath = options?.path ?? getDefaultAirJsonPath();
  const airJsonDir = dirname(resolve(airJsonPath));
  const { data, created } = loadOrScaffold(airJsonPath);

  const added: AirJsonAddition[] = [];
  const skipped: AirJsonAddition[] = [];

  for (const catalog of entries.catalogs ?? []) {
    const value = toAirJsonRelPath(catalog.path, airJsonDir);
    const list = ensureArray(data, "catalogs");
    if (entryAlreadyListed(catalog.path, list, airJsonDir)) {
      skipped.push({
        kind: "catalog",
        value,
        label: formatLabel("catalog", value),
      });
      continue;
    }
    list.push(value);
    added.push({
      kind: "catalog",
      value,
      label: formatLabel("catalog", value),
    });
  }

  for (const airJson of entries.airJsons ?? []) {
    // A nested air.json is semantically a catalog reference — the directory
    // containing it typically follows the standard layout.
    const catalogDir = dirname(airJson.path);
    const value = toAirJsonRelPath(catalogDir, airJsonDir);
    const list = ensureArray(data, "catalogs");
    if (entryAlreadyListed(catalogDir, list, airJsonDir)) {
      skipped.push({
        kind: "airJson",
        value,
        label: formatLabel("airJson", value),
      });
      continue;
    }
    list.push(value);
    added.push({
      kind: "airJson",
      value,
      label: formatLabel("airJson", value),
    });
  }

  for (const loose of entries.looseIndexes ?? []) {
    if (!CATALOG_TYPES.includes(loose.type)) continue;
    const value = toAirJsonRelPath(loose.path, airJsonDir);
    const list = ensureArray(data, loose.type);
    if (entryAlreadyListed(loose.path, list, airJsonDir)) {
      skipped.push({
        kind: "loose",
        value,
        type: loose.type,
        label: formatLabel("loose", value, loose.type),
      });
      continue;
    }
    list.push(value);
    added.push({
      kind: "loose",
      value,
      type: loose.type,
      label: formatLabel("loose", value, loose.type),
    });
  }

  if (added.length > 0 || created) {
    mkdirSync(dirname(airJsonPath), { recursive: true });
    writeFileSync(airJsonPath, JSON.stringify(data, null, 2) + "\n");
  }

  return {
    airJsonPath,
    added,
    skipped,
    createdScaffold: created,
  };
}

/**
 * Inspect whether a discovered candidate is already registered in air.json.
 * Used by the discovery filter to drop items that are already composed.
 */
export interface RegisteredChecker {
  catalog(absPath: string): boolean;
  loose(type: CatalogType, absPath: string): boolean;
  airJson(absPath: string): boolean;
}

export function buildRegisteredChecker(
  airJsonPath: string | null
): RegisteredChecker {
  if (!airJsonPath || !existsSync(airJsonPath)) {
    return {
      catalog: () => false,
      loose: () => false,
      airJson: () => false,
    };
  }
  let data: AirJsonShape;
  try {
    data = JSON.parse(readFileSync(airJsonPath, "utf-8"));
  } catch {
    return {
      catalog: () => false,
      loose: () => false,
      airJson: () => false,
    };
  }
  const airJsonDir = dirname(resolve(airJsonPath));
  return {
    catalog(absPath: string): boolean {
      return entryAlreadyListed(absPath, data.catalogs, airJsonDir);
    },
    loose(type: CatalogType, absPath: string): boolean {
      const list = data[type] as string[] | undefined;
      if (entryAlreadyListed(absPath, list, airJsonDir)) return true;
      return entryAlreadyListed(absPath, data.catalogs, airJsonDir);
    },
    airJson(absPath: string): boolean {
      const catalogDir = dirname(absPath);
      return entryAlreadyListed(catalogDir, data.catalogs, airJsonDir);
    },
  };
}
