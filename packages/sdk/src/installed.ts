import {
  isQualified,
  loadManifest,
  parseQualifiedId,
  type LocalArtifacts,
  type Manifest,
  type ResolvedArtifacts,
} from "@pulsemcp/air-core";

/**
 * A selection, in qualified catalog IDs, that reproduces what AIR already
 * installed into a target directory: handing it back to `prepareSession`
 * leaves the directory as it is. Used to preselect the `air start` TUI.
 */
export interface InstalledSelection {
  /**
   * Installed skills. `undefined` when an installed shortname can't be mapped
   * to exactly one catalog entry — callers should use root defaults for the
   * category, as they would with no record at all.
   */
  skills?: string[];
  /** Installed MCP servers; `undefined` as for `skills`. */
  mcpServers?: string[];
  /** Installed hooks; `undefined` as for `skills`. */
  hooks?: string[];
  /**
   * Default plugins whose declared skills, MCP servers, and hooks are all
   * installed. The manifest doesn't record plugins — adapters expand them
   * into their primitives — so a plugin the user added beyond the defaults
   * isn't recognised; its primitives are selected individually instead.
   */
  plugins: string[];
}

export interface GetInstalledSelectionOptions {
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
   * The root's (merged) default IDs. They settle shortnames that several
   * scopes provide, and decide which plugins can be preselected.
   */
  defaults?: {
    skills?: string[];
    mcpServers?: string[];
    hooks?: string[];
    plugins?: string[];
  };
  /** Override the AIR home directory the manifest is read from. */
  airHome?: string;
}

type PrimitiveCategory = "skills" | "mcpServers" | "hooks";

/**
 * Load the manifest for `targetDir` unless another adapter wrote it.
 * Manifests that predate the `adapter` field are accepted, since they can't
 * be attributed. Best-effort: returns null when there is no usable manifest
 * or it can't be located (e.g. no home directory to resolve AIR home from).
 */
function loadAdapterManifest(
  targetDir: string,
  adapter: string,
  options?: { airHome?: string }
): Manifest | null {
  let manifest: Manifest | null;
  try {
    manifest = loadManifest(targetDir, options);
  } catch {
    return null;
  }
  if (!manifest) return null;
  if (manifest.adapter !== undefined && manifest.adapter !== adapter) {
    return null;
  }
  return manifest;
}

/**
 * Report the selection that reproduces what AIR has already installed into
 * `target` for `adapter`, based on the per-target manifest adapters write in
 * `prepareSession`.
 *
 * Returns null when nothing is recorded for this target (first run, corrupt
 * manifest, or a manifest written by another adapter) — callers should fall
 * back to root defaults. An empty category is meaningful: the last run
 * installed nothing of that type.
 *
 * The manifest stores the shortnames used for filesystem materialization;
 * each is mapped back to the catalog entry with that shortname. When several
 * scopes provide it, the one among `defaults` wins; if that doesn't settle
 * it, the whole category is left `undefined` rather than guessed. Shortnames
 * no longer in the catalog are dropped.
 *
 * A primitive that a preselected plugin provides is only selected on its own
 * when it is also a default, so deselecting the plugin still removes it, as
 * it would from a defaults-based selection.
 */
export function getInstalledSelection(
  options: GetInstalledSelectionOptions
): InstalledSelection | null {
  const manifest = loadAdapterManifest(options.target, options.adapter, {
    airHome: options.airHome,
  });
  if (!manifest) return null;

  const { artifacts } = options;
  const defaults: Record<PrimitiveCategory | "plugins", Set<string>> = {
    skills: new Set(options.defaults?.skills ?? []),
    mcpServers: new Set(options.defaults?.mcpServers ?? []),
    hooks: new Set(options.defaults?.hooks ?? []),
    plugins: new Set(options.defaults?.plugins ?? []),
  };

  const installed: Record<PrimitiveCategory, string[] | undefined> = {
    skills: mapShortnames(manifest.skills, artifacts.skills, defaults.skills),
    mcpServers: mapShortnames(
      manifest.mcpServers,
      artifacts.mcp,
      defaults.mcpServers
    ),
    hooks: mapShortnames(manifest.hooks, artifacts.hooks, defaults.hooks),
  };
  const isInstalled = (category: PrimitiveCategory, ref: string): boolean =>
    installed[category]?.includes(ref) ??
    manifest[category].includes(shortnameOf(ref));

  const plugins: string[] = [];
  const covered = new Set<string>();
  for (const id of Object.keys(artifacts.plugins).sort()) {
    if (!defaults.plugins.has(id)) continue;
    const plugin = artifacts.plugins[id];
    const declared = [
      ...tagged("skills", plugin.skills),
      ...tagged("mcpServers", plugin.mcp_servers),
      ...tagged("hooks", plugin.hooks),
    ];
    if (!declared.every(([category, ref]) => isInstalled(category, ref))) {
      continue;
    }
    plugins.push(id);
    for (const [, ref] of declared) covered.add(ref);
  }

  const individually = (category: PrimitiveCategory) =>
    installed[category]?.filter(
      (id) => !covered.has(id) || defaults[category].has(id)
    );

  return {
    skills: individually("skills"),
    mcpServers: individually("mcpServers"),
    hooks: individually("hooks"),
    plugins,
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

function tagged(
  category: PrimitiveCategory,
  refs: string[] | undefined
): [PrimitiveCategory, string][] {
  return (refs ?? []).map((ref) => [category, ref]);
}

function shortnameOf(ref: string): string {
  return isQualified(ref) ? parseQualifiedId(ref).id : ref;
}

/**
 * Map manifest shortnames to qualified IDs in `pool`. Returns undefined when
 * some shortname matches several entries and `defaults` doesn't pick one.
 */
function mapShortnames(
  shortnames: string[],
  pool: Record<string, unknown>,
  defaults: Set<string>
): string[] | undefined {
  const byShortname = new Map<string, string[]>();
  for (const qualified of Object.keys(pool)) {
    const short = shortnameOf(qualified);
    const list = byShortname.get(short);
    if (list) list.push(qualified);
    else byShortname.set(short, [qualified]);
  }

  const result = new Set<string>();
  for (const short of shortnames) {
    const candidates = byShortname.get(short) ?? [];
    if (candidates.length === 0) continue;
    if (candidates.length === 1) {
      result.add(candidates[0]);
      continue;
    }
    const inDefaults = candidates.filter((c) => defaults.has(c));
    if (inDefaults.length !== 1) return undefined;
    result.add(inDefaults[0]);
  }
  return [...result].sort();
}
