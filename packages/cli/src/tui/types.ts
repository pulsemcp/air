import type {
  LocalArtifacts,
  ResolvedArtifacts,
  RootEntry,
} from "@pulsemcp/air-sdk";

export type ArtifactCategory = "mcp" | "skills" | "hooks" | "plugins";

export interface ArtifactItem {
  id: string;
  description: string;
  selected: boolean;
  /**
   * Locally-tracked artifacts (e.g. skills checked into `.claude/skills/`)
   * are always active from the agent's perspective. They show up in the TUI
   * for visibility but cannot be toggled here — to disable, the user must
   * remove or move the directory in their repo.
   */
  readOnly?: boolean;
}

export interface TuiState {
  tabs: ArtifactCategory[];
  activeTab: number;
  items: Record<ArtifactCategory, ArtifactItem[]>;
  cursors: Record<ArtifactCategory, number>;
  /** Scroll offset per tab (index of top visible item) */
  scrollOffsets: Record<ArtifactCategory, number>;
  root?: RootEntry;
  /** The key of the root in artifacts.roots */
  rootId?: string;
  rootAutoDetected: boolean;
  /** Search/filter mode */
  searchActive: boolean;
  searchQuery: string;
}

export interface TuiResult {
  mcpServers: string[];
  skills: string[];
  hooks: string[];
  plugins: string[];
}

/** Categories where prepareSession supports override arrays */
export const OVERRIDABLE_CATEGORIES: Set<ArtifactCategory> = new Set([
  "mcp",
  "skills",
  "hooks",
  "plugins",
]);

export const CATEGORY_LABELS: Record<ArtifactCategory, string> = {
  mcp: "MCP",
  skills: "Skills",
  hooks: "Hooks",
  plugins: "Plugins",
};

/** Get items for the active tab, filtered by search query if active */
export function getVisibleItems(state: TuiState): ArtifactItem[] {
  const cat = state.tabs[state.activeTab];
  if (!cat) return [];
  const items = state.items[cat];
  if (!state.searchActive || !state.searchQuery) return items;
  const q = state.searchQuery.toLowerCase();
  return items.filter(
    (item) =>
      item.id.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
  );
}

/**
 * Compute merged default IDs by unioning the parent root's defaults with
 * all subagent roots' defaults.
 */
export function getMergedDefaults(
  root: RootEntry | undefined,
  allRoots: Record<string, RootEntry>
): { mcpServerIds: string[]; skillIds: string[]; hookIds: string[]; pluginIds: string[] } {
  const mcpSet = new Set(root?.default_mcp_servers ?? []);
  const skillSet = new Set(root?.default_skills ?? []);
  const hookSet = new Set(root?.default_hooks ?? []);
  const pluginSet = new Set(root?.default_plugins ?? []);

  for (const subId of root?.default_subagent_roots ?? []) {
    const sub = allRoots[subId];
    if (!sub) continue;
    if (sub.default_mcp_servers) {
      for (const id of sub.default_mcp_servers) mcpSet.add(id);
    }
    if (sub.default_skills) {
      for (const id of sub.default_skills) skillSet.add(id);
    }
    if (sub.default_hooks) {
      for (const id of sub.default_hooks) hookSet.add(id);
    }
    if (sub.default_plugins) {
      for (const id of sub.default_plugins) pluginSet.add(id);
    }
  }

  return {
    mcpServerIds: [...mcpSet],
    skillIds: [...skillSet],
    hookIds: [...hookSet],
    pluginIds: [...pluginSet],
  };
}

