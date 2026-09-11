import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { resolve, join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import {
  buildManifest,
  writeManifest,
  type ResolvedArtifacts,
} from "@pulsemcp/air-core";
import {
  getInstalledArtifacts,
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

describe("getInstalledArtifacts", () => {
  it("returns null when AIR has installed nothing in the target", () => {
    const target = createTemp({});
    expect(
      getInstalledArtifacts({
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

    const installed = getInstalledArtifacts({
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
      getInstalledArtifacts({
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
      getInstalledArtifacts({
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
      getInstalledArtifacts({
        target,
        adapter: "claude",
        artifacts: makeArtifacts({ skills: { "@local/a": skill("a") } }),
      })?.skills
    ).toEqual(["@local/a"]);
  });

  it("uses `prefer` to settle a shortname several scopes provide, and skips it otherwise", () => {
    const target = createTemp({});
    writeManifest(
      buildManifest(target, { adapter: "claude", skills: ["shared"] })
    );
    const artifacts = makeArtifacts({
      skills: {
        "@local/shared": skill("shared"),
        "@acme/cat/shared": skill("shared"),
      },
    });

    expect(
      getInstalledArtifacts({
        target,
        adapter: "claude",
        artifacts,
        prefer: { skills: ["@acme/cat/shared"] },
      })?.skills
    ).toEqual(["@acme/cat/shared"]);
    expect(
      getInstalledArtifacts({ target, adapter: "claude", artifacts })?.skills
    ).toEqual([]);
  });

  it("infers a plugin as installed only when all of its primitives are", () => {
    const target = createTemp({});
    writeManifest(
      buildManifest(target, {
        adapter: "claude",
        skills: ["a", "b"],
        mcpServers: ["github"],
      })
    );

    const installed = getInstalledArtifacts({
      target,
      adapter: "claude",
      artifacts: makeArtifacts({
        skills: {
          "@local/a": skill("a"),
          "@local/b": skill("b"),
          "@local/c": skill("c"),
        },
        mcp: { "@local/github": server },
        plugins: {
          "@local/full": {
            description: "all installed",
            skills: ["@local/a", "@local/b"],
            mcp_servers: ["@local/github"],
          },
          "@local/partial": {
            description: "c is missing",
            skills: ["@local/a", "@local/c"],
          },
          "@local/empty": { description: "declares nothing" },
        },
      }),
    });

    expect(installed?.plugins).toEqual(["@local/full"]);
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
    expect(
      getInstalledArtifacts({ target, adapter: "claude", artifacts: first.artifacts })
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
      getInstalledArtifacts({ target, adapter: "claude", artifacts: second.artifacts })
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
});
