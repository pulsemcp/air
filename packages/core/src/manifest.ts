import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, resolve } from "path";

/**
 * Manifest schema version. Incrementing this is a breaking change to the
 * on-disk format; future versions should be tolerant of older manifests
 * (treat unrecognized shapes as empty, same as the corrupt-manifest path).
 */
export const MANIFEST_VERSION = 1;

/**
 * The on-disk record of artifacts AIR has written to a single target
 * directory. Persisted at `<airHome>/manifests/<sha256(targetDir)>.json`.
 */
export interface Manifest {
  version: number;
  /** Absolute target directory this manifest describes. */
  target: string;
  /** Skill IDs whose `.claude/skills/<id>/` (or adapter equivalent) AIR owns. */
  skills: string[];
  /** Hook IDs whose `.claude/hooks/<id>/` (or adapter equivalent) AIR owns. */
  hooks: string[];
  /** MCP server IDs whose key in `.mcp.json` (or adapter equivalent) AIR owns. */
  mcpServers: string[];
}

/**
 * The current selection of artifacts for a target directory — what should
 * exist on disk after this run. Any ID present in a previous manifest but
 * absent here is stale and should be cleaned up.
 */
export interface ManifestSelection {
  skills?: string[];
  hooks?: string[];
  mcpServers?: string[];
}

/**
 * IDs present in the previous manifest but not in the current selection.
 * These are the artifacts an adapter should remove before writing new ones.
 */
export interface ManifestDiff {
  staleSkills: string[];
  staleHooks: string[];
  staleMcpServers: string[];
}

/**
 * Default root of AIR's per-user state directory (contains air.json,
 * manifests/, etc). Honors `AIR_HOME` for relocation (primarily for tests
 * and sandboxed environments), then HOME/USERPROFILE, falling back to "~".
 */
export function getDefaultAirHome(): string {
  if (process.env.AIR_HOME) {
    return resolve(process.env.AIR_HOME);
  }
  return resolve(
    process.env.HOME || process.env.USERPROFILE || "~",
    ".air"
  );
}

/**
 * Absolute path to the manifest file for a given target directory.
 *
 * The filename is the SHA-256 of the absolute, normalized target path,
 * so manifests live outside the project (invisible to the user, no
 * .gitignore management) and are keyed deterministically per-project.
 */
export function getManifestPath(
  targetDir: string,
  options?: { airHome?: string }
): string {
  const airHome = options?.airHome ?? getDefaultAirHome();
  const absTarget = resolve(targetDir);
  const hash = createHash("sha256").update(absTarget).digest("hex");
  return resolve(airHome, "manifests", `${hash}.json`);
}

/**
 * Load the manifest for `targetDir`.
 *
 * Returns `null` if the manifest is missing, unreadable, not valid JSON,
 * or doesn't match the expected shape. Callers should treat `null` as
 * "no prior state" and skip cleanup — this is the documented behavior
 * for missing / corrupt manifests.
 */
export function loadManifest(
  targetDir: string,
  options?: { airHome?: string }
): Manifest | null {
  const path = getManifestPath(targetDir, options);
  if (!existsSync(path)) return null;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isManifestShape(parsed)) return null;
  return parsed;
}

function isManifestShape(value: unknown): value is Manifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  if (typeof m.version !== "number") return false;
  if (typeof m.target !== "string") return false;
  if (!isStringArray(m.skills)) return false;
  if (!isStringArray(m.hooks)) return false;
  if (!isStringArray(m.mcpServers)) return false;
  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Persist `manifest` to disk at the path determined by its `target` field.
 * Creates the parent directory as needed.
 */
export function writeManifest(
  manifest: Manifest,
  options?: { airHome?: string }
): string {
  const path = getManifestPath(manifest.target, options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return path;
}

/**
 * Build a fresh manifest from the current target and selection.
 * Undefined category fields in the selection are normalized to `[]`.
 */
export function buildManifest(
  targetDir: string,
  selection: ManifestSelection
): Manifest {
  return {
    version: MANIFEST_VERSION,
    target: resolve(targetDir),
    skills: [...(selection.skills ?? [])],
    hooks: [...(selection.hooks ?? [])],
    mcpServers: [...(selection.mcpServers ?? [])],
  };
}

/**
 * Compute IDs that are in the previous manifest but not in the current
 * selection. A null `prev` means "no prior state" — nothing is stale.
 */
export function diffManifest(
  prev: Manifest | null,
  next: ManifestSelection
): ManifestDiff {
  if (!prev) {
    return { staleSkills: [], staleHooks: [], staleMcpServers: [] };
  }
  const nextSkills = new Set(next.skills ?? []);
  const nextHooks = new Set(next.hooks ?? []);
  const nextMcpServers = new Set(next.mcpServers ?? []);

  return {
    staleSkills: prev.skills.filter((id) => !nextSkills.has(id)),
    staleHooks: prev.hooks.filter((id) => !nextHooks.has(id)),
    staleMcpServers: prev.mcpServers.filter((id) => !nextMcpServers.has(id)),
  };
}
