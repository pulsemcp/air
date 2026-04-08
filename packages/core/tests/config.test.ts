import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import {
  loadAirConfig,
  resolveArtifacts,
  mergeArtifacts,
  emptyArtifacts,
} from "../src/config.js";
import {
  createTempAirDir,
  exampleSkill,
  exampleMcpStdio,
  exampleRoot,
  exampleReference,
  examplePlugin,
  exampleHook,
} from "./helpers.js";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("loadAirConfig", () => {
  it("loads a minimal air.json", () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": { name: "test" },
    });
    cleanup = c;
    const config = loadAirConfig(join(dir, "air.json"));
    expect(config.name).toBe("test");
  });

  it("loads air.json with all artifact arrays", () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "full",
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
        references: ["./refs.json"],
        plugins: ["./plugins.json"],
        hooks: ["./hooks.json"],
      },
    });
    cleanup = c;
    const config = loadAirConfig(join(dir, "air.json"));
    expect(config.skills).toEqual(["./skills.json"]);
    expect(config.mcp).toEqual(["./mcp.json"]);
  });
});

describe("resolveArtifacts", () => {
  it("resolves all artifact types from a single set of files", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
        references: ["./refs.json"],
        plugins: ["./plugins.json"],
        hooks: ["./hooks.json"],
      },
      "skills.json": { "my-skill": exampleSkill("my-skill") },
      "mcp.json": { "my-server": exampleMcpStdio() },
      "roots.json": { "my-root": exampleRoot("my-root") },
      "refs.json": { "my-ref": exampleReference("my-ref") },
      "plugins.json": { "my-plugin": examplePlugin("my-plugin") },
      "hooks.json": { "my-hook": exampleHook("my-hook") },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.skills["my-skill"].id).toBe("my-skill");
    expect(artifacts.mcp["my-server"].type).toBe("stdio");
    expect(artifacts.roots["my-root"].name).toBe("my-root");
    expect(artifacts.references["my-ref"].id).toBe("my-ref");
    expect(artifacts.plugins["my-plugin"].id).toBe("my-plugin");
    expect(artifacts.hooks["my-hook"].id).toBe("my-hook");
  });

  it("merges multiple files for the same artifact type", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./org-skills.json", "./team-skills.json"],
      },
      "org-skills.json": {
        "deploy": exampleSkill("deploy", { description: "Org deploy" }),
        "review": exampleSkill("review", { description: "Org review" }),
      },
      "team-skills.json": {
        "deploy": exampleSkill("deploy", { description: "Team deploy" }),
        "lint": exampleSkill("lint", { description: "Team lint" }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    // Team overrides org for matching ID
    expect(artifacts.skills["deploy"].description).toBe("Team deploy");
    // Org skill preserved
    expect(artifacts.skills["review"].description).toBe("Org review");
    // Team-only skill added
    expect(artifacts.skills["lint"].description).toBe("Team lint");
  });

  it("handles three-layer composition (org > team > project)", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        mcp: ["./org.json", "./team.json", "./project.json"],
      },
      "org.json": {
        github: exampleMcpStdio({ title: "Org GitHub" }),
        slack: exampleMcpStdio({ title: "Org Slack" }),
      },
      "team.json": {
        github: exampleMcpStdio({ title: "Team GitHub" }),
        jira: exampleMcpStdio({ title: "Team Jira" }),
      },
      "project.json": {
        github: exampleMcpStdio({ title: "Project GitHub" }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    // Last writer wins
    expect(artifacts.mcp["github"].title).toBe("Project GitHub");
    // Org preserved
    expect(artifacts.mcp["slack"].title).toBe("Org Slack");
    // Team preserved
    expect(artifacts.mcp["jira"].title).toBe("Team Jira");
  });

  it("strips $schema from merged entries", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": { name: "test", skills: ["./skills.json"] },
      "skills.json": {
        $schema: "https://example.com/skills.schema.json",
        "my-skill": exampleSkill("my-skill"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["$schema"]).toBeUndefined();
    expect(artifacts.skills["my-skill"]).toBeDefined();
  });

  it("handles missing files gracefully", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./nonexistent.json"],
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(Object.keys(artifacts.skills)).toHaveLength(0);
  });

  it("returns empty artifacts when no paths are configured", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": { name: "test" },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts).toEqual(emptyArtifacts());
  });
});

