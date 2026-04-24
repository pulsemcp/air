import { describe, it, expect } from "vitest";
import type { ResolvedArtifacts } from "@pulsemcp/air-sdk";
import {
  buildInitialState,
  getSelectedIds,
  getVisibleItems,
  getAllSelectionSummary,
  getMergedDefaults,
} from "../src/tui/types.js";

function makeArtifacts(
  overrides: Partial<ResolvedArtifacts> = {}
): ResolvedArtifacts {
  return {
    skills: {},
    references: {},
    mcp: {},
    plugins: {},
    roots: {},
    hooks: {},
    ...overrides,
  };
}

describe("buildInitialState", () => {
  it("returns empty tabs when all artifact categories are empty", () => {
    const state = buildInitialState(makeArtifacts());
    expect(state.tabs).toEqual([]);
    expect(state.items.mcp).toEqual([]);
    expect(state.items.skills).toEqual([]);
  });

  it("includes only non-empty categories as tabs", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          server1: {
            type: "stdio",
            command: "node",
            description: "A server",
          },
        },
        skills: {
          skill1: { description: "A skill", path: "/skills/skill1" },
        },
      })
    );
    expect(state.tabs).toEqual(["mcp", "skills"]);
    expect(state.items.hooks).toEqual([]);
    expect(state.items.plugins).toEqual([]);
  });

  it("includes hooks and plugins tabs when they have items", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          server1: { type: "stdio", command: "node", description: "A server" },
        },
        skills: {
          skill1: { description: "A skill", path: "/skills/skill1" },
        },
        hooks: {
          hook1: { description: "A hook", path: "/hooks/hook1" },
        },
        plugins: {
          plugin1: { description: "A plugin", path: "/plugins/plugin1" },
        },
      })
    );
    expect(state.tabs).toEqual(["mcp", "skills", "hooks", "plugins"]);
  });

  it("selects items matching root defaults", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          server1: {
            type: "stdio",
            command: "node",
            description: "Server 1",
          },
          server2: {
            type: "stdio",
            command: "node",
            description: "Server 2",
          },
        },
      }),
      {
        description: "Test root",
        default_mcp_servers: ["server1"],
      }
    );
    expect(state.items.mcp.find((i) => i.id === "server1")?.selected).toBe(
      true
    );
    expect(state.items.mcp.find((i) => i.id === "server2")?.selected).toBe(
      false
    );
  });

  it("ignores default IDs that don't exist in artifacts", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          server1: {
            type: "stdio",
            command: "node",
            description: "Server 1",
          },
        },
      }),
      {
        description: "Test root",
        default_mcp_servers: ["server1", "nonexistent"],
      }
    );
    expect(state.items.mcp).toHaveLength(1);
    expect(state.items.mcp[0].selected).toBe(true);
  });

  it("sorts items alphabetically by ID", () => {
    const state = buildInitialState(
      makeArtifacts({
        skills: {
          zebra: { description: "Z skill", path: "/skills/zebra" },
          alpha: { description: "A skill", path: "/skills/alpha" },
          middle: { description: "M skill", path: "/skills/middle" },
        },
      })
    );
    expect(state.items.skills.map((i) => i.id)).toEqual([
      "alpha",
      "middle",
      "zebra",
    ]);
  });

  it("stores root metadata", () => {
    const root = { description: "My root", display_name: "My Root" };
    const state = buildInitialState(makeArtifacts(), root, "my-root", true);
    expect(state.root).toBe(root);
    expect(state.rootId).toBe("my-root");
    expect(state.rootAutoDetected).toBe(true);
  });
});

