import { describe, it, expect } from "vitest";
import type { ResolvedArtifacts } from "@pulsemcp/air-sdk";
import {
  buildInitialState,
  getSelectedIds,
  getVisibleItems,
  getAllSelectionSummary,
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