export function buildInitialState(
  artifacts: ResolvedArtifacts,
  root?: RootEntry,
  rootId?: string,
  rootAutoDetected = false,
  skipSubagentMerge = false,
  localArtifacts?: LocalArtifacts
): TuiState {
  const buildItems = (
    entries: Record<string, { description?: string; title?: string }>,
    defaults?: string[]
  ): ArtifactItem[] => {
    const defaultSet = defaults ? new Set(defaults) : null;
    return Object.entries(entries)
      .map(([id, entry]) => ({
        id,
        description: entry.description || entry.title || "(no description)",
        selected: defaultSet ? defaultSet.has(id) : false,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  };

  // Compute merged defaults from subagent roots unless merge is disabled
  const merged = skipSubagentMerge
    ? {
        mcpServerIds: root?.default_mcp_servers ?? [],
        skillIds: root?.default_skills ?? [],
        hookIds: root?.default_hooks ?? [],
        pluginIds: root?.default_plugins ?? [],
      }
    : getMergedDefaults(root, artifacts.roots);

  const mcpDefaults = merged.mcpServerIds.length > 0 ? merged.mcpServerIds : root?.default_mcp_servers;
  const skillDefaults = merged.skillIds.length > 0 ? merged.skillIds : root?.default_skills;
  const hookDefaults = merged.hookIds.length > 0 ? merged.hookIds : root?.default_hooks;
  const pluginDefaults = merged.pluginIds.length > 0 ? merged.pluginIds : root?.default_plugins;

  const items: Record<ArtifactCategory, ArtifactItem[]> = {
    mcp: buildItems(artifacts.mcp, mcpDefaults),
    skills: mergeLocalSkills(
      buildItems(artifacts.skills, skillDefaults),
      localArtifacts?.skills ?? []
    ),
    hooks: buildItems(artifacts.hooks, hookDefaults),
    plugins: buildItems(artifacts.plugins, pluginDefaults),
  };

  const tabs = (
    ["mcp", "skills", "hooks", "plugins"] as ArtifactCategory[]
  ).filter((cat) => items[cat].length > 0);

  const cursors = { mcp: 0, skills: 0, hooks: 0, plugins: 0 };
  const scrollOffsets = { mcp: 0, skills: 0, hooks: 0, plugins: 0 };

  return {
    tabs,
    activeTab: 0,
    items,
    cursors,
    scrollOffsets,
    root,
    rootId,
    rootAutoDetected,
    searchActive: false,
    searchQuery: "",
  };
}

export function getSelectedIds(state: TuiState): TuiResult {
  // Read-only items (e.g. local skills already in `.claude/skills/`) are
  // excluded — they're not part of AIR's override set, and some may have
  // IDs that don't exist in `artifacts.skills`, which would fail validation
  // downstream.
  const pickSelected = (items: ArtifactItem[]): string[] =>
    items.filter((i) => i.selected && !i.readOnly).map((i) => i.id);

  return {
    mcpServers: pickSelected(state.items.mcp),
    skills: pickSelected(state.items.skills),
    hooks: pickSelected(state.items.hooks),
    plugins: pickSelected(state.items.plugins),
  };
}

/**
 * Fold local skills (checked into `.claude/skills/`) into the skills list.
 * If a local skill's ID matches a catalog skill, replace the catalog entry
 * with a read-only marker (the adapter's "local wins" rule means the
 * catalog version won't be written anyway). Local skills with no catalog
 * counterpart are appended as standalone read-only entries.
 */
function mergeLocalSkills(
  catalogItems: ArtifactItem[],
  localSkills: { id: string; title?: string; description: string }[]
): ArtifactItem[] {
  if (localSkills.length === 0) return catalogItems;

  const byId = new Map(catalogItems.map((it) => [it.id, it]));

  for (const local of localSkills) {
    const description = local.description || local.title || "(local skill)";
    const existing = byId.get(local.id);
    if (existing) {
      existing.readOnly = true;
      existing.selected = true;
    } else {
      byId.set(local.id, {
        id: local.id,
        description,
        selected: true,
        readOnly: true,
      });
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Get selection summary across all artifact types */
export function getAllSelectionSummary(
  state: TuiState
): { category: ArtifactCategory; label: string; selected: string[]; total: number }[] {
  return state.tabs.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    selected: state.items[cat].filter((i) => i.selected).map((i) => i.id),
    total: state.items[cat].length,
  }));
}
