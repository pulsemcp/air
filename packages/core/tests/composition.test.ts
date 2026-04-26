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

  it("root reference fields are canonicalized to qualified IDs", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        deploy: exampleSkill("deploy"),
        review: exampleSkill("review"),
      },
      "mcp.json": {
        github: exampleMcpStdio({ title: "GitHub" }),
        slack: exampleMcpStdio({ title: "Slack" }),
      },
      "roots.json": {
        "web-app": exampleRoot("web-app", {
          default_mcp_servers: ["github"],
          default_skills: ["deploy"],
        }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    const root = artifacts.roots["@local/web-app"];

    expect(root).toBeDefined();
    expect(root.default_mcp_servers).toEqual(["@local/github"]);
    expect(root.default_skills).toEqual(["@local/deploy"]);

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

  it("reference to missing artifact hard-fails", async () => {
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

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /references unknown reference "missing-ref"/,
    );
  });

  it("reference to an excluded artifact emits a tailored error", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        references: ["./refs.json"],
        exclude: { references: ["@local/git-workflow"] },
      },
      "skills.json": {
        deploy: exampleSkill("deploy", { references: ["git-workflow"] }),
      },
      "refs.json": {
        "git-workflow": exampleReference("git-workflow"),
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /removed by air\.json#exclude.*@local\/git-workflow/s,
    );
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
});
