import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { resolveArtifacts } from "../src/config.js";
import type { CatalogProvider } from "../src/types.js";
import {
  createTempAirDir,
  exampleSkill,
  exampleMcpStdio,
  exampleHook,
  exampleReference,
  examplePlugin,
  exampleRoot,
} from "./helpers.js";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("catalogs", () => {
  it("expands a single local catalog into all artifact types", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./team"],
      },
      "team/skills/skills.json": {
        deploy: exampleSkill("deploy"),
      },
      "team/references/references.json": {
        "git-workflow": exampleReference("git-workflow"),
      },
      "team/mcp/mcp.json": {
        github: exampleMcpStdio({ title: "Team GitHub" }),
      },
      "team/plugins/plugins.json": {
        toolkit: examplePlugin("toolkit"),
      },
      "team/roots/roots.json": {
        "web-app": exampleRoot("web-app"),
      },
      "team/hooks/hooks.json": {
        "pre-commit": exampleHook("pre-commit"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.skills["deploy"]).toBeDefined();
    expect(artifacts.references["git-workflow"]).toBeDefined();
    expect(artifacts.mcp["github"].title).toBe("Team GitHub");
    expect(artifacts.plugins["toolkit"]).toBeDefined();
    expect(artifacts.roots["web-app"]).toBeDefined();
    expect(artifacts.hooks["pre-commit"]).toBeDefined();
  });

  it("tolerates a catalog that omits some artifact types", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./partial"],
      },
      "partial/skills/skills.json": {
        deploy: exampleSkill("deploy"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.skills["deploy"]).toBeDefined();
    expect(artifacts.mcp).toEqual({});
    expect(artifacts.hooks).toEqual({});
  });

  it("layers multiple catalogs: later wins by ID, both contribute new IDs", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./org", "./team"],
      },
      "org/skills/skills.json": {
        deploy: exampleSkill("deploy", { description: "Org deploy" }),
        review: exampleSkill("review"),
      },
      "team/skills/skills.json": {
        deploy: exampleSkill("deploy", { description: "Team deploy" }),
        lint: exampleSkill("lint"),
      },
      "org/mcp/mcp.json": {
        github: exampleMcpStdio({ title: "Org GitHub" }),
      },
      "team/mcp/mcp.json": {
        github: exampleMcpStdio({ title: "Team GitHub" }),
        jira: exampleMcpStdio({ title: "Team Jira" }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.skills["deploy"].description).toBe("Team deploy");
    expect(artifacts.skills["review"]).toBeDefined();
    expect(artifacts.skills["lint"]).toBeDefined();
    expect(artifacts.mcp["github"].title).toBe("Team GitHub");
    expect(artifacts.mcp["jira"]).toBeDefined();
  });

  it("explicit per-type arrays layer on top of catalogs", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./team"],
        skills: ["./local-skills.json"],
      },
      "team/skills/skills.json": {
        deploy: exampleSkill("deploy", { description: "Team deploy" }),
        review: exampleSkill("review"),
      },
      "local-skills.json": {
        deploy: exampleSkill("deploy", { description: "Local deploy" }),
        custom: exampleSkill("custom"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.skills["deploy"].description).toBe("Local deploy");
    expect(artifacts.skills["review"]).toBeDefined();
    expect(artifacts.skills["custom"]).toBeDefined();
  });

  it("tolerates trailing slashes on catalog paths", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./team/"],
      },
      "team/skills/skills.json": {
        deploy: exampleSkill("deploy"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["deploy"]).toBeDefined();
  });

  it("catalog skill paths are resolved to absolute paths relative to the catalog", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./team"],
      },
      "team/skills/skills.json": {
        deploy: { description: "Deploy", path: "deploy" },
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    // Path field is resolved relative to the index file's directory (team/skills/)
    expect(artifacts.skills["deploy"].path).toBe(join(dir, "team/skills/deploy"));
  });

  it("throws a clear error for catalog URIs without a registered provider", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["github://acme/org"],
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /No catalog provider registered for scheme "github:\/\/"/
    );
  });

  it("uses a provider's fileExists to skip missing catalog files", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["mock://catalog-a"],
      },
    });
    cleanup = c;

    const calls: string[] = [];
    const provider: CatalogProvider = {
      scheme: "mock",
      async fileExists(uri: string): Promise<boolean> {
        calls.push(`exists:${uri}`);
        return uri.endsWith("skills/skills.json");
      },
      async resolve(uri: string): Promise<Record<string, unknown>> {
        calls.push(`resolve:${uri}`);
        if (uri.endsWith("skills/skills.json")) {
          return { deploy: exampleSkill("deploy") };
        }
        throw new Error(`Mock provider asked to resolve unexpected URI: ${uri}`);
      },
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
    });

    expect(artifacts.skills["deploy"]).toBeDefined();
    expect(artifacts.mcp).toEqual({});
    // fileExists was called for every artifact type, resolve only for the existing one
    const existsCalls = calls.filter((c) => c.startsWith("exists:"));
    const resolveCalls = calls.filter((c) => c.startsWith("resolve:"));
    expect(existsCalls).toHaveLength(6);
    expect(resolveCalls).toEqual(["resolve:mock://catalog-a/skills/skills.json"]);
  });

  it("falls back to resolve() when a provider does not implement fileExists", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["mock2://cat"],
      },
    });
    cleanup = c;

    const provider: CatalogProvider = {
      scheme: "mock2",
      async resolve(uri: string): Promise<Record<string, unknown>> {
        if (uri.endsWith("mcp/mcp.json")) {
          return { server: exampleMcpStdio({ title: "Mock Server" }) };
        }
        throw new Error("not found");
      },
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
    });

    expect(artifacts.mcp["server"]?.title).toBe("Mock Server");
    expect(artifacts.skills).toEqual({});
  });

  it("allows per-catalog scoping — explicit arrays are unaffected when no catalogs are listed", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills/skills.json"],
      },
      "skills/skills.json": { deploy: exampleSkill("deploy") },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["deploy"]).toBeDefined();
  });

  it("treats catalogs: [] as a no-op (equivalent to no catalogs key)", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: [],
        skills: ["./skills/skills.json"],
      },
      "skills/skills.json": { deploy: exampleSkill("deploy") },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["deploy"]).toBeDefined();
    expect(artifacts.mcp).toEqual({});
  });

  it("expands plugins declared across separate catalogs", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./org", "./team"],
      },
      "org/plugins/plugins.json": {
        base: examplePlugin("base", {
          skills: ["shared-skill"],
        }),
      },
      "org/skills/skills.json": {
        "shared-skill": exampleSkill("shared-skill"),
      },
      "team/plugins/plugins.json": {
        app: examplePlugin("app", {
          plugins: ["base"],
        }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.plugins["base"]).toBeDefined();
    expect(artifacts.plugins["app"]).toBeDefined();
    // app references base from the other catalog; after plugin expansion,
    // app's primitives should include base's shared-skill.
    expect(artifacts.plugins["app"].skills).toContain("shared-skill");
  });
});
