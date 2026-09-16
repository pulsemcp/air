import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { resolveArtifacts } from "../src/config.js";
import type { CatalogProvider } from "../src/types.js";
import {
  createTempAirDir,
  exampleSkill,
  exampleMcpStdio,
  exampleRoot,
  exampleReference,
  exampleHook,
} from "./helpers.js";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("composition", () => {
  it("union: per-type arrays contribute disjoint shortnames under @local", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "team",
        skills: ["./org-skills.json", "./team-skills.json"],
        mcp: ["./org-mcp.json", "./team-mcp.json"],
      },
      "org-skills.json": {
        deploy: exampleSkill("deploy", { description: "Org deploy" }),
        review: exampleSkill("review"),
      },
      "team-skills.json": {
        // no overlap with org — different shortnames
        lint: exampleSkill("lint"),
      },
      "org-mcp.json": {
        github: exampleMcpStdio({ title: "Org GitHub" }),
      },
      "team-mcp.json": {
        // disjoint from org-mcp
        jira: exampleMcpStdio({ title: "Team Jira" }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.skills["@local/deploy"]).toBeDefined();
    expect(artifacts.skills["@local/review"]).toBeDefined();
    expect(artifacts.skills["@local/lint"]).toBeDefined();
    expect(artifacts.mcp["@local/github"]).toBeDefined();
    expect(artifacts.mcp["@local/jira"]).toBeDefined();
  });

  it("two contributors with the same qualified ID hard-fail", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        mcp: ["./base.json", "./override.json"],
      },
      "base.json": {
        server: exampleMcpStdio({ title: "Base" }),
      },
      "override.json": {
        server: exampleMcpStdio({ title: "Override" }),
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /Duplicate mcp ID "@local\/server"/,
    );
  });

  it("exclude drops a qualified ID from the resolved set", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        exclude: { skills: ["@local/lint"] },
      },
      "skills.json": {
        deploy: exampleSkill("deploy"),
        lint: exampleSkill("lint"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.skills["@local/deploy"]).toBeDefined();
    expect(artifacts.skills["@local/lint"]).toBeUndefined();
  });

  it("exclude entry that does not match anything emits a warning naming the type and id", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        exclude: { skills: ["@local/missing"] },
      },
      "skills.json": {
        deploy: exampleSkill("deploy"),
      },
    });
    cleanup = c;

    await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    expect(
      warnings.some(
        (w) =>
          w.includes("@local/missing") &&
          w.includes("exclude.skills") &&
          w.includes("did not match"),
      ),
    ).toBe(true);
  });

  it("non-qualified exclude entry hard-fails", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        exclude: { skills: ["lint"] },
      },
      "skills.json": {
        lint: exampleSkill("lint"),
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /must be a qualified ID/,
    );
  });

  it("legacy array shape for exclude is hard-rejected with a migration error", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        exclude: ["@local/lint"],
      },
      "skills.json": {
        lint: exampleSkill("lint"),
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /must be an object keyed by artifact type[^]*not an array[^]*Migration[^]*exclude:\s*\["@a\/x"\][^]*"<type>":\s*\["@a\/x"\]/,
    );
  });

  it("invalid exclude key is hard-rejected", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        exclude: { not_a_real_type: ["@local/lint"] },
      },
      "skills.json": {
        lint: exampleSkill("lint"),
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /key "not_a_real_type" is not a valid artifact type/,
    );
  });

  it("exclude is per-type — excluding a skill named 'github' does not drop an MCP server with the same shortname", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
        exclude: { skills: ["@local/github"] },
      },
      "skills.json": {
        github: exampleSkill("github", { description: "Github skill" }),
        deploy: exampleSkill("deploy"),
      },
      "mcp.json": {
        github: exampleMcpStdio({ title: "Github MCP" }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.skills["@local/github"]).toBeUndefined();
    expect(artifacts.skills["@local/deploy"]).toBeDefined();
    expect(artifacts.mcp["@local/github"]).toBeDefined();
  });

  it("wildcard pattern '@scope/*' drops every artifact of that type under the scope", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["mock://vendor/legacy"],
        skills: ["./local-skills.json"],
        exclude: { skills: ["@vendor/legacy/*"] },
      },
      "local-skills.json": {
        kept: exampleSkill("kept"),
      },
      "remote/skills/skills.json": {
        a: exampleSkill("a"),
        b: exampleSkill("b"),
        c: exampleSkill("c"),
      },
    });
    cleanup = c;

    const provider: CatalogProvider = {
      scheme: "mock",
      async resolveCatalogDir(): Promise<string> {
        return join(dir, "remote");
      },
      async resolve(): Promise<Record<string, unknown>> {
        return {};
      },
      getScope: () => "vendor/legacy",
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts.skills["@local/kept"]).toBeDefined();
    expect(artifacts.skills["@vendor/legacy/a"]).toBeUndefined();
    expect(artifacts.skills["@vendor/legacy/b"]).toBeUndefined();
    expect(artifacts.skills["@vendor/legacy/c"]).toBeUndefined();
    expect(
      warnings.filter((w) => w.includes('exclude.skills') && w.includes("did not match")).length,
    ).toBe(0);
  });

  it("wildcard pattern '@scope/*/shortname' drops a shortname across every repo under a scope", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["mock://vendor/repo-a", "mock://vendor/repo-b"],
        exclude: { mcp: ["@vendor/*/github"] },
      },
      "remote-a/mcp/mcp.json": {
        github: exampleMcpStdio({ title: "A github" }),
        slack: exampleMcpStdio({ title: "A slack" }),
      },
      "remote-b/mcp/mcp.json": {
        github: exampleMcpStdio({ title: "B github" }),
        jira: exampleMcpStdio({ title: "B jira" }),
      },
    });
    cleanup = c;

    const provider: CatalogProvider = {
      scheme: "mock",
      async resolveCatalogDir(uri: string): Promise<string> {
        if (uri === "mock://vendor/repo-a") return join(dir, "remote-a");
        return join(dir, "remote-b");
      },
      async resolve(): Promise<Record<string, unknown>> {
        return {};
      },
      getScope: (uri: string) =>
        uri === "mock://vendor/repo-a" ? "vendor/repo-a" : "vendor/repo-b",
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
    });

    expect(artifacts.mcp["@vendor/repo-a/github"]).toBeUndefined();
    expect(artifacts.mcp["@vendor/repo-b/github"]).toBeUndefined();
    expect(artifacts.mcp["@vendor/repo-a/slack"]).toBeDefined();
    expect(artifacts.mcp["@vendor/repo-b/jira"]).toBeDefined();
  });

  it("wildcard pattern '@*/repo/*' drops a whole repo's contribution regardless of scope first segment", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: [
          "mock://customer/agentic-engineering",
          "mock://other-customer/agentic-engineering",
          "mock://customer/other-repo",
        ],
        exclude: { skills: ["@*/agentic-engineering/*"] },
      },
      "remote-1/skills/skills.json": {
        review: exampleSkill("review"),
      },
      "remote-2/skills/skills.json": {
        review: exampleSkill("review"),
      },
      "remote-3/skills/skills.json": {
        deploy: exampleSkill("deploy"),
      },
    });
    cleanup = c;

    const provider: CatalogProvider = {
      scheme: "mock",
      async resolveCatalogDir(uri: string): Promise<string> {
        if (uri === "mock://customer/agentic-engineering")
          return join(dir, "remote-1");
        if (uri === "mock://other-customer/agentic-engineering")
          return join(dir, "remote-2");
        return join(dir, "remote-3");
      },
      async resolve(): Promise<Record<string, unknown>> {
        return {};
      },
      getScope: (uri: string) => {
        if (uri === "mock://customer/agentic-engineering")
          return "customer/agentic-engineering";
        if (uri === "mock://other-customer/agentic-engineering")
          return "other-customer/agentic-engineering";
        return "customer/other-repo";
      },
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
    });

    expect(artifacts.skills["@customer/agentic-engineering/review"]).toBeUndefined();
    expect(
      artifacts.skills["@other-customer/agentic-engineering/review"],
    ).toBeUndefined();
    expect(artifacts.skills["@customer/other-repo/deploy"]).toBeDefined();
  });

  it("a stale wildcard pattern produces a per-type per-pattern warning that names both", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        exclude: { skills: ["@vendor/nonexistent/*"] },
      },
      "skills.json": {
        deploy: exampleSkill("deploy"),
      },
    });
    cleanup = c;

    await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    const stale = warnings.filter(
      (w) =>
        w.includes("exclude.skills") &&
        w.includes('"@vendor/nonexistent/*"') &&
        w.includes("did not match"),
    );
    expect(stale).toHaveLength(1);
  });

  it("wildcards work uniformly across artifact types — exclude.hooks drops a wildcard pattern", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        hooks: ["./hooks.json"],
        exclude: { hooks: ["@local/legacy-*"] },
      },
      "hooks.json": {
        "legacy-pre-commit": exampleHook("legacy-pre-commit"),
        "legacy-post-merge": exampleHook("legacy-post-merge"),
        "modern-pre-commit": exampleHook("modern-pre-commit"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.hooks["@local/legacy-pre-commit"]).toBeUndefined();
    expect(artifacts.hooks["@local/legacy-post-merge"]).toBeUndefined();
    expect(artifacts.hooks["@local/modern-pre-commit"]).toBeDefined();
  });

  it("wildcard segments do not span '/' boundaries", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["mock://vendor/a", "mock://vendor-extra/legacy"],
        exclude: { skills: ["@vendor/*/keep"] },
      },
      "remote-a/skills/skills.json": {
        keep: exampleSkill("keep"),
      },
      "remote-b/skills/skills.json": {
        keep: exampleSkill("keep"),
      },
    });
    cleanup = c;

    const provider: CatalogProvider = {
      scheme: "mock",
      async resolveCatalogDir(uri: string): Promise<string> {
        if (uri === "mock://vendor/a") return join(dir, "remote-a");
        return join(dir, "remote-b");
      },
      async resolve(): Promise<Record<string, unknown>> {
        return {};
      },
      getScope: (uri: string) =>
        uri === "mock://vendor/a" ? "vendor/a" : "vendor-extra/legacy",
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
    });

    // `@vendor/*/keep` matches `@vendor/a/keep` (one segment between vendor and keep)
    expect(artifacts.skills["@vendor/a/keep"]).toBeUndefined();
    // It must NOT match `@vendor-extra/legacy/keep` because `*` cannot span `/`
    // and `vendor-extra` is a different first segment than `vendor`.
    expect(artifacts.skills["@vendor-extra/legacy/keep"]).toBeDefined();
  });

  it("different artifact types compose independently", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./s1.json", "./s2.json"],
        mcp: ["./m1.json"],
      },
      "s1.json": { a: exampleSkill("a") },
      "s2.json": { b: exampleSkill("b") },
      "m1.json": { x: exampleMcpStdio({ title: "X" }) },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(Object.keys(artifacts.skills).sort()).toEqual([
      "@local/a",
      "@local/b",
    ]);
    expect(Object.keys(artifacts.mcp)).toEqual(["@local/x"]);
  });

  it("artifact default_in_roots is inverted into qualified root membership", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        deploy: exampleSkill("deploy", { default_in_roots: ["web-app"] }),
        review: exampleSkill("review"),
      },
      "mcp.json": {
        github: exampleMcpStdio({ title: "GitHub", default_in_roots: ["web-app"] }),
        slack: exampleMcpStdio({ title: "Slack" }),
      },
      "roots.json": {
        "web-app": exampleRoot("web-app"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    const root = artifacts.roots["@local/web-app"];

    expect(root).toBeDefined();
    expect(root.default_mcp_servers).toEqual(["@local/github"]);
    expect(root.default_skills).toEqual(["@local/deploy"]);

    // Artifacts not assigned to the root contribute no membership.
    expect(root.default_mcp_servers).not.toContain("@local/slack");
    expect(root.default_skills).not.toContain("@local/review");

    // The authored field is consumed — it does not survive on resolved entries.
    expect(
      (artifacts.skills["@local/deploy"] as { default_in_roots?: string[] })
        .default_in_roots
    ).toBeUndefined();

    for (const id of root.default_mcp_servers!) {
      expect(artifacts.mcp[id]).toBeDefined();
    }
    for (const id of root.default_skills!) {
      expect(artifacts.skills[id]).toBeDefined();
    }
  });

  it("skill reference fields are canonicalized to qualified IDs", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        references: ["./refs.json"],
      },
      "skills.json": {
        deploy: exampleSkill("deploy", { references: ["git-workflow"] }),
        review: exampleSkill("review", { references: ["git-workflow"] }),
      },
      "refs.json": {
        "git-workflow": exampleReference("git-workflow"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.skills["@local/deploy"].references).toEqual([
      "@local/git-workflow",
    ]);
    expect(artifacts.skills["@local/review"].references).toEqual([
      "@local/git-workflow",
    ]);
    expect(artifacts.references["@local/git-workflow"]).toBeDefined();
  });

  it("reference to missing artifact warns and drops the reference", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
      },
      "skills.json": {
        deploy: exampleSkill("deploy", { references: ["missing-ref"] }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    // Resolution succeeds; the dangling reference is dropped, not fatal.
    expect(artifacts.skills["@local/deploy"]).toBeDefined();
    expect(artifacts.skills["@local/deploy"].references).toEqual([]);

    const missingWarns = warnings.filter((w) =>
      w.includes('references unknown reference "missing-ref"'),
    );
    expect(missingWarns).toHaveLength(1);
    expect(missingWarns[0]).toMatch(/Dropping the reference/);
  });

  it("reference to an excluded artifact warns and drops the reference", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        references: ["./refs.json"],
        exclude: { references: ["@local/git-workflow"] },
      },
      "skills.json": {
        deploy: exampleSkill("deploy", {
          references: ["git-workflow", "code-style"],
        }),
      },
      "refs.json": {
        "git-workflow": exampleReference("git-workflow"),
        "code-style": exampleReference("code-style"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts.skills["@local/deploy"]).toBeDefined();
    // Surviving reference is kept and canonicalized; excluded one is dropped.
    expect(artifacts.skills["@local/deploy"].references).toEqual([
      "@local/code-style",
    ]);
    expect(artifacts.references["@local/git-workflow"]).toBeUndefined();

    const dropWarns = warnings.filter((w) =>
      w.includes("removed by air.json#exclude"),
    );
    expect(dropWarns).toHaveLength(1);
    expect(dropWarns[0]).toMatch(
      /@local\/deploy\.references references reference "git-workflow"/,
    );
    expect(dropWarns[0]).toMatch(/@local\/git-workflow/);
    expect(dropWarns[0]).toMatch(/Dropping the reference/);
  });

  it("excluded MCP server drops out of every root's computed membership", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
        exclude: { mcp: ["@local/github"] },
      },
      "mcp.json": {
        github: exampleMcpStdio({
          title: "GitHub MCP",
          default_in_roots: ["web"],
        }),
        jira: exampleMcpStdio({ title: "Jira MCP", default_in_roots: ["web"] }),
      },
      "roots.json": {
        web: exampleRoot("web"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    // The excluded server is gone from the pool, so it never lands in the
    // inverted membership — only the surviving server remains.
    expect(artifacts.roots["@local/web"].default_mcp_servers).toEqual([
      "@local/jira",
    ]);
    expect(artifacts.mcp["@local/github"]).toBeUndefined();
  });

  it("default_in_roots referencing an excluded root warns and is dropped", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
        exclude: { roots: ["@local/legacy"] },
      },
      "mcp.json": {
        github: exampleMcpStdio({
          title: "GitHub MCP",
          default_in_roots: ["web", "legacy"],
        }),
      },
      "roots.json": {
        web: exampleRoot("web"),
        legacy: exampleRoot("legacy"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    // The excluded root is gone; the surviving root still gets the server.
    expect(artifacts.roots["@local/legacy"]).toBeUndefined();
    expect(artifacts.roots["@local/web"].default_mcp_servers).toEqual([
      "@local/github",
    ]);

    const dropWarns = warnings.filter((w) =>
      w.includes("removed by air.json#exclude"),
    );
    expect(dropWarns).toHaveLength(1);
    expect(dropWarns[0]).toMatch(/default_in_roots/);
    expect(dropWarns[0]).toMatch(/@local\/legacy/);
  });

  it('default_in_roots wildcard "*" lands the artifact in every root', async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        lint: exampleSkill("lint", { default_in_roots: ["*"] }),
        deploy: exampleSkill("deploy", { default_in_roots: ["web"] }),
      },
      "roots.json": {
        web: exampleRoot("web"),
        api: exampleRoot("api"),
        infra: exampleRoot("infra"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    // The wildcard skill is a default in every root...
    expect(artifacts.roots["@local/web"].default_skills).toContain(
      "@local/lint",
    );
    expect(artifacts.roots["@local/api"].default_skills).toEqual([
      "@local/lint",
    ]);
    expect(artifacts.roots["@local/infra"].default_skills).toEqual([
      "@local/lint",
    ]);
    // ...while the explicitly-scoped skill only lands in its named root.
    expect(artifacts.roots["@local/web"].default_skills).toEqual([
      "@local/deploy",
      "@local/lint",
    ]);
    expect(artifacts.roots["@local/api"].default_skills).not.toContain(
      "@local/deploy",
    );
    // The authored wildcard is consumed — it does not survive on the entry.
    expect(
      (artifacts.skills["@local/lint"] as { default_in_roots?: string[] })
        .default_in_roots,
    ).toBeUndefined();
  });

  it('a root with default_in_roots "*" is a default subagent of every OTHER root, never itself', async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        roots: ["./roots.json"],
      },
      "roots.json": {
        shared: exampleRoot("shared", { default_in_roots: ["*"] }),
        web: exampleRoot("web"),
        api: exampleRoot("api"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    // The wildcard root is a default subagent of the other roots...
    expect(artifacts.roots["@local/web"].default_subagent_roots).toEqual([
      "@local/shared",
    ]);
    expect(artifacts.roots["@local/api"].default_subagent_roots).toEqual([
      "@local/shared",
    ]);
    // ...but never of itself.
    expect(
      artifacts.roots["@local/shared"].default_subagent_roots,
    ).toBeUndefined();
  });

  it("legacy per-root default_* fields are ignored without warning (hard switch)", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        deploy: exampleSkill("deploy"),
      },
      "roots.json": {
        web: {
          ...exampleRoot("web"),
          // Legacy authoring shape — no longer read. It is unconditionally
          // overwritten by the computed (empty) membership, with no warning.
          default_skills: ["deploy"],
        },
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    // The legacy field is dropped: deploy declared no `default_in_roots`, so the
    // root ends up with no computed membership.
    expect(artifacts.roots["@local/web"].default_skills).toBeUndefined();

    // Hard switch: no deprecation warning is emitted for the legacy field.
    expect(warnings).toEqual([]);
  });

  it("excluded child plugin referenced by another plugin's plugins[] warns and is dropped before expandPlugins runs", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        plugins: ["./plugins.json"],
        exclude: { plugins: ["@local/child"] },
      },
      "skills.json": {
        deploy: exampleSkill("deploy"),
        lint: exampleSkill("lint"),
      },
      "plugins.json": {
        child: {
          description: "Child plugin (will be excluded)",
          path: "./child",
        },
        parent: {
          description: "Parent plugin that references the excluded child",
          path: "./parent",
        },
      },
      "child/.plugin/plugin.json": { skills: ["lint"] },
      "parent/.plugin/plugin.json": {
        plugins: ["child"],
        skills: ["deploy"],
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts.plugins["@local/child"]).toBeUndefined();
    // expandPlugins must not have thrown — and parent's own skills survive,
    // without the excluded child's `lint` contribution being merged in.
    expect(artifacts.plugins["@local/parent"]).toBeDefined();
    expect(artifacts.plugins["@local/parent"].plugins).toEqual([]);
    expect(artifacts.plugins["@local/parent"].skills).toEqual(["@local/deploy"]);

    const dropWarns = warnings.filter((w) =>
      w.includes("removed by air.json#exclude"),
    );
    expect(dropWarns).toHaveLength(1);
    expect(dropWarns[0]).toMatch(/@local\/parent\.plugins references plugin "child"/);
    expect(dropWarns[0]).toMatch(/@local\/child/);
  });

  it("wildcard exclude that drops a whole scope still demotes consumer references to warnings", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        references: ["./refs.json"],
        skills: ["./skills.json"],
        exclude: { references: ["@local/*"] },
      },
      "refs.json": {
        "git-workflow": exampleReference("git-workflow"),
        "code-style": exampleReference("code-style"),
      },
      "skills.json": {
        deploy: exampleSkill("deploy", {
          references: ["git-workflow", "code-style"],
        }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    // Both refs were dropped by the wildcard, so deploy's references list is empty.
    expect(artifacts.references).toEqual({});
    expect(artifacts.skills["@local/deploy"].references).toEqual([]);

    const dropWarns = warnings.filter((w) =>
      w.includes("removed by air.json#exclude"),
    );
    // One warning per dangling reference, naming the wildcard-expanded ID.
    expect(dropWarns).toHaveLength(2);
    expect(dropWarns.some((w) => w.includes("@local/git-workflow"))).toBe(true);
    expect(dropWarns.some((w) => w.includes("@local/code-style"))).toBe(true);
  });

  it("cross-scope shortname collision warns once when both scopes survive exclude", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["mock://acme"],
        skills: ["./local-skills.json"],
      },
      "local-skills.json": {
        review: exampleSkill("review"),
      },
      "remote/skills/skills.json": {
        review: exampleSkill("review", { description: "Org review" }),
      },
    });
    cleanup = c;

    const provider: CatalogProvider = {
      scheme: "mock",
      async resolveCatalogDir(): Promise<string> {
        return join(dir, "remote");
      },
      async resolve(): Promise<Record<string, unknown>> {
        return {};
      },
      getScope: () => "acme/skills",
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts.skills["@local/review"]).toBeDefined();
    expect(artifacts.skills["@acme/skills/review"]).toBeDefined();
    const collisionWarns = warnings.filter((w) =>
      w.includes("Cross-scope shortname collision"),
    );
    expect(collisionWarns).toHaveLength(1);
    expect(collisionWarns[0]).toMatch(/skills "review"/);
  });

  it("cross-scope shortname collision warning is silenced when exclude removes one side", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        catalogs: ["mock://acme"],
        skills: ["./local-skills.json"],
        exclude: { skills: ["@acme/skills/review"] },
      },
      "local-skills.json": {
        review: exampleSkill("review"),
      },
      "remote/skills/skills.json": {
        review: exampleSkill("review", { description: "Org review" }),
      },
    });
    cleanup = c;

    const provider: CatalogProvider = {
      scheme: "mock",
      async resolveCatalogDir(): Promise<string> {
        return join(dir, "remote");
      },
      async resolve(): Promise<Record<string, unknown>> {
        return {};
      },
      getScope: () => "acme/skills",
    };

    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts.skills["@local/review"]).toBeDefined();
    expect(artifacts.skills["@acme/skills/review"]).toBeUndefined();
    expect(
      warnings.filter((w) => w.includes("Cross-scope shortname collision"))
        .length,
    ).toBe(0);
  });

  // `default_runtime` is an authored, opaque pass-through: core resolves it
  // onto the `RootEntry` without interpreting it, so a consumer reading
  // `root.default_runtime` off `resolveArtifacts` output gets exactly what the
  // author wrote. Core knows nothing about what any runtime identifier means.
  it("carries an authored default_runtime through resolveArtifacts unchanged", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "team",
        roots: ["./roots.json"],
      },
      "roots.json": {
        "claude-root": exampleRoot("claude-root", {
          default_runtime: "claude_code",
        }),
        "codex-root": exampleRoot("codex-root", {
          default_runtime: "codex",
        }),
        // An identifier core has never heard of — it must survive untouched.
        "future-root": exampleRoot("future-root", {
          default_runtime: "some-future-agent",
        }),
        // Omitted entirely: core does NOT default it to "claude_code";
        // resolving the default is the consumer's job.
        "unset-root": exampleRoot("unset-root"),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.roots["@local/claude-root"].default_runtime).toBe(
      "claude_code",
    );
    expect(artifacts.roots["@local/codex-root"].default_runtime).toBe("codex");
    expect(artifacts.roots["@local/future-root"].default_runtime).toBe(
      "some-future-agent",
    );
    expect(artifacts.roots["@local/unset-root"].default_runtime).toBeUndefined();
  });
});
