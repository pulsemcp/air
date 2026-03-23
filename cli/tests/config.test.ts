import { describe, it, expect, afterEach } from "vitest";
import {
  loadAirConfig,
  resolveArtifacts,
  mergeArtifacts,
  emptyArtifacts,
  type ResolvedArtifacts,
} from "../src/lib/config.js";
import {
  createTempAirDir,
  minimalAirJson,
  exampleSkill,
  exampleMcpStdio,
  exampleMcpHttp,
  examplePlugin,
  exampleRoot,
  exampleHook,
  exampleReference,
} from "./helpers.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) {
    cleanup();
  }
  cleanups.length = 0;
});

describe("loadAirConfig", () => {
  it("loads a minimal air.json", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson(),
    });
    cleanups.push(cleanup);

    const config = loadAirConfig(`${dir}/air.json`);
    expect(config.name).toBe("test-project");
  });

  it("loads air.json with array artifact paths", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        description: "Test project",
        skills: ["./skills.json"],
        mcp: ["./org-mcp.json", "./mcp.json"],
        references: ["./references.json"],
      }),
    });
    cleanups.push(cleanup);

    const config = loadAirConfig(`${dir}/air.json`);
    expect(config.name).toBe("test-project");
    expect(config.description).toBe("Test project");
    expect(config.skills).toEqual(["./skills.json"]);
    expect(config.mcp).toEqual(["./org-mcp.json", "./mcp.json"]);
    expect(config.references).toEqual(["./references.json"]);
  });
});

describe("resolveArtifacts", () => {
  it("loads skills from a single file", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({ skills: ["./skills.json"] }),
      "skills.json": {
        "my-skill": exampleSkill("my-skill"),
      },
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);
    expect(Object.keys(artifacts.skills)).toHaveLength(1);
    expect(artifacts.skills["my-skill"].id).toBe("my-skill");
  });

  it("loads MCP servers from a single file", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({ mcp: ["./mcp.json"] }),
      "mcp.json": {
        local: exampleMcpStdio(),
        remote: exampleMcpHttp(),
      },
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);
    expect(Object.keys(artifacts.mcp)).toHaveLength(2);
    expect(artifacts.mcp["local"].type).toBe("stdio");
    expect(artifacts.mcp["remote"].type).toBe("streamable-http");
  });

  it("loads all artifact types", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        skills: ["./skills.json"],
        references: ["./references.json"],
        mcp: ["./mcp.json"],
        plugins: ["./plugins.json"],
        roots: ["./roots.json"],
        hooks: ["./hooks.json"],
      }),
      "skills.json": { s1: exampleSkill("s1") },
      "references.json": { r1: exampleReference("r1") },
      "mcp.json": { m1: exampleMcpStdio() },
      "plugins.json": { p1: examplePlugin("p1") },
      "roots.json": { root1: exampleRoot("root1") },
      "hooks.json": { h1: exampleHook("h1") },
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);
    expect(Object.keys(artifacts.skills)).toHaveLength(1);
    expect(Object.keys(artifacts.references)).toHaveLength(1);
    expect(Object.keys(artifacts.mcp)).toHaveLength(1);
    expect(Object.keys(artifacts.plugins)).toHaveLength(1);
    expect(Object.keys(artifacts.roots)).toHaveLength(1);
    expect(Object.keys(artifacts.hooks)).toHaveLength(1);
  });

  it("merges multiple files in array order (later wins)", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        mcp: ["./org-mcp.json", "./team-mcp.json"],
      }),
      "org-mcp.json": {
        github: exampleMcpStdio({ title: "GitHub (Org)" }),
        sentry: exampleMcpStdio({ title: "Sentry (Org)" }),
      },
      "team-mcp.json": {
        github: exampleMcpStdio({ title: "GitHub (Team)" }),
        postgres: exampleMcpStdio({ title: "Postgres (Team)" }),
      },
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);
    // Team overrides org for github
    expect(artifacts.mcp["github"].title).toBe("GitHub (Team)");
    // Org's sentry persists
    expect(artifacts.mcp["sentry"].title).toBe("Sentry (Org)");
    // Team adds postgres
    expect(artifacts.mcp["postgres"].title).toBe("Postgres (Team)");
  });

  it("three-layer composition via array", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        mcp: ["./org.json", "./team.json", "./local.json"],
      }),
      "org.json": {
        github: exampleMcpStdio({ title: "GitHub (Org)" }),
        sentry: exampleMcpStdio({ title: "Sentry" }),
      },
      "team.json": {
        github: exampleMcpStdio({ title: "GitHub (Team)" }),
        postgres: exampleMcpStdio({ title: "Postgres" }),
      },
      "local.json": {
        github: exampleMcpStdio({ title: "GitHub (Local)" }),
        redis: exampleMcpStdio({ title: "Redis" }),
      },
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);
    expect(artifacts.mcp["github"].title).toBe("GitHub (Local)");
    expect(artifacts.mcp["sentry"].title).toBe("Sentry");
    expect(artifacts.mcp["postgres"].title).toBe("Postgres");
    expect(artifacts.mcp["redis"].title).toBe("Redis");
  });

  it("override replaces entirely, not deep merge", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        mcp: ["./base.json", "./override.json"],
      }),
      "base.json": {
        server: exampleMcpStdio({
          title: "Server v1",
          env: { KEY_A: "value_a", KEY_B: "value_b" },
        }),
      },
      "override.json": {
        server: exampleMcpStdio({
          title: "Server v2",
          env: { KEY_A: "new_value" },
        }),
      },
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);
    const server = artifacts.mcp["server"];
    expect(server.title).toBe("Server v2");
    expect(server.env?.KEY_B).toBeUndefined();
    expect(server.env?.KEY_A).toBe("new_value");
  });

  it("strips $schema from loaded artifact files", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({ skills: ["./skills.json"] }),
      "skills.json": {
        $schema: "./schemas/skills.schema.json",
        "my-skill": exampleSkill("my-skill"),
      },
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);
    expect(Object.keys(artifacts.skills)).toHaveLength(1);
    expect(artifacts.skills["$schema"]).toBeUndefined();
  });

  it("handles missing referenced files gracefully", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        skills: ["./nonexistent.json"],
      }),
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);
    expect(Object.keys(artifacts.skills)).toHaveLength(0);
  });

  it("returns empty artifacts when artifact arrays are omitted", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson(),
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);
    expect(artifacts).toEqual(emptyArtifacts());
  });
});

