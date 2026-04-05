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
  it("org → team layering: team overrides org", async () => {
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
        deploy: exampleSkill("deploy", { description: "Team deploy" }),
        lint: exampleSkill("lint"),
      },
      "org-mcp.json": {
        github: exampleMcpStdio({ title: "Org GitHub" }),
      },
      "team-mcp.json": {
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

  it("override replaces entirely, not deep merge", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        mcp: ["./base.json", "./override.json"],
      },
      "base.json": {
        server: exampleMcpStdio({
          title: "Base",
          env: { A: "1", B: "2" },
        }),
      },
      "override.json": {
        server: exampleMcpStdio({
          title: "Override",
          env: { C: "3" },
        }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    // Full replacement — B is gone
    expect(artifacts.mcp["server"].title).toBe("Override");
    expect(artifacts.mcp["server"].env).toEqual({ C: "3" });
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

    expect(Object.keys(artifacts.skills)).toEqual(["a", "b"]);
    expect(Object.keys(artifacts.mcp)).toEqual(["x"]);
  });

  it("root references resolve against merged artifacts", async () => {
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
    const root = artifacts.roots["web-app"];

    expect(root.default_mcp_servers).toEqual(["github"]);
    expect(root.default_skills).toEqual(["deploy"]);

    // Verify the referenced IDs exist in the merged artifacts
    for (const id of root.default_mcp_servers!) {
      expect(artifacts.mcp[id]).toBeDefined();
    }
    for (const id of root.default_skills!) {
      expect(artifacts.skills[id]).toBeDefined();
    }
  });

  it("skills share references (DRY pattern)", async () => {
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

    // Both skills reference the same reference
    expect(artifacts.skills["deploy"].references).toEqual(["git-workflow"]);
    expect(artifacts.skills["review"].references).toEqual(["git-workflow"]);
    // Reference exists once
    expect(artifacts.references["git-workflow"]).toBeDefined();
  });
});