describe("getVisibleItems", () => {
  it("returns all items when search is inactive", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          server1: {
            type: "stdio",
            command: "node",
            description: "Server 1",
          },
          server2: {
            type: "stdio",
            command: "node",
            description: "Server 2",
          },
        },
      })
    );
    expect(getVisibleItems(state)).toHaveLength(2);
  });

  it("filters items by search query matching ID", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          "my-server": {
            type: "stdio",
            command: "node",
            description: "First",
          },
          "other-thing": {
            type: "stdio",
            command: "node",
            description: "Second",
          },
        },
      })
    );
    state.searchActive = true;
    state.searchQuery = "server";
    expect(getVisibleItems(state)).toHaveLength(1);
    expect(getVisibleItems(state)[0].id).toBe("my-server");
  });

  it("filters items by search query matching description", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          a: { type: "stdio", command: "node", description: "Database proxy" },
          b: { type: "stdio", command: "node", description: "File watcher" },
        },
      })
    );
    state.searchActive = true;
    state.searchQuery = "database";
    expect(getVisibleItems(state)).toHaveLength(1);
    expect(getVisibleItems(state)[0].id).toBe("a");
  });

  it("returns all items when search is active but query is empty", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          a: { type: "stdio", command: "node", description: "Server A" },
          b: { type: "stdio", command: "node", description: "Server B" },
        },
      })
    );
    state.searchActive = true;
    state.searchQuery = "";
    expect(getVisibleItems(state)).toHaveLength(2);
  });

  it("returns empty array when no tabs exist", () => {
    const state = buildInitialState(makeArtifacts());
    expect(getVisibleItems(state)).toEqual([]);
  });
});

describe("getSelectedIds", () => {
  it("returns selected IDs for all artifact categories", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          server1: {
            type: "stdio",
            command: "node",
            description: "Server 1",
          },
          server2: {
            type: "stdio",
            command: "node",
            description: "Server 2",
          },
        },
        skills: {
          skill1: { description: "Skill 1", path: "/skills/skill1" },
          skill2: { description: "Skill 2", path: "/skills/skill2" },
        },
        hooks: {
          hook1: { description: "Hook 1", path: "/hooks/hook1" },
          hook2: { description: "Hook 2", path: "/hooks/hook2" },
        },
        plugins: {
          plugin1: { description: "Plugin 1", path: "/plugins/plugin1" },
        },
      }),
      {
        description: "Root",
        default_mcp_servers: ["server1"],
        default_skills: ["skill2"],
        default_hooks: ["hook1"],
        default_plugins: ["plugin1"],
      }
    );
    const result = getSelectedIds(state);
    expect(result.mcpServers).toEqual(["server1"]);
    expect(result.skills).toEqual(["skill2"]);
    expect(result.hooks).toEqual(["hook1"]);
    expect(result.plugins).toEqual(["plugin1"]);
  });

  it("returns empty arrays when nothing is selected", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          server1: {
            type: "stdio",
            command: "node",
            description: "Server 1",
          },
        },
      })
    );
    const result = getSelectedIds(state);
    expect(result.mcpServers).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.hooks).toEqual([]);
    expect(result.plugins).toEqual([]);
  });
});

describe("getAllSelectionSummary", () => {
  it("returns summary for each visible tab", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          server1: {
            type: "stdio",
            command: "node",
            description: "Server 1",
          },
        },
        skills: {
          skill1: { description: "Skill 1", path: "/skills/skill1" },
        },
      }),
      {
        description: "Root",
        default_mcp_servers: ["server1"],
      }
    );
    const summary = getAllSelectionSummary(state);
    expect(summary).toHaveLength(2);
    expect(summary[0]).toEqual({
      category: "mcp",
      label: "MCP",
      selected: ["server1"],
      total: 1,
    });
    expect(summary[1]).toEqual({
      category: "skills",
      label: "Skills",
      selected: [],
      total: 1,
    });
  });

  it("returns empty array when no tabs exist", () => {
    const state = buildInitialState(makeArtifacts());
    expect(getAllSelectionSummary(state)).toEqual([]);
  });
});