describe("mergeArtifacts", () => {
  it("merges empty artifacts", () => {
    const result = mergeArtifacts(emptyArtifacts(), emptyArtifacts());
    expect(result).toEqual(emptyArtifacts());
  });

  it("adds new IDs from override", () => {
    const base: ResolvedArtifacts = {
      ...emptyArtifacts(),
      skills: { "skill-a": exampleSkill("skill-a") as any },
    };
    const override: ResolvedArtifacts = {
      ...emptyArtifacts(),
      skills: { "skill-b": exampleSkill("skill-b") as any },
    };

    const result = mergeArtifacts(base, override);
    expect(Object.keys(result.skills)).toHaveLength(2);
  });

  it("overrides matching IDs completely", () => {
    const base: ResolvedArtifacts = {
      ...emptyArtifacts(),
      mcp: { github: exampleMcpStdio({ title: "GitHub v1" }) as any },
    };
    const override: ResolvedArtifacts = {
      ...emptyArtifacts(),
      mcp: { github: exampleMcpStdio({ title: "GitHub v2" }) as any },
    };

    const result = mergeArtifacts(base, override);
    expect(result.mcp["github"].title).toBe("GitHub v2");
  });
});

describe("emptyArtifacts", () => {
  it("returns all artifact types as empty objects", () => {
    const empty = emptyArtifacts();
    expect(empty.skills).toEqual({});
    expect(empty.references).toEqual({});
    expect(empty.mcp).toEqual({});
    expect(empty.plugins).toEqual({});
    expect(empty.roots).toEqual({});
    expect(empty.hooks).toEqual({});
  });
});
