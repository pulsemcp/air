import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

export interface AirConfig {
  name: string;
  description?: string;
  skills?: string[];
  references?: string[];
  mcp?: string[];
  plugins?: string[];
  roots?: string[];
  hooks?: string[];
}

export interface ResolvedArtifacts {
  skills: Record<string, SkillEntry>;
  references: Record<string, ReferenceEntry>;
  mcp: Record<string, McpServerEntry>;
  plugins: Record<string, PluginEntry>;
  roots: Record<string, RootEntry>;
  hooks: Record<string, HookEntry>;
}

export interface SkillEntry {
  id: string;
  title?: string;
  description: string;
  path: string;
  references?: string[];
}

export interface ReferenceEntry {
  id: string;
  title?: string;
  description: string;
  file: string;
}

export interface McpServerEntry {
  title?: string;
  description?: string;
  type: "stdio" | "sse" | "streamable-http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface PluginEntry {
  id: string;
  title?: string;
  description: string;
  type: "command";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout_seconds?: number;
}

export interface RootEntry {
  name: string;
  display_name?: string;
  description: string;
  url?: string;
  default_branch?: string;
  subdirectory?: string;
  default_mcp_servers?: string[];
  default_skills?: string[];
  default_plugins?: string[];
  default_hooks?: string[];
  user_invocable?: boolean;
  default_stop_condition?: string;
}

export interface HookEntry {
  id: string;
  title?: string;
  description: string;
  event: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout_seconds?: number;
  matcher?: string;
}

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
 * Load and merge entries from an array of index file paths.
 * Files are resolved relative to baseDir. Later files override earlier ones by ID.
 */
function loadAndMerge<T>(
  paths: string[],
  baseDir: string
): Record<string, T> {
  let merged: Record<string, T> = {};
  for (const p of paths) {
    const data = loadJsonFile(resolve(baseDir, p));
    const entries = stripSchema(data) as Record<string, T>;
    merged = { ...merged, ...entries };
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

/**
 * Resolve all artifacts from an air.json file.
 * Each artifact property is an array of paths; files merge in order.
 */
export function resolveArtifacts(airJsonPath: string): ResolvedArtifacts {
  const airConfig = loadAirConfig(airJsonPath);
  const baseDir = dirname(resolve(airJsonPath));

  return {
    skills: loadAndMerge<SkillEntry>(airConfig.skills || [], baseDir),
    references: loadAndMerge<ReferenceEntry>(airConfig.references || [], baseDir),
    mcp: loadAndMerge<McpServerEntry>(airConfig.mcp || [], baseDir),
    plugins: loadAndMerge<PluginEntry>(airConfig.plugins || [], baseDir),
    roots: loadAndMerge<RootEntry>(airConfig.roots || [], baseDir),
    hooks: loadAndMerge<HookEntry>(airConfig.hooks || [], baseDir),
  };
}

/**
 * Merge two resolved artifact sets. Override wins for matching IDs.
 */
export function mergeArtifacts(
  base: ResolvedArtifacts,
  override: ResolvedArtifacts
): ResolvedArtifacts {
  return {
    skills: { ...base.skills, ...override.skills },
    references: { ...base.references, ...override.references },
    mcp: { ...base.mcp, ...override.mcp },
    plugins: { ...base.plugins, ...override.plugins },
    roots: { ...base.roots, ...override.roots },
    hooks: { ...base.hooks, ...override.hooks },
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