describe("getMergedDefaults", () => {
  it("returns parent defaults when no subagent roots exist", () => {
    const result = getMergedDefaults(
      {
        description: "Root",
        default_mcp_servers: ["s1"],
        default_skills: ["sk1"],
        default_hooks: ["h1"],
        default_plugins: ["p1"],
      },
      {}
    );
    expect(result.mcpServerIds).toEqual(["s1"]);
    expect(result.skillIds).toEqual(["sk1"]);
    expect(result.hookIds).toEqual(["h1"]);
    expect(result.pluginIds).toEqual(["p1"]);
  });

  it("returns empty arrays when root has no defaults and no subagents", () => {
    const result = getMergedDefaults({ description: "Root" }, {});
    expect(result.mcpServerIds).toEqual([]);
    expect(result.skillIds).toEqual([]);
    expect(result.hookIds).toEqual([]);
    expect(result.pluginIds).toEqual([]);
  });

  it("unions parent and subagent defaults across all categories", () => {
    const roots = {
      "sub-a": {
        description: "Sub A",
        default_mcp_servers: ["s2", "s3"],
        default_skills: ["sk2"],
        default_hooks: ["h2"],
        default_plugins: ["p2"],
      },
      "sub-b": {
        description: "Sub B",
        default_mcp_servers: ["s3", "s4"],
        default_skills: ["sk3"],
        default_hooks: ["h2", "h3"],
        default_plugins: ["p3"],
      },
    };
    const result = getMergedDefaults(
      {
        description: "Parent",
        default_mcp_servers: ["s1"],
        default_skills: ["sk1"],
        default_hooks: ["h1"],
        default_plugins: ["p1"],
        default_subagent_roots: ["sub-a", "sub-b"],
      },
      roots
    );
    expect(result.mcpServerIds.sort()).toEqual(["s1", "s2", "s3", "s4"]);
    expect(result.skillIds.sort()).toEqual(["sk1", "sk2", "sk3"]);
    expect(result.hookIds.sort()).toEqual(["h1", "h2", "h3"]);
    expect(result.pluginIds.sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("collects subagent servers when parent has no default_mcp_servers", () => {
    const roots = {
      "sub-a": {
        description: "Sub A",
        default_mcp_servers: ["s1", "s2"],
      },
    };
    const result = getMergedDefaults(
      {
        description: "Parent",
        default_subagent_roots: ["sub-a"],
      },
      roots
    );
    expect(result.mcpServerIds.sort()).toEqual(["s1", "s2"]);
  });

  it("collects subagent hooks when parent has no default_hooks", () => {
    const roots = {
      "sub-a": {
        description: "Sub A",
        default_hooks: ["h1", "h2"],
      },
    };
    const result = getMergedDefaults(
      {
        description: "Parent",
        default_subagent_roots: ["sub-a"],
      },
      roots
    );
    expect(result.hookIds.sort()).toEqual(["h1", "h2"]);
  });

  it("collects subagent plugins when parent has no default_plugins", () => {
    const roots = {
      "sub-a": {
        description: "Sub A",
        default_plugins: ["p1", "p2"],
      },
    };
    const result = getMergedDefaults(
      {
        description: "Parent",
        default_subagent_roots: ["sub-a"],
      },
      roots
    );
    expect(result.pluginIds.sort()).toEqual(["p1", "p2"]);
  });

  it("skips missing subagent root IDs", () => {
    const result = getMergedDefaults(
      {
        description: "Parent",
        default_mcp_servers: ["s1"],
        default_subagent_roots: ["nonexistent"],
      },
      {}
    );
    expect(result.mcpServerIds).toEqual(["s1"]);
  });

  it("returns empty arrays for undefined root", () => {
    const result = getMergedDefaults(undefined, {});
    expect(result.mcpServerIds).toEqual([]);
    expect(result.skillIds).toEqual([]);
    expect(result.hookIds).toEqual([]);
    expect(result.pluginIds).toEqual([]);
  });
});

describe("buildInitialState with local skills", () => {
  it("marks catalog skills that collide with a local skill as readOnly+selected", () => {
    const state = buildInitialState(
      makeArtifacts({
        skills: {
          "shared-skill": {
            description: "Catalog version",
            path: "/skills/shared",
          },
          "catalog-only": {
            description: "Catalog only",
            path: "/skills/catalog-only",
          },
        },
      }),
      undefined,
      undefined,
      false,
      false,
      {
        skills: [
          {
            id: "shared-skill",
            description: "Local version",
            path: "/repo/.claude/skills/shared-skill",
          },
        ],
      }
    );

    const shared = state.items.skills.find((i) => i.id === "shared-skill");
    expect(shared?.readOnly).toBe(true);
    expect(shared?.selected).toBe(true);

    const catalogOnly = state.items.skills.find((i) => i.id === "catalog-only");
    expect(catalogOnly?.readOnly).toBeFalsy();
  });

  it("appends local-only skills as readOnly+selected entries", () => {
    const state = buildInitialState(
      makeArtifacts({
        skills: {
          catalog: { description: "Catalog skill", path: "/skills/catalog" },
        },
      }),
      undefined,
      undefined,
      false,
      false,
      {
        skills: [
          {
            id: "local-only",
            description: "A local skill",
            path: "/repo/.claude/skills/local-only",
          },
        ],
      }
    );

    const ids = state.items.skills.map((i) => i.id);
    expect(ids).toEqual(["catalog", "local-only"]);

    const local = state.items.skills.find((i) => i.id === "local-only");
    expect(local?.readOnly).toBe(true);
    expect(local?.selected).toBe(true);
    expect(local?.description).toBe("A local skill");
  });

  it("excludes readOnly items from getSelectedIds output", () => {
    const state = buildInitialState(
      makeArtifacts({
        skills: {
          "catalog-skill": {
            description: "Catalog skill",
            path: "/skills/catalog-skill",
          },
        },
      }),
      { description: "r", default_skills: ["catalog-skill"] },
      "r",
      false,
      false,
      {
        skills: [
          {
            id: "local-only",
            description: "Local",
            path: "/repo/.claude/skills/local-only",
          },
        ],
      }
    );

    const result = getSelectedIds(state);
    expect(result.skills).toEqual(["catalog-skill"]);
    expect(result.skills).not.toContain("local-only");
  });

  it("falls back to title when local skill description is empty", () => {
    const state = buildInitialState(
      makeArtifacts(),
      undefined,
      undefined,
      false,
      false,
      {
        skills: [
          {
            id: "local",
            description: "",
            title: "My Title",
            path: "/repo/.claude/skills/local",
          },
        ],
      }
    );

    expect(state.items.skills[0].description).toBe("My Title");
  });
});

describe("buildInitialState with subagent merge", () => {
  it("pre-selects subagent MCP servers when merge is enabled", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          "parent-server": { type: "stdio", command: "node", description: "Parent" },
          "sub-server": { type: "stdio", command: "node", description: "Subagent" },
        },
        roots: {
          "sub-root": {
            description: "Subagent root",
            default_mcp_servers: ["sub-server"],
          },
        },
      }),
      {
        description: "Parent root",
        default_mcp_servers: ["parent-server"],
        default_subagent_roots: ["sub-root"],
      },
      "parent",
      false,
      false // skipSubagentMerge = false
    );
    expect(state.items.mcp.find((i) => i.id === "parent-server")?.selected).toBe(true);
    expect(state.items.mcp.find((i) => i.id === "sub-server")?.selected).toBe(true);
  });

  it("does not pre-select subagent servers when merge is disabled", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          "parent-server": { type: "stdio", command: "node", description: "Parent" },
          "sub-server": { type: "stdio", command: "node", description: "Subagent" },
        },
        roots: {
          "sub-root": {
            description: "Subagent root",
            default_mcp_servers: ["sub-server"],
          },
        },
      }),
      {
        description: "Parent root",
        default_mcp_servers: ["parent-server"],
        default_subagent_roots: ["sub-root"],
      },
      "parent",
      false,
      true // skipSubagentMerge = true
    );
    expect(state.items.mcp.find((i) => i.id === "parent-server")?.selected).toBe(true);
    expect(state.items.mcp.find((i) => i.id === "sub-server")?.selected).toBe(false);
  });

  it("pre-selects subagent skills when parent has no default_skills", () => {
    const state = buildInitialState(
      makeArtifacts({
        skills: {
          "sub-skill": { description: "Subagent skill", path: "/skills/sub-skill" },
          "other-skill": { description: "Other skill", path: "/skills/other" },
        },
        roots: {
          "sub-root": {
            description: "Subagent root",
            default_skills: ["sub-skill"],
          },
        },
      }),
      {
        description: "Parent root",
        default_subagent_roots: ["sub-root"],
      },
      "parent",
      false,
      false
    );
    expect(state.items.skills.find((i) => i.id === "sub-skill")?.selected).toBe(true);
    expect(state.items.skills.find((i) => i.id === "other-skill")?.selected).toBe(false);
  });

  it("pre-selects subagent hooks when merge is enabled", () => {
    const state = buildInitialState(
      makeArtifacts({
        hooks: {
          "parent-hook": { description: "Parent hook", path: "/hooks/parent" },
          "sub-hook": { description: "Subagent hook", path: "/hooks/sub" },
        },
        roots: {
          "sub-root": {
            description: "Subagent root",
            default_hooks: ["sub-hook"],
          },
        },
      }),
      {
        description: "Parent root",
        default_hooks: ["parent-hook"],
        default_subagent_roots: ["sub-root"],
      },
      "parent",
      false,
      false
    );
    expect(state.items.hooks.find((i) => i.id === "parent-hook")?.selected).toBe(true);
    expect(state.items.hooks.find((i) => i.id === "sub-hook")?.selected).toBe(true);
  });

  it("does not pre-select subagent hooks when merge is disabled", () => {
    const state = buildInitialState(
      makeArtifacts({
        hooks: {
          "parent-hook": { description: "Parent hook", path: "/hooks/parent" },
          "sub-hook": { description: "Subagent hook", path: "/hooks/sub" },
        },
        roots: {
          "sub-root": {
            description: "Subagent root",
            default_hooks: ["sub-hook"],
          },
        },
      }),
      {
        description: "Parent root",
        default_hooks: ["parent-hook"],
        default_subagent_roots: ["sub-root"],
      },
      "parent",
      false,
      true
    );
    expect(state.items.hooks.find((i) => i.id === "parent-hook")?.selected).toBe(true);
    expect(state.items.hooks.find((i) => i.id === "sub-hook")?.selected).toBe(false);
  });

  it("pre-selects subagent plugins when merge is enabled", () => {
    const state = buildInitialState(
      makeArtifacts({
        plugins: {
          "parent-plugin": { description: "Parent plugin", path: "/plugins/parent" },
          "sub-plugin": { description: "Subagent plugin", path: "/plugins/sub" },
        },
        roots: {
          "sub-root": {
            description: "Subagent root",
            default_plugins: ["sub-plugin"],
          },
        },
      }),
      {
        description: "Parent root",
        default_plugins: ["parent-plugin"],
        default_subagent_roots: ["sub-root"],
      },
      "parent",
      false,
      false
    );
    expect(state.items.plugins.find((i) => i.id === "parent-plugin")?.selected).toBe(true);
    expect(state.items.plugins.find((i) => i.id === "sub-plugin")?.selected).toBe(true);
  });

  it("does not pre-select subagent plugins when merge is disabled", () => {
    const state = buildInitialState(
      makeArtifacts({
        plugins: {
          "parent-plugin": { description: "Parent plugin", path: "/plugins/parent" },
          "sub-plugin": { description: "Subagent plugin", path: "/plugins/sub" },
        },
        roots: {
          "sub-root": {
            description: "Subagent root",
            default_plugins: ["sub-plugin"],
          },
        },
      }),
      {
        description: "Parent root",
        default_plugins: ["parent-plugin"],
        default_subagent_roots: ["sub-root"],
      },
      "parent",
      false,
      true
    );
    expect(state.items.plugins.find((i) => i.id === "parent-plugin")?.selected).toBe(true);
    expect(state.items.plugins.find((i) => i.id === "sub-plugin")?.selected).toBe(false);
  });
});
