import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import {
  loadAirConfig,
  resolveArtifacts,
  mergeArtifacts,
  emptyArtifacts,
  configureProviders,
} from "../src/config.js";
import type { CatalogProvider } from "../src/types.js";
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
  it("resolves all artifact types from a single set of files (qualified @local/<id>)", async () => {
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

    expect(artifacts.skills["@local/my-skill"].description).toBe(
      "Description for my-skill",
    );
    expect(artifacts.mcp["@local/my-server"].type).toBe("stdio");
    expect(artifacts.roots["@local/my-root"].description).toBe(
      "Description for my-root",
    );
    expect(artifacts.references["@local/my-ref"].description).toBe(
      "Description for my-ref",
    );
    expect(artifacts.plugins["@local/my-plugin"].description).toBe(
      "Description for my-plugin",
    );
    expect(artifacts.hooks["@local/my-hook"].description).toBe(
      "Description for my-hook",
    );
  });

  it("unions multiple files for the same artifact type (disjoint shortnames)", async () => {
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
        "lint": exampleSkill("lint", { description: "Team lint" }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.skills["@local/deploy"].description).toBe("Org deploy");
    expect(artifacts.skills["@local/review"].description).toBe("Org review");
    expect(artifacts.skills["@local/lint"].description).toBe("Team lint");
  });

  it("hard-fails when two contributors produce the same qualified ID", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        mcp: ["./org.json", "./team.json"],
      },
      "org.json": {
        github: exampleMcpStdio({ title: "Org GitHub" }),
      },
      "team.json": {
        github: exampleMcpStdio({ title: "Team GitHub" }),
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /Duplicate mcp ID "@local\/github"/,
    );
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
    expect(artifacts.skills["@local/$schema"]).toBeUndefined();
    expect(artifacts.skills["@local/my-skill"]).toBeDefined();
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
  it("delegates URI paths to the matching provider and uses provider scope", async () => {
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

    const mockProvider: CatalogProvider = {
      scheme: "mock",
      resolve: async (_uri: string, _baseDir: string) => ({
        "remote-skill": exampleSkill("remote-skill", {
          description: "From mock provider",
        }),
      }),
      getScope: (_uri: string) => "mock-org",
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [mockProvider],
    });

    expect(artifacts.skills["@mock-org/remote-skill"].description).toBe(
      "From mock provider",
    );
    expect(artifacts.skills["@local/local-skill"]).toBeDefined();
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
      resolveArtifacts(join(dir, "air.json")),
    ).rejects.toThrow('No catalog provider registered for scheme "s3://"');
  });

  it("provider entries do NOT override local entries — both coexist under their own scopes", async () => {
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

    const warnings: string[] = [];
    const mockProvider: CatalogProvider = {
      scheme: "mock",
      resolve: async () => ({
        "shared-skill": exampleSkill("shared-skill", {
          description: "Mock version",
        }),
      }),
      getScope: () => "mock-org",
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [mockProvider],
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts.skills["@local/shared-skill"].description).toBe(
      "Local version",
    );
    expect(artifacts.skills["@mock-org/shared-skill"].description).toBe(
      "Mock version",
    );
    // Cross-scope shortname collision warns
    expect(warnings.some((w) => w.includes("shared-skill"))).toBe(true);
  });
});

