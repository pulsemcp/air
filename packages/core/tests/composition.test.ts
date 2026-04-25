import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { resolveArtifacts } from "../src/config.js";
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
        exclude: ["@local/lint"],
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

  it("exclude entry that does not match anything emits a warning", async () => {
    const warnings: string[] = [];
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        exclude: ["@local/missing"],
      },
      "skills.json": {
        deploy: exampleSkill("deploy"),
      },
    });
    cleanup = c;

    await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    expect(warnings.some((w) => w.includes("@local/missing"))).toBe(true);
  });

  it("non-qualified exclude entry hard-fails", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        exclude: ["lint"],
      },
      "skills.json": {
        lint: exampleSkill("lint"),
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /must be qualified IDs/,
    );
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
});
