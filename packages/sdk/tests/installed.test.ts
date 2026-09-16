import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { resolve, join } from "path";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import {
  buildManifest,
  writeManifest,
  type ResolvedArtifacts,
} from "@pulsemcp/air-core";
import {
  getInstalledSelection,
  excludeInstalledLocalArtifacts,
} from "../src/installed.js";
import { prepareSession } from "../src/prepare.js";
import { startSession } from "../src/start.js";

const tempDirs: string[] = [];

let airHomeDir: string;
let originalAirHome: string | undefined;

beforeEach(() => {
  airHomeDir = resolve(
    tmpdir(),
    `air-home-installed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  originalAirHome = process.env.AIR_HOME;
  process.env.AIR_HOME = airHomeDir;
});

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
  if (existsSync(airHomeDir)) {
    rmSync(airHomeDir, { recursive: true, force: true });
  }
  if (originalAirHome === undefined) {
    delete process.env.AIR_HOME;
  } else {
    process.env.AIR_HOME = originalAirHome;
  }
});

function createTemp(files: Record<string, unknown>): string {
  const dir = resolve(
    tmpdir(),
    `air-sdk-installed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(
      path,
      typeof content === "string" ? content : JSON.stringify(content, null, 2)
    );
  }
  return dir;
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

const skill = (id: string) => ({ description: id, path: `/skills/${id}` });
const hook = (id: string) => ({ description: id, path: `/hooks/${id}` });
const server = { type: "stdio" as const, command: "node" };

describe("getInstalledSelection", () => {
  it("returns null when AIR has installed nothing in the target", () => {
    const target = createTemp({});
    expect(
      getInstalledSelection({
        target,
        adapter: "claude",
        artifacts: makeArtifacts({ skills: { "@local/a": skill("a") } }),
      })
    ).toBeNull();
  });

  it("maps manifest shortnames to qualified catalog IDs per category", () => {
    const target = createTemp({});
    writeManifest(
      buildManifest(target, {
        adapter: "claude",
        skills: ["a", "gone"],
        hooks: ["lint"],
        mcpServers: ["github"],
      })
    );

    const installed = getInstalledSelection({
      target,
      adapter: "claude",
      artifacts: makeArtifacts({
        skills: { "@local/a": skill("a"), "@local/b": skill("b") },
        hooks: { "@acme/cat/lint": hook("lint") },
        mcp: { "@local/github": server, "@local/slack": server },
      }),
    });

    // "gone" is no longer in the catalog, so it has no TUI row to preselect.
    expect(installed).toEqual({
      skills: ["@local/a"],
      hooks: ["@acme/cat/lint"],
      mcpServers: ["@local/github"],
      plugins: [],
    });
  });

  it("returns empty categories when the last run installed nothing", () => {
    const target = createTemp({});
    writeManifest(buildManifest(target, { adapter: "claude" }));

    expect(
      getInstalledSelection({
        target,
        adapter: "claude",
        artifacts: makeArtifacts({ skills: { "@local/a": skill("a") } }),
      })
    ).toEqual({ skills: [], hooks: [], mcpServers: [], plugins: [] });
  });

  it("ignores a manifest written by a different adapter", () => {
    const target = createTemp({});
    writeManifest(buildManifest(target, { adapter: "codex", skills: ["a"] }));

    expect(
      getInstalledSelection({
        target,
        adapter: "claude",
        artifacts: makeArtifacts({ skills: { "@local/a": skill("a") } }),
      })
    ).toBeNull();
  });

  it("accepts a manifest that predates the adapter field", () => {
    const target = createTemp({});
    writeManifest(buildManifest(target, { skills: ["a"] }));

    expect(
      getInstalledSelection({
        target,
        adapter: "claude",
        artifacts: makeArtifacts({ skills: { "@local/a": skill("a") } }),
      })?.skills
    ).toEqual(["@local/a"]);
  });

  it("returns null instead of throwing when AIR home can't be resolved", () => {
    const target = createTemp({});
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    delete process.env.AIR_HOME;
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    try {
      expect(
        getInstalledSelection({ target, adapter: "claude", artifacts: makeArtifacts() })
      ).toBeNull();
    } finally {
      if (saved.HOME !== undefined) process.env.HOME = saved.HOME;
      if (saved.USERPROFILE !== undefined) process.env.USERPROFILE = saved.USERPROFILE;
    }
  });

  it("settles a shortname several scopes provide with the defaults, else leaves the category to defaults", () => {
    const target = createTemp({});
    writeManifest(
      buildManifest(target, { adapter: "claude", skills: ["shared", "solo"] })
    );
    const artifacts = makeArtifacts({
      skills: {
        "@local/shared": skill("shared"),
        "@acme/cat/shared": skill("shared"),
        "@local/solo": skill("solo"),
      },
    });

    expect(
      getInstalledSelection({
        target,
        adapter: "claude",
        artifacts,
        defaults: { skills: ["@acme/cat/shared"] },
      })?.skills
    ).toEqual(["@acme/cat/shared", "@local/solo"]);
    // Unsettled: guessing wrong would drop the installed copy on Enter, so the
    // category is left undefined and the TUI uses root defaults, as before.
    const unsettled = getInstalledSelection({ target, adapter: "claude", artifacts });
    expect(unsettled?.skills).toBeUndefined();
    expect(unsettled?.hooks).toEqual([]);
  });

  describe("plugins", () => {
    const artifacts = makeArtifacts({
      skills: {
        "@local/a": skill("a"),
        "@local/b": skill("b"),
        "@local/c": skill("c"),
      },
      mcp: { "@local/github": server },
      plugins: {
        "@local/bundle": {
          description: "a + b + github",
          skills: ["@local/a", "@local/b"],
          mcp_servers: ["@local/github"],
        },
        "@local/partial": {
          description: "a + c",
          skills: ["@local/a", "@local/c"],
        },
      },
    });
    const writeInstalled = () => {
      const target = createTemp({});
      writeManifest(
        buildManifest(target, {
          adapter: "claude",
          skills: ["a", "b"],
          mcpServers: ["github"],
        })
      );
      return target;
    };

    it("preselects a default plugin whose primitives are all installed, and not its primitives on their own", () => {
      const target = writeInstalled();
      expect(
        getInstalledSelection({
          target,
          adapter: "claude",
          artifacts,
          defaults: { plugins: ["@local/bundle", "@local/partial"] },
        })
      ).toEqual({
        // bundle provides a, b and github; deselecting it should remove them.
        // partial's c is not installed, so partial is not preselected.
        skills: [],
        mcpServers: [],
        hooks: [],
        plugins: ["@local/bundle"],
      });
    });

    it("keeps a plugin-provided primitive selected on its own when it is itself a default", () => {
      const target = writeInstalled();
      expect(
        getInstalledSelection({
          target,
          adapter: "claude",
          artifacts,
          defaults: { skills: ["@local/a"], plugins: ["@local/bundle"] },
        })?.skills
      ).toEqual(["@local/a"]);
    });

    it("never infers a plugin that isn't a default, even with every primitive installed", () => {
      const target = writeInstalled();
      expect(
        getInstalledSelection({ target, adapter: "claude", artifacts })
      ).toEqual({
        skills: ["@local/a", "@local/b"],
        mcpServers: ["@local/github"],
        hooks: [],
        plugins: [],
      });
    });
  });
});

describe("excludeInstalledLocalArtifacts", () => {
  const local = {
    skills: [
      { id: "air-copied", description: "", path: "/t/.claude/skills/air-copied" },
      { id: "checked-in", description: "", path: "/t/.claude/skills/checked-in" },
    ],
  };

  it("drops skills the manifest records as AIR-installed", () => {
    const target = createTemp({});
    writeManifest(
      buildManifest(target, { adapter: "claude", skills: ["air-copied"] })
    );
    expect(
      excludeInstalledLocalArtifacts(local, target, "claude").skills.map(
        (s) => s.id
      )
    ).toEqual(["checked-in"]);
  });

  it("leaves local skills alone without a manifest for this adapter", () => {
    const target = createTemp({});
    expect(excludeInstalledLocalArtifacts(local, target, "claude")).toEqual(
      local
    );
    writeManifest(
      buildManifest(target, { adapter: "codex", skills: ["air-copied"] })
    );
    expect(excludeInstalledLocalArtifacts(local, target, "claude")).toEqual(
      local
    );
  });
});

describe("installed state after prepareSession (Claude adapter)", () => {
  function setup() {
    const skillMd = (id: string) =>
      `---\nname: ${id}\ndescription: The ${id} skill\n---\n`;
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        alpha: { description: "Alpha", path: "skills/alpha", default_in_roots: ["web"] },
        beta: { description: "Beta", path: "skills/beta", default_in_roots: ["web"] },
        gamma: { description: "Gamma", path: "skills/gamma" },
      },
      "roots.json": { web: { description: "Web app" } },
      "skills/alpha/SKILL.md": skillMd("alpha"),
      "skills/beta/SKILL.md": skillMd("beta"),
      "skills/gamma/SKILL.md": skillMd("gamma"),
    });
    const target = createTemp({
      ".claude/skills/checked-in/SKILL.md": skillMd("checked-in"),
    });
    return { config: join(catalog, "air.json"), target };
  }

  it("reports the non-default selection and keeps AIR's skills out of localArtifacts", async () => {
    const { config, target } = setup();

    const first = await startSession("claude", {
      config,
      root: "web",
      checkAvailability: false,
      localScanDir: target,
    });
    expect(first.adapterName).toBe("claude");
    expect(
      getInstalledSelection({ target, adapter: "claude", artifacts: first.artifacts })
    ).toBeNull();

    await prepareSession({
      config,
      root: "web",
      target,
      adapter: "claude",
      skills: ["alpha", "gamma"],
    });

    const second = await startSession("claude", {
      config,
      root: "web",
      checkAvailability: false,
      localScanDir: target,
    });
    expect(
      getInstalledSelection({ target, adapter: "claude", artifacts: second.artifacts })
    ).toEqual({
      skills: ["@local/alpha", "@local/gamma"],
      mcpServers: [],
      hooks: [],
      plugins: [],
    });
    // alpha and gamma now live in .claude/skills/ too, but AIR put them there.
    expect(second.localArtifacts?.skills.map((s) => s.id)).toEqual([
      "checked-in",
    ]);
  });

  it("keeps a checked-in skill that shares a catalog shortname local, even after a run selects it (#168)", async () => {
    const { config, target } = setup();
    const userBeta = join(target, ".claude", "skills", "beta", "SKILL.md");
    mkdirSync(join(userBeta, ".."), { recursive: true });
    writeFileSync(userBeta, "---\nname: beta\ndescription: Our own beta\n---\n");

    // First run: the root's defaults, alpha + beta, are selected.
    await prepareSession({ config, root: "web", target, adapter: "claude" });

    const next = await startSession("claude", {
      config,
      root: "web",
      checkAvailability: false,
      localScanDir: target,
    });
    const installed = getInstalledSelection({
      target,
      adapter: "claude",
      artifacts: next.artifacts,
    });
    expect(installed?.skills).toEqual(["@local/alpha"]);
    expect(next.localArtifacts?.skills.map((s) => s.id)).toEqual([
      "beta",
      "checked-in",
    ]);

    // Confirming that selection, or deselecting everything, leaves it alone.
    for (const skills of [installed?.skills, []]) {
      await prepareSession({ config, root: "web", target, adapter: "claude", skills });
    }
    expect(readFileSync(userBeta, "utf-8")).toContain("Our own beta");
  });
});
