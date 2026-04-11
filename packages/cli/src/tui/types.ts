import type { ResolvedArtifacts, RootEntry } from "@pulsemcp/air-sdk";

export type ArtifactCategory = "mcp" | "skills" | "hooks" | "plugins";

export interface ArtifactItem {
  id: string;
  description: string;
  selected: boolean;
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
}

/** Categories where prepareSession supports override arrays */
export const OVERRIDABLE_CATEGORIES: Set<ArtifactCategory> = new Set([
  "mcp",
  "skills",
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
 * all subagent roots' defaults (MCP servers and skills only).
 */
export function getMergedDefaults(
  root: RootEntry | undefined,
  allRoots: Record<string, RootEntry>
): { mcpServerIds: string[]; skillIds: string[] } {
  const mcpSet = new Set(root?.default_mcp_servers ?? []);
  const skillSet = new Set(root?.default_skills ?? []);

  for (const subId of root?.default_subagent_roots ?? []) {
    const sub = allRoots[subId];
    if (!sub) continue;
    if (sub.default_mcp_servers) {
      for (const id of sub.default_mcp_servers) mcpSet.add(id);
    }
    if (sub.default_skills) {
      for (const id of sub.default_skills) skillSet.add(id);
    }
  }

  return {
    mcpServerIds: [...mcpSet],
    skillIds: [...skillSet],
  };
}

export function buildInitialState(
  artifacts: ResolvedArtifacts,
  root?: RootEntry,
  rootId?: string,
  rootAutoDetected = false,
  skipSubagentMerge = false
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
    ? { mcpServerIds: root?.default_mcp_servers ?? [], skillIds: root?.default_skills ?? [] }
    : getMergedDefaults(root, artifacts.roots);

  const mcpDefaults = merged.mcpServerIds.length > 0 ? merged.mcpServerIds : root?.default_mcp_servers;
  const skillDefaults = merged.skillIds.length > 0 ? merged.skillIds : root?.default_skills;

  const items: Record<ArtifactCategory, ArtifactItem[]> = {
    mcp: buildItems(artifacts.mcp, mcpDefaults),
    skills: buildItems(artifacts.skills, skillDefaults),
    hooks: buildItems(artifacts.hooks, root?.default_hooks),
    plugins: buildItems(artifacts.plugins, root?.default_plugins),
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
  return {
    mcpServers: state.items.mcp
      .filter((i) => i.selected)
      .map((i) => i.id),
    skills: state.items.skills
      .filter((i) => i.selected)
      .map((i) => i.id),
  };
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
