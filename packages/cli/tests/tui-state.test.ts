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
  it("returns only selected MCP servers and skills", () => {
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
      }),
      {
        description: "Root",
        default_mcp_servers: ["server1"],
        default_skills: ["skill2"],
      }
    );
    const result = getSelectedIds(state);
    expect(result.mcpServers).toEqual(["server1"]);
    expect(result.skills).toEqual(["skill2"]);
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
      { description: "Root", default_mcp_servers: ["s1"], default_skills: ["sk1"] },
      {}
    );
    expect(result.mcpServerIds).toEqual(["s1"]);
    expect(result.skillIds).toEqual(["sk1"]);
  });

  it("returns empty arrays when root has no defaults and no subagents", () => {
    const result = getMergedDefaults({ description: "Root" }, {});
    expect(result.mcpServerIds).toEqual([]);
    expect(result.skillIds).toEqual([]);
  });

  it("unions parent and subagent MCP servers and skills", () => {
    const roots = {
      "sub-a": {
        description: "Sub A",
        default_mcp_servers: ["s2", "s3"],
        default_skills: ["sk2"],
      },
      "sub-b": {
        description: "Sub B",
        default_mcp_servers: ["s3", "s4"],
        default_skills: ["sk3"],
      },
    };
    const result = getMergedDefaults(
      {
        description: "Parent",
        default_mcp_servers: ["s1"],
        default_skills: ["sk1"],
        default_subagent_roots: ["sub-a", "sub-b"],
      },
      roots
    );
    expect(result.mcpServerIds.sort()).toEqual(["s1", "s2", "s3", "s4"]);
    expect(result.skillIds.sort()).toEqual(["sk1", "sk2", "sk3"]);
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
});
