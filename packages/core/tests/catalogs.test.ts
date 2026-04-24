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

  it("throws a clear error when a provider lacks resolveCatalogDir", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["mock2://cat"],
      },
    });
    cleanup = c;

    const provider: CatalogProvider = {
      scheme: "mock2",
      async resolve(): Promise<Record<string, unknown>> {
        return {};
      },
    };

    await expect(
      resolveArtifacts(join(dir, "air.json"), { providers: [provider] })
    ).rejects.toThrow(/does not support catalog discovery/);
  });

  it("delegates to provider.resolveCatalogDir for remote catalog URIs", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["mock://cat-a"],
      },
      // Provider clones "mock://cat-a" into this local directory.
      "remote-clone/agent-roots/roots.json": {
        "web-app": exampleRoot("web-app"),
      },
      "remote-clone/mcp-servers/mcp.json": {
        github: exampleMcpStdio({ title: "Remote GitHub" }),
      },
    });
    cleanup = c;

    const calls: string[] = [];
    const provider: CatalogProvider = {
      scheme: "mock",
      async resolveCatalogDir(uri: string): Promise<string> {
        calls.push(`resolveCatalogDir:${uri}`);
        return join(dir, "remote-clone");
      },
      async resolve(): Promise<Record<string, unknown>> {
        throw new Error("resolve() should not be called for catalog discovery");
      },
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
    });

    expect(artifacts.roots["web-app"]).toBeDefined();
    expect(artifacts.mcp["github"].title).toBe("Remote GitHub");
    expect(calls).toEqual(["resolveCatalogDir:mock://cat-a"]);
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

  // ---------------------------------------------------------------------
  // Loose catalog introspection — catalogs may place indexes anywhere in
  // the tree (not only under the conventional <type>/<type>.json layout).
  // ---------------------------------------------------------------------

  it("discovers roots.json under a non-conventional subdirectory name", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./pulsemcp-agents"],
      },
      // Mimics pulsemcp/pulsemcp's actual layout from issue #108.
      "pulsemcp-agents/agent-roots/roots.json": {
        "air-root": exampleRoot("air-root"),
      },
      "pulsemcp-agents/mcp-servers/mcp.json": {
        github: exampleMcpStdio({ title: "Agent GitHub" }),
      },
      // Conventional paths still work alongside.
      "pulsemcp-agents/skills/skills.json": {
        deploy: exampleSkill("deploy"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.roots["air-root"]).toBeDefined();
    expect(artifacts.mcp["github"].title).toBe("Agent GitHub");
    expect(artifacts.skills["deploy"]).toBeDefined();
  });

  it("discovers an index by $schema when filename does not match the type keyword", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      // Filename has no catalog-type keyword — only $schema identifies it.
      "cat/extras/my-config.json": {
        $schema: "https://pulsemcp.com/air/roots.schema.json",
        "web-app": exampleRoot("web-app"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.roots["web-app"]).toBeDefined();
  });

  it("skips JSON files whose $schema points to a non-AIR schema", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      // Filename says "roots" but $schema is explicitly non-AIR — must be skipped.
      "cat/agent-roots/roots.json": {
        $schema: "https://example.com/unrelated.schema.json",
        "web-app": exampleRoot("web-app"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.roots).toEqual({});
  });

  it("resolves collisions within a single catalog via last-wins by sorted relPath", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      // Sorted alphabetically by relPath: "agent-roots/roots.json" < "experiments/roots/roots.json"
      // so "experiments" wins when both define the same ID.
      "cat/agent-roots/roots.json": {
        "web-app": exampleRoot("web-app", { description: "Agent roots" }),
      },
      "cat/experiments/roots/roots.json": {
        "web-app": exampleRoot("web-app", { description: "Experiments roots" }),
        "experimental-app": exampleRoot("experimental-app"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.roots["web-app"].description).toBe("Experiments roots");
    expect(artifacts.roots["experimental-app"]).toBeDefined();
  });

  it("caps directory walk at depth 3 from the catalog root", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      // Depth 0 — file at the catalog root.
      "cat/roots.json": {
        "root-level-root": exampleRoot("root-level-root"),
      },
      // Depth 2 from the catalog root — discovered.
      "cat/agents/agent-roots/roots.json": {
        "shallow-root": exampleRoot("shallow-root"),
      },
      // Depth 3 — at the cap, still discovered.
      "cat/a/b/c/roots.json": {
        "boundary-root": exampleRoot("boundary-root"),
      },
      // Depth 4 — beyond the cap.
      "cat/a/b/c/d/roots.json": {
        "too-deep-root": exampleRoot("too-deep-root"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.roots["root-level-root"]).toBeDefined();
    expect(artifacts.roots["shallow-root"]).toBeDefined();
    expect(artifacts.roots["boundary-root"]).toBeDefined();
    expect(artifacts.roots["too-deep-root"]).toBeUndefined();
  });

  it("respects .gitignore at the catalog root", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      "cat/.gitignore": "scratch/\ntmp-roots.json\n",
      "cat/kept/roots.json": {
        "kept-root": exampleRoot("kept-root"),
      },
      // Directory ignored by .gitignore — must not be descended into.
      "cat/scratch/roots.json": {
        "ignored-root": exampleRoot("ignored-root"),
      },
      // File ignored by .gitignore — must be skipped.
      "cat/tmp-roots.json": {
        "tmp-root": exampleRoot("tmp-root"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.roots["kept-root"]).toBeDefined();
    expect(artifacts.roots["ignored-root"]).toBeUndefined();
    expect(artifacts.roots["tmp-root"]).toBeUndefined();
  });

  it("never descends into hardcoded skip directories (node_modules, .git, dist, …)", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      "cat/skills/skills.json": {
        deploy: exampleSkill("deploy"),
      },
      "cat/node_modules/foo/roots.json": {
        "noise-root": exampleRoot("noise-root"),
      },
      "cat/dist/roots.json": {
        "build-root": exampleRoot("build-root"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["deploy"]).toBeDefined();
    expect(artifacts.roots["noise-root"]).toBeUndefined();
    expect(artifacts.roots["build-root"]).toBeUndefined();
  });

  it("skips hidden directories and files during discovery", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      "cat/skills/skills.json": {
        deploy: exampleSkill("deploy"),
      },
      "cat/.private/roots.json": {
        "hidden-root": exampleRoot("hidden-root"),
      },
      "cat/.stashed-roots.json": {
        "dotfile-root": exampleRoot("dotfile-root"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["deploy"]).toBeDefined();
    expect(artifacts.roots["hidden-root"]).toBeUndefined();
    expect(artifacts.roots["dotfile-root"]).toBeUndefined();
  });

  it("ignores JSON files whose filename has no AIR type keyword and no $schema", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      "cat/package.json": { name: "not-air", version: "1.0.0" },
      "cat/tsconfig.json": { compilerOptions: { target: "ES2020" } },
      "cat/skills/skills.json": {
        deploy: exampleSkill("deploy"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["deploy"]).toBeDefined();
  });

  it("skips unparseable JSON files silently", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      "cat/skills/skills.json": {
        deploy: exampleSkill("deploy"),
      },
      // Matches the filename pattern for "roots" but is not valid JSON.
      "cat/extras/roots.json": "not valid json {{",
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["deploy"]).toBeDefined();
    expect(artifacts.roots).toEqual({});
  });

  it("resolves relative path fields against the discovered index's directory", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      "cat/agent-roots/roots.json": {
        "web-app": {
          description: "Web app root",
          default_mcp_servers: [],
          default_skills: [],
        },
      },
      "cat/custom/skills.json": {
        "custom-skill": { description: "Custom skill", path: "./actual-dir" },
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["custom-skill"].path).toBe(
      join(dir, "cat/custom/actual-dir")
    );
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
