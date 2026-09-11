import {
  isQualified,
  loadManifest,
  parseQualifiedId,
  type LocalArtifacts,
  type Manifest,
  type ResolvedArtifacts,
} from "@pulsemcp/air-core";

/**
 * Artifacts AIR has already installed into a target directory, expressed as
 * qualified IDs from the resolved catalog so callers (e.g. the `air start`
 * TUI) can compare them directly against `ResolvedArtifacts` keys.
 */
export interface InstalledArtifacts {
  skills: string[];
  mcpServers: string[];
  hooks: string[];
  /**
   * Plugins whose declared skills, MCP servers, and hooks are all installed.
   * The manifest doesn't record plugins directly — adapters expand them into
   * their primitives — so this is inferred from the primitives on disk.
   */
  plugins: string[];
}

export interface GetInstalledArtifactsOptions {
  /** Target directory whose AIR manifest should be read. */
  target: string;
  /**
   * Adapter name (`AgentAdapter.name`). A manifest recorded by a different
   * adapter describes another agent's files and is ignored.
   */
  adapter: string;
  /** Resolved artifacts, used to map the manifest's shortnames to qualified IDs. */
  artifacts: ResolvedArtifacts;
  /**
   * Qualified IDs to prefer when a manifest shortname matches entries in
   * more than one scope (typically the merged root defaults).
   */
  prefer?: {
    skills?: string[];
    mcpServers?: string[];
    hooks?: string[];
  };
  /** Override the AIR home directory the manifest is read from. */
  airHome?: string;
}

/**
 * Load the manifest for `targetDir` if it was written by `adapter`. Manifests
 * that predate the `adapter` field are accepted — adapters reconcile against
 * them unconditionally, so they are the best available record of what AIR
 * wrote. Returns null when there is no usable manifest.
 */
function loadAdapterManifest(
  targetDir: string,
  adapter: string,
  options?: { airHome?: string }
): Manifest | null {
  const manifest = loadManifest(targetDir, options);
  if (!manifest) return null;
  if (manifest.adapter !== undefined && manifest.adapter !== adapter) {
    return null;
  }
  return manifest;
}

/**
 * Report what AIR has already installed into `target` for `adapter`, based on
 * the per-target manifest adapters write in `prepareSession`.
 *
 * Returns null when nothing is recorded for this target (first run, corrupt
 * manifest, or a manifest written by another adapter) — callers should fall
 * back to root defaults. An empty category in a returned value is meaningful:
 * the last run installed nothing of that type.
 *
 * The manifest stores the shortnames used for filesystem materialization.
 * Each is mapped back to the catalog entry with that shortname; when several
 * scopes provide it, the one listed in `prefer` wins, and if that still
 * doesn't settle it the shortname is left out rather than guessed. Shortnames
 * no longer present in the catalog are dropped.
 */
export function getInstalledArtifacts(
  options: GetInstalledArtifactsOptions
): InstalledArtifacts | null {
  const manifest = loadAdapterManifest(options.target, options.adapter, {
    airHome: options.airHome,
  });
  if (!manifest) return null;

  const { artifacts, prefer } = options;

  const installedPlugins: string[] = [];
  for (const [id, plugin] of Object.entries(artifacts.plugins)) {
    const declared = [
      ...(plugin.skills ?? []).map((ref) => [manifest.skills, ref] as const),
      ...(plugin.mcp_servers ?? []).map(
        (ref) => [manifest.mcpServers, ref] as const
      ),
      ...(plugin.hooks ?? []).map((ref) => [manifest.hooks, ref] as const),
    ];
    if (declared.length === 0) continue;
    const allInstalled = declared.every(([installed, ref]) =>
      installed.includes(shortnameOf(ref))
    );
    if (allInstalled) installedPlugins.push(id);
  }

  return {
    skills: mapShortnames(manifest.skills, artifacts.skills, prefer?.skills),
    mcpServers: mapShortnames(
      manifest.mcpServers,
      artifacts.mcp,
      prefer?.mcpServers
    ),
    hooks: mapShortnames(manifest.hooks, artifacts.hooks, prefer?.hooks),
    plugins: installedPlugins.sort(),
  };
}

/**
 * Drop local skills that AIR itself installed. Adapters discover local skills
 * by scanning their skills directory, which also holds the skills AIR copied
 * there on earlier runs; those are AIR-managed (tracked in the manifest), not
 * checked into the repo, so they must stay toggleable rather than read-only.
 */
export function excludeInstalledLocalArtifacts(
  local: LocalArtifacts,
  targetDir: string,
  adapter: string,
  options?: { airHome?: string }
): LocalArtifacts {
  const manifest = loadAdapterManifest(targetDir, adapter, options);
  if (!manifest || manifest.skills.length === 0) return local;
  const managed = new Set(manifest.skills);
  return {
    ...local,
    skills: local.skills.filter((skill) => !managed.has(skill.id)),
  };
}

function shortnameOf(ref: string): string {
  return isQualified(ref) ? parseQualifiedId(ref).id : ref;
}

function mapShortnames(
  shortnames: string[],
  pool: Record<string, unknown>,
  prefer: string[] | undefined
): string[] {
  const byShortname = new Map<string, string[]>();
  for (const qualified of Object.keys(pool)) {
    const short = shortnameOf(qualified);
    const list = byShortname.get(short);
    if (list) list.push(qualified);
    else byShortname.set(short, [qualified]);
  }

  const preferred = new Set(prefer ?? []);
  const result = new Set<string>();
  for (const short of shortnames) {
    const candidates = byShortname.get(short) ?? [];
    if (candidates.length === 1) {
      result.add(candidates[0]);
      continue;
    }
    const preferredCandidates = candidates.filter((c) => preferred.has(c));
    if (preferredCandidates.length === 1) result.add(preferredCandidates[0]);
  }
  return [...result].sort();
}
