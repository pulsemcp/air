import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ResolvedArtifacts } from "@pulsemcp/air-sdk";
import { buildInitialState } from "../src/tui/types.js";
import { render, getNoticeLines, getViewportHeight } from "../src/tui/render.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

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

function findLegendLine(lines: string[]): string {
  // The legend line contains key hints like "navigate", "quit", etc.
  const line = lines.find(
    (l) => stripAnsi(l).includes("navigate") && stripAnsi(l).includes("quit")
  );
  return line ? stripAnsi(line) : "";
}

function findSearchLegendLine(lines: string[]): string {
  // In search mode the legend contains "Esc" and "navigate"
  const line = lines.find(
    (l) => stripAnsi(l).includes("navigate") && stripAnsi(l).includes("Esc")
  );
  return line ? stripAnsi(line) : "";
}

describe("render legend", () => {
  let origColumns: number | undefined;
  let origRows: number | undefined;

  beforeEach(() => {
    origColumns = process.stdout.columns;
    origRows = process.stdout.rows;
    // Set a reasonable terminal size for tests
    Object.defineProperty(process.stdout, "columns", {
      value: 120,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "rows", {
      value: 40,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "columns", {
      value: origColumns,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "rows", {
      value: origRows,
      writable: true,
      configurable: true,
    });
  });

  it('shows "types" instead of "tabs" in the legend', () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          server1: {
            type: "stdio",
            command: "node",
            description: "A server",
          },
        },
      })
    );
    const lines = render(state, 10);
    const legend = findLegendLine(lines);
    expect(legend).toContain("types");
    expect(legend).not.toContain("tabs");
  });

  it("shows Esc and Space toggle in search mode on overridable tab", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          server1: {
            type: "stdio",
            command: "node",
            description: "A server",
          },
        },
      })
    );
    state.searchActive = true;
    state.searchQuery = "";
    const lines = render(state, 10);
    const legend = findSearchLegendLine(lines);
    expect(legend).toContain("Esc");
    expect(legend).toContain("cancel");
    expect(legend).toContain("confirm");
    expect(legend).toContain("toggle");
  });

  it("does not show types/search/quit hints in search mode", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          server1: {
            type: "stdio",
            command: "node",
            description: "A server",
          },
        },
      })
    );
    state.searchActive = true;
    state.searchQuery = "test";
    const lines = render(state, 10);
    const legend = findSearchLegendLine(lines);
    expect(legend).toContain("Esc");
    // Normal-mode-only hints should be absent
    expect(legend).not.toContain("types");
    expect(legend).not.toContain("quit");
  });

  it("shows normal legend when search is not active", () => {
    const state = buildInitialState(
      makeArtifacts({
        mcp: {
          server1: {
            type: "stdio",
            command: "node",
            description: "A server",
          },
        },
      })
    );
    const lines = render(state, 10);
    const legend = findLegendLine(lines);
    expect(legend).toContain("types");
    expect(legend).toContain("search");
    expect(legend).toContain("quit");
    expect(legend).not.toContain("Esc");
  });

  it("shows toggle/all/none/only on hooks tab (now overridable)", () => {
    const state = buildInitialState(
      makeArtifacts({
        hooks: {
          "my-hook": { description: "A hook" },
        },
      })
    );
    const lines = render(state, 10);
    const legend = findLegendLine(lines);
    expect(legend).toContain("types");
    expect(legend).toContain("navigate");
    expect(legend).toContain("toggle");
    expect(legend).toContain("all");
    expect(legend).toContain("none");
    expect(legend).toContain("only");
  });

  it("renders a read-only hint and lock marker for local skills", () => {
    const state = buildInitialState(
      makeArtifacts({
        skills: {
          "catalog-skill": {
            description: "Catalog skill",
            path: "/skills/catalog-skill",
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
            id: "local-skill",
            description: "Local skill",
            path: "/repo/.claude/skills/local-skill",
          },
        ],
      }
    );
    // Skills tab is present, make it active
    state.activeTab = state.tabs.indexOf("skills");

    const lines = render(state, 10).map(stripAnsi);
    const hint = lines.find((l) =>
      l.includes("local skills are tracked in this repo")
    );
    expect(hint).toBeDefined();

    const localLine = lines.find((l) => l.includes("local-skill"));
    expect(localLine).toBeDefined();
    expect(localLine).toContain("\u{1f512}");
  });

  it("shows Space toggle in search mode on hooks tab (now overridable)", () => {
    const state = buildInitialState(
      makeArtifacts({
        hooks: {
          "my-hook": { description: "A hook" },
        },
      })
    );
    state.searchActive = true;
    state.searchQuery = "";
    const lines = render(state, 10);
    const legend = findSearchLegendLine(lines);
    expect(legend).toContain("Esc");
    expect(legend).toContain("confirm");
    expect(legend).toContain("toggle");
  });

  describe("root default marker", () => {
    const artifacts = makeArtifacts({
      mcp: {
        "default-server": { type: "stdio", command: "node", description: "d" },
        "picked-server": { type: "stdio", command: "node", description: "p" },
      },
      skills: {
        "default-skill": { description: "d", path: "/skills/default-skill" },
        "picked-skill": { description: "p", path: "/skills/picked-skill" },
      },
      hooks: {
        "default-hook": { description: "d", path: "/hooks/default-hook" },
        "picked-hook": { description: "p", path: "/hooks/picked-hook" },
      },
      plugins: {
        "default-plugin": { description: "d" },
        "picked-plugin": { description: "p" },
      },
    });
    const root = {
      description: "r",
      default_mcp_servers: ["default-server"],
      default_skills: ["default-skill"],
      default_hooks: ["default-hook"],
      default_plugins: ["default-plugin"],
    };
    const installed = {
      mcpServers: ["picked-server"],
      skills: ["picked-skill"],
      hooks: ["picked-hook"],
      plugins: ["picked-plugin"],
    };
    const legend =
      "  \u2605 root default \u2014 recommended by the root, whether or not it is selected";

    it("marks default rows and explains the marker on every tab, whatever is selected", () => {
      const state = buildInitialState(artifacts, root, "r", false, false, undefined, installed);
      for (const [tab, name] of [
        ["mcp", "server"],
        ["skills", "skill"],
        ["hooks", "hook"],
        ["plugins", "plugin"],
      ] as const) {
        state.activeTab = state.tabs.indexOf(tab);
        const lines = render(state, 10).map(stripAnsi);
        expect(lines).toContain(legend);
        expect(lines).toContain(`> \u25cb default-${name} \u2605 \u2014 d`);
        expect(lines).toContain(`  \u25cf picked-${name} \u2014 p`);
      }
    });

    it("marks a selected default too", () => {
      const state = buildInitialState(artifacts, root, "r");
      state.activeTab = state.tabs.indexOf("skills");
      const lines = render(state, 10).map(stripAnsi);
      expect(lines).toContain("> \u25cf default-skill \u2605 \u2014 d");
      expect(lines).toContain("  \u25cb picked-skill \u2014 p");
    });

    it("shows no marker or legend when the root has no defaults", () => {
      const state = buildInitialState(artifacts, undefined, undefined, false, false, undefined, installed);
      const lines = render(state, 10).map(stripAnsi);
      expect(lines.some((l) => l.includes("\u2605"))).toBe(false);
    });

    it("keeps the lock hint alongside the default legend, and reserves viewport rows for both", () => {
      const state = buildInitialState(
        artifacts,
        root,
        "r",
        false,
        false,
        {
          skills: [
            { id: "local-skill", description: "Local", path: "/repo/.claude/skills/local-skill" },
          ],
        },
        installed
      );
      state.activeTab = state.tabs.indexOf("skills");
      const notices = getNoticeLines(state).map(stripAnsi);
      expect(notices).toEqual([
        expect.stringContaining("local skills are tracked in this repo"),
        legend,
      ]);
      expect(render(state, 10).map(stripAnsi).slice(5, 7)).toEqual(notices);
      // rows 40 - header 5 - notices 2 - footer (6 + 4 tabs)
      expect(getViewportHeight(state.tabs.length, notices.length)).toBe(23);
      expect(getViewportHeight(state.tabs.length)).toBe(25);
      // The whole frame fits the terminal, with the key legend on screen.
      const frame = render(state, getViewportHeight(state.tabs.length, notices.length));
      expect(frame).toHaveLength(40);
      expect(stripAnsi(frame[38])).toContain("quit");
    });

    it("keeps the legend while a search filters every default out", () => {
      const state = buildInitialState(artifacts, root, "r", false, false, undefined, installed);
      state.activeTab = state.tabs.indexOf("skills");
      state.searchActive = true;
      state.searchQuery = "picked";
      expect(getNoticeLines(state).map(stripAnsi)).toEqual([legend]);
    });
  });
});