describe("resolveArtifacts with CatalogProvider", () => {
  it("delegates URI paths to the matching provider", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["mock://org/skills.json", "./local-skills.json"],
      },
      "local-skills.json": {
        "local-skill": exampleSkill("local-skill"),
      },
    });
    cleanup = c;

    const mockProvider = {
      scheme: "mock",
      resolve: async (_uri: string, _baseDir: string) => ({
        "remote-skill": exampleSkill("remote-skill", {
          description: "From mock provider",
        }),
      }),
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [mockProvider],
    });

    expect(artifacts.skills["remote-skill"].description).toBe(
      "From mock provider"
    );
    expect(artifacts.skills["local-skill"]).toBeDefined();
  });

  it("throws when URI scheme has no matching provider", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["s3://bucket/skills.json"],
      },
    });
    cleanup = c;

    await expect(
      resolveArtifacts(join(dir, "air.json"))
    ).rejects.toThrow('No catalog provider registered for scheme "s3://"');
  });

  it("allows provider to override local entries", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./local.json", "mock://overrides.json"],
      },
      "local.json": {
        "shared-skill": exampleSkill("shared-skill", {
          description: "Local version",
        }),
      },
    });
    cleanup = c;

    const mockProvider = {
      scheme: "mock",
      resolve: async () => ({
        "shared-skill": exampleSkill("shared-skill", {
          description: "Remote override",
        }),
      }),
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [mockProvider],
    });

    // Remote comes after local in array, so it overrides
    expect(artifacts.skills["shared-skill"].description).toBe(
      "Remote override"
    );
  });
});

describe("mergeArtifacts", () => {
  it("merges two empty artifact sets", () => {
    const result = mergeArtifacts(emptyArtifacts(), emptyArtifacts());
    expect(result).toEqual(emptyArtifacts());
  });

  it("adds new IDs from override", () => {
    const base = emptyArtifacts();
    base.skills["a"] = exampleSkill("a") as any;

    const override = emptyArtifacts();
    override.skills["b"] = exampleSkill("b") as any;

    const result = mergeArtifacts(base, override);
    expect(Object.keys(result.skills)).toEqual(["a", "b"]);
  });

  it("overrides matching IDs", () => {
    const base = emptyArtifacts();
    base.skills["a"] = exampleSkill("a", { description: "Base" }) as any;

    const override = emptyArtifacts();
    override.skills["a"] = exampleSkill("a", {
      description: "Override",
    }) as any;

    const result = mergeArtifacts(base, override);
    expect(result.skills["a"].description).toBe("Override");
  });
});

describe("absolute path resolution", () => {
  it("resolves skill path fields to absolute paths", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
      },
      "skills.json": {
        "my-skill": exampleSkill("my-skill"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    // skill.path should be resolved to an absolute path
    expect(artifacts.skills["my-skill"].path).toBe(join(dir, "skills/my-skill"));
    expect(artifacts.skills["my-skill"].path.startsWith("/")).toBe(true);
  });

  it("resolves hook path fields to absolute paths", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        hooks: ["./hooks.json"],
      },
      "hooks.json": {
        "my-hook": exampleHook("my-hook"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    // hook.path should be resolved to an absolute path
    expect(artifacts.hooks["my-hook"].path).toBe(join(dir, "hooks/my-hook"));
    expect(artifacts.hooks["my-hook"].path.startsWith("/")).toBe(true);
  });

  it("resolves reference file fields to absolute paths", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        references: ["./refs.json"],
      },
      "refs.json": {
        "my-ref": exampleReference("my-ref"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    // ref.file should be resolved to an absolute path
    expect(artifacts.references["my-ref"].file).toBe(
      join(dir, "references/my-ref.md")
    );
    expect(artifacts.references["my-ref"].file.startsWith("/")).toBe(true);
  });

  it("preserves already-absolute paths", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
      },
      "skills.json": {
        "abs-skill": exampleSkill("abs-skill", {
          path: "/absolute/path/to/skill",
        }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.skills["abs-skill"].path).toBe("/absolute/path/to/skill");
  });

  it("resolves paths relative to the index file directory, not air.json", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./subdir/skills.json"],
      },
      "subdir/skills.json": {
        "nested-skill": exampleSkill("nested-skill", {
          path: "../skills/nested",
        }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    // Path is relative to subdir/ (where the index file is), not to dir/
    expect(artifacts.skills["nested-skill"].path).toBe(
      join(dir, "skills/nested")
    );
  });

  it("uses provider resolveSourceDir for remote URIs", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["mock://org/skills.json"],
      },
    });
    cleanup = c;

    const mockProvider = {
      scheme: "mock",
      resolve: async () => ({
        "remote-skill": {
          id: "remote-skill",
          description: "Remote skill",
          path: "skills/remote",
        },
      }),
      resolveSourceDir: () => "/mock/clone/dir",
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [mockProvider],
    });

    // Path resolved relative to the provider's sourceDir
    expect(artifacts.skills["remote-skill"].path).toBe(
      "/mock/clone/dir/skills/remote"
    );
  });

  it("falls back to baseDir when provider has no resolveSourceDir", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["mock://org/skills.json"],
      },
    });
    cleanup = c;

    const mockProvider = {
      scheme: "mock",
      resolve: async () => ({
        "remote-skill": {
          id: "remote-skill",
          description: "Remote skill",
          path: "skills/remote",
        },
      }),
      // No resolveSourceDir
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [mockProvider],
    });

    // Path resolved relative to air.json's directory (the baseDir fallback)
    expect(artifacts.skills["remote-skill"].path).toBe(
      join(dir, "skills/remote")
    );
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
