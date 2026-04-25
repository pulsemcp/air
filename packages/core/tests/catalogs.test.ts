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
  it("expands a single local catalog into all artifact types under @local", async () => {
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

    expect(artifacts.skills["@local/deploy"]).toBeDefined();
    expect(artifacts.references["@local/git-workflow"]).toBeDefined();
    expect(artifacts.mcp["@local/github"].title).toBe("Team GitHub");
    expect(artifacts.plugins["@local/toolkit"]).toBeDefined();
    expect(artifacts.roots["@local/web-app"]).toBeDefined();
    expect(artifacts.hooks["@local/pre-commit"]).toBeDefined();
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

    expect(artifacts.skills["@local/deploy"]).toBeDefined();
    expect(artifacts.mcp).toEqual({});
    expect(artifacts.hooks).toEqual({});
  });

  it("multiple local catalogs hard-fail on the same shortname (both qualify under @local)", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./org", "./team"],
      },
      "org/skills/skills.json": {
        deploy: exampleSkill("deploy", { description: "Org deploy" }),
      },
      "team/skills/skills.json": {
        deploy: exampleSkill("deploy", { description: "Team deploy" }),
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /Duplicate skills ID "@local\/deploy"/,
    );
  });

  it("multiple local catalogs union when shortnames are disjoint", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./org", "./team"],
      },
      "org/skills/skills.json": {
        deploy: exampleSkill("deploy"),
        review: exampleSkill("review"),
      },
      "team/skills/skills.json": {
        lint: exampleSkill("lint"),
      },
      "org/mcp/mcp.json": {
        github: exampleMcpStdio({ title: "Org GitHub" }),
      },
      "team/mcp/mcp.json": {
        jira: exampleMcpStdio({ title: "Team Jira" }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.skills["@local/deploy"]).toBeDefined();
    expect(artifacts.skills["@local/review"]).toBeDefined();
    expect(artifacts.skills["@local/lint"]).toBeDefined();
    expect(artifacts.mcp["@local/github"].title).toBe("Org GitHub");
    expect(artifacts.mcp["@local/jira"].title).toBe("Team Jira");
  });

  it("explicit per-type arrays union with catalogs (hard-fail on shared shortname under same scope)", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./team"],
        skills: ["./local-skills.json"],
      },
      "team/skills/skills.json": {
        deploy: exampleSkill("deploy", { description: "Team deploy" }),
      },
      "local-skills.json": {
        deploy: exampleSkill("deploy", { description: "Local deploy" }),
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /Duplicate skills ID "@local\/deploy"/,
    );
  });

  it("explicit per-type arrays add disjoint shortnames to the catalog set", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./team"],
        skills: ["./local-skills.json"],
      },
      "team/skills/skills.json": {
        deploy: exampleSkill("deploy"),
        review: exampleSkill("review"),
      },
      "local-skills.json": {
        custom: exampleSkill("custom"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["@local/deploy"]).toBeDefined();
    expect(artifacts.skills["@local/review"]).toBeDefined();
    expect(artifacts.skills["@local/custom"]).toBeDefined();
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
    expect(artifacts.skills["@local/deploy"]).toBeDefined();
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
    expect(artifacts.skills["@local/deploy"].path).toBe(
      join(dir, "team/skills/deploy"),
    );
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
      /No catalog provider registered for scheme "github:\/\/"/,
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
      resolveArtifacts(join(dir, "air.json"), { providers: [provider] }),
    ).rejects.toThrow(/does not support catalog discovery/);
  });

  it("delegates to provider.resolveCatalogDir for remote catalog URIs and uses provider scope", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["mock://cat-a"],
      },
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
      getScope: () => "acme/cat-a",
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
    });

    expect(artifacts.roots["@acme/cat-a/web-app"]).toBeDefined();
    expect(artifacts.mcp["@acme/cat-a/github"].title).toBe("Remote GitHub");
    expect(calls).toEqual(["resolveCatalogDir:mock://cat-a"]);
  });

  it("provider catalog without getScope falls back to @local", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["mock://cat-a"],
      },
      "remote-clone/skills/skills.json": {
        deploy: exampleSkill("deploy"),
      },
    });
    cleanup = c;

    const provider: CatalogProvider = {
      scheme: "mock",
      async resolveCatalogDir(): Promise<string> {
        return join(dir, "remote-clone");
      },
      async resolve(): Promise<Record<string, unknown>> {
        return {};
      },
      // intentionally no getScope
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
    });

    expect(artifacts.skills["@local/deploy"]).toBeDefined();
  });

  it("explicit arrays alone (no catalogs key) work under @local", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills/skills.json"],
      },
      "skills/skills.json": { deploy: exampleSkill("deploy") },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["@local/deploy"]).toBeDefined();
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
    expect(artifacts.skills["@local/deploy"]).toBeDefined();
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
      "pulsemcp-agents/agent-roots/roots.json": {
        "air-root": exampleRoot("air-root"),
      },
      "pulsemcp-agents/mcp-servers/mcp.json": {
        github: exampleMcpStdio({ title: "Agent GitHub" }),
      },
      "pulsemcp-agents/skills/skills.json": {
        deploy: exampleSkill("deploy"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.roots["@local/air-root"]).toBeDefined();
    expect(artifacts.mcp["@local/github"].title).toBe("Agent GitHub");
    expect(artifacts.skills["@local/deploy"]).toBeDefined();
  });

  it("discovers an index by $schema when filename does not match the type keyword", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      "cat/extras/my-config.json": {
        $schema: "https://pulsemcp.com/air/roots.schema.json",
        "web-app": exampleRoot("web-app"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.roots["@local/web-app"]).toBeDefined();
  });

  it("skips JSON files whose $schema points to a non-AIR schema", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      "cat/agent-roots/roots.json": {
        $schema: "https://example.com/unrelated.schema.json",
        "web-app": exampleRoot("web-app"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.roots).toEqual({});
  });

  it("collisions within a single catalog hard-fail (same scope, same shortname)", async () => {
    // Within a catalog, indexes are loaded as separate contributions but share
    // the same scope. Two indexes producing the same shortname therefore
    // produce the same qualified ID and must hard-fail.
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      "cat/agent-roots/roots.json": {
        "web-app": exampleRoot("web-app", { description: "Agent roots" }),
      },
      "cat/experiments/roots/roots.json": {
        "web-app": exampleRoot("web-app", {
          description: "Experiments roots",
        }),
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /Duplicate roots ID "@local\/web-app"/,
    );
  });

  it("caps directory walk at depth 3 from the catalog root", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["./cat"],
      },
      "cat/roots.json": {
        "root-level-root": exampleRoot("root-level-root"),
      },
      "cat/agents/agent-roots/roots.json": {
        "shallow-root": exampleRoot("shallow-root"),
      },
      "cat/a/b/c/roots.json": {
        "boundary-root": exampleRoot("boundary-root"),
      },
      "cat/a/b/c/d/roots.json": {
        "too-deep-root": exampleRoot("too-deep-root"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.roots["@local/root-level-root"]).toBeDefined();
    expect(artifacts.roots["@local/shallow-root"]).toBeDefined();
    expect(artifacts.roots["@local/boundary-root"]).toBeDefined();
    expect(artifacts.roots["@local/too-deep-root"]).toBeUndefined();
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
      "cat/scratch/roots.json": {
        "ignored-root": exampleRoot("ignored-root"),
      },
      "cat/tmp-roots.json": {
        "tmp-root": exampleRoot("tmp-root"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.roots["@local/kept-root"]).toBeDefined();
    expect(artifacts.roots["@local/ignored-root"]).toBeUndefined();
    expect(artifacts.roots["@local/tmp-root"]).toBeUndefined();
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
    expect(artifacts.skills["@local/deploy"]).toBeDefined();
    expect(artifacts.roots["@local/noise-root"]).toBeUndefined();
    expect(artifacts.roots["@local/build-root"]).toBeUndefined();
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
    expect(artifacts.skills["@local/deploy"]).toBeDefined();
    expect(artifacts.roots["@local/hidden-root"]).toBeUndefined();
    expect(artifacts.roots["@local/dotfile-root"]).toBeUndefined();
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
    expect(artifacts.skills["@local/deploy"]).toBeDefined();
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
      "cat/extras/roots.json": "not valid json {{",
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["@local/deploy"]).toBeDefined();
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
    expect(artifacts.skills["@local/custom-skill"].path).toBe(
      join(dir, "cat/custom/actual-dir"),
    );
  });

  it("expands plugins declared across separate catalogs (intra-catalog references)", async () => {
    // Two catalogs, both with @local scope. The "base" plugin lives in the
    // org catalog and references shared-skill, also in org. The "app" plugin
    // lives in team and references base.
    // Intra-catalog rule: base.skills=["shared-skill"] resolves to
    // @local/shared-skill; app.plugins=["base"] resolves to @local/base.
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

    expect(artifacts.plugins["@local/base"]).toBeDefined();
    expect(artifacts.plugins["@local/app"]).toBeDefined();
    expect(artifacts.plugins["@local/app"].skills).toContain(
      "@local/shared-skill",
    );
  });
});