describe("mergeArtifacts", () => {
  it("merges two empty artifact sets", () => {
    const result = mergeArtifacts(emptyArtifacts(), emptyArtifacts());
    expect(result).toEqual(emptyArtifacts());
  });

  it("unions disjoint qualified IDs from both sides", () => {
    const base = emptyArtifacts();
    base.skills["@local/a"] = exampleSkill("a") as any;

    const overlay = emptyArtifacts();
    overlay.skills["@local/b"] = exampleSkill("b") as any;

    const result = mergeArtifacts(base, overlay);
    expect(Object.keys(result.skills).sort()).toEqual([
      "@local/a",
      "@local/b",
    ]);
  });

  it("hard-fails when both sides contain the same qualified ID", () => {
    const base = emptyArtifacts();
    base.skills["@local/a"] = exampleSkill("a", { description: "Base" }) as any;

    const overlay = emptyArtifacts();
    overlay.skills["@local/a"] = exampleSkill("a", {
      description: "Overlay",
    }) as any;

    expect(() => mergeArtifacts(base, overlay)).toThrow(
      /duplicate skill ID "@local\/a"/,
    );
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

    expect(artifacts.skills["@local/my-skill"].path).toBe(
      join(dir, "skills/my-skill"),
    );
    expect(artifacts.skills["@local/my-skill"].path.startsWith("/")).toBe(true);
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

    expect(artifacts.hooks["@local/my-hook"].path).toBe(
      join(dir, "hooks/my-hook"),
    );
    expect(artifacts.hooks["@local/my-hook"].path.startsWith("/")).toBe(true);
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

    expect(artifacts.references["@local/my-ref"].path).toBe(
      join(dir, "references/my-ref.md"),
    );
    expect(artifacts.references["@local/my-ref"].path.startsWith("/")).toBe(
      true,
    );
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

    expect(artifacts.skills["@local/abs-skill"].path).toBe(
      "/absolute/path/to/skill",
    );
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

    expect(artifacts.skills["@local/nested-skill"].path).toBe(
      join(dir, "skills/nested"),
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

    const mockProvider: CatalogProvider = {
      scheme: "mock",
      resolve: async () => ({
        "remote-skill": {
          id: "remote-skill",
          description: "Remote skill",
          path: "skills/remote",
        },
      }),
      resolveSourceDir: () => "/mock/clone/dir",
      getScope: () => "mock-org",
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [mockProvider],
    });

    expect(artifacts.skills["@mock-org/remote-skill"].path).toBe(
      "/mock/clone/dir/skills/remote",
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

    const mockProvider: CatalogProvider = {
      scheme: "mock",
      resolve: async () => ({
        "remote-skill": {
          id: "remote-skill",
          description: "Remote skill",
          path: "skills/remote",
        },
      }),
      getScope: () => "mock-org",
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [mockProvider],
    });

    expect(artifacts.skills["@mock-org/remote-skill"].path).toBe(
      join(dir, "skills/remote"),
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

describe("configureProviders precedence", () => {
  function makeFakeProvider(): CatalogProvider & {
    lastConfig: Record<string, unknown> | null;
    configureCallCount: number;
  } {
    const provider = {
      scheme: "fake",
      lastConfig: null as Record<string, unknown> | null,
      configureCallCount: 0,
      resolve: async () => ({}),
      configure(options: Record<string, unknown>) {
        this.lastConfig = options;
        this.configureCallCount += 1;
      },
    };
    return provider;
  }

  const originalEnv = process.env.AIR_GIT_PROTOCOL;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AIR_GIT_PROTOCOL;
    } else {
      process.env.AIR_GIT_PROTOCOL = originalEnv;
    }
  });

  it("forwards air.json gitProtocol when nothing else is set", () => {
    delete process.env.AIR_GIT_PROTOCOL;
    const provider = makeFakeProvider();
    configureProviders([provider], { name: "t", gitProtocol: "https" });
    expect(provider.lastConfig).toEqual({ gitProtocol: "https" });
  });

  it("env var AIR_GIT_PROTOCOL overrides air.json gitProtocol", () => {
    process.env.AIR_GIT_PROTOCOL = "https";
    const provider = makeFakeProvider();
    configureProviders([provider], { name: "t", gitProtocol: "ssh" });
    expect(provider.lastConfig).toEqual({ gitProtocol: "https" });
  });

  it("providerOptions (CLI) overrides env var and air.json", () => {
    process.env.AIR_GIT_PROTOCOL = "https";
    const provider = makeFakeProvider();
    configureProviders(
      [provider],
      { name: "t", gitProtocol: "https" },
      { gitProtocol: "ssh" },
    );
    expect(provider.lastConfig).toEqual({ gitProtocol: "ssh" });
  });

  it("does not call configure() when no tier supplies a value", () => {
    delete process.env.AIR_GIT_PROTOCOL;
    const provider = makeFakeProvider();
    configureProviders([provider], { name: "t" });
    expect(provider.configureCallCount).toBe(0);
  });

  it("env var alone triggers configure() even without air.json field", () => {
    process.env.AIR_GIT_PROTOCOL = "https";
    const provider = makeFakeProvider();
    configureProviders([provider], { name: "t" });
    expect(provider.lastConfig).toEqual({ gitProtocol: "https" });
  });

  it("skips providers that don't implement configure()", () => {
    process.env.AIR_GIT_PROTOCOL = "https";
    const unconfigurable: CatalogProvider = {
      scheme: "fake",
      resolve: async () => ({}),
    };
    configureProviders([unconfigurable], { name: "t" });
    expect(true).toBe(true);
  });
});
