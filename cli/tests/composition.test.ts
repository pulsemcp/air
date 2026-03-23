import { describe, it, expect, afterEach } from "vitest";
import { resolveArtifacts } from "../src/lib/config.js";
import {
  createTempAirDir,
  minimalAirJson,
  exampleSkill,
  exampleMcpStdio,
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

describe("Composition via air.json arrays (docs/configuration.md)", () => {
  it("org -> team: team file overrides org for matching IDs", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        mcp: ["./org-mcp.json", "./team-mcp.json"],
        skills: ["./org-skills.json"],
      }),
      "org-mcp.json": {
        github: exampleMcpStdio({ title: "GitHub (Org)" }),
        sentry: exampleMcpStdio({ title: "Sentry (Org)" }),
      },
      "team-mcp.json": {
        github: exampleMcpStdio({ title: "GitHub (Team)" }),
        postgres: exampleMcpStdio({ title: "Postgres (Team)" }),
      },
      "org-skills.json": {
        deploy: exampleSkill("deploy", { description: "Org deploy process" }),
        review: exampleSkill("review", { description: "Org review process" }),
      },
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);

    expect(artifacts.mcp["github"].title).toBe("GitHub (Team)");
    expect(artifacts.mcp["sentry"].title).toBe("Sentry (Org)");
    expect(artifacts.mcp["postgres"].title).toBe("Postgres (Team)");
    expect(artifacts.skills["deploy"].description).toBe("Org deploy process");
    expect(artifacts.skills["review"].description).toBe("Org review process");
  });

  it("org -> team -> project: three-layer composition", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        mcp: ["./org.json", "./team.json", "./project.json"],
      }),
      "org.json": {
        github: exampleMcpStdio({ title: "GitHub (Org)" }),
        sentry: exampleMcpStdio({ title: "Sentry (Org)" }),
      },
      "team.json": {
        github: exampleMcpStdio({ title: "GitHub (Team)" }),
        postgres: exampleMcpStdio({ title: "Postgres (Team)" }),
      },
      "project.json": {
        github: exampleMcpStdio({ title: "GitHub (Project)" }),
        redis: exampleMcpStdio({ title: "Redis (Project)" }),
      },
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);

    expect(artifacts.mcp["github"].title).toBe("GitHub (Project)");
    expect(artifacts.mcp["sentry"].title).toBe("Sentry (Org)");
    expect(artifacts.mcp["postgres"].title).toBe("Postgres (Team)");
    expect(artifacts.mcp["redis"].title).toBe("Redis (Project)");
  });

  it("override replaces entirely, not deep merge", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        mcp: ["./base.json", "./override.json"],
      }),
      "base.json": {
        server: exampleMcpStdio({
          title: "Server v1",
          description: "Original",
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

  it("different artifact types compose independently", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        mcp: ["./mcp.json"],
        skills: ["./skills.json"],
        references: ["./references.json"],
      }),
      "mcp.json": { github: exampleMcpStdio({ title: "GitHub" }) },
      "skills.json": {
        deploy: exampleSkill("deploy", { references: ["git-workflow"] }),
      },
      "references.json": {
        "git-workflow": exampleReference("git-workflow"),
      },
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);
    expect(Object.keys(artifacts.mcp)).toHaveLength(1);
    expect(Object.keys(artifacts.skills)).toHaveLength(1);
    expect(Object.keys(artifacts.references)).toHaveLength(1);
    expect(artifacts.skills["deploy"].references).toContain("git-workflow");
  });

  it("root references resolve against merged artifact set", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        mcp: ["./org-mcp.json"],
        skills: ["./org-skills.json"],
        roots: ["./roots.json"],
      }),
      "org-mcp.json": {
        github: exampleMcpStdio({ title: "GitHub" }),
        sentry: exampleMcpStdio({ title: "Sentry" }),
      },
      "org-skills.json": {
        deploy: exampleSkill("deploy"),
        review: exampleSkill("review"),
      },
      "roots.json": {
        "web-app": exampleRoot("web-app", {
          default_mcp_servers: ["github"],
          default_skills: ["deploy"],
        }),
      },
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);
    const root = artifacts.roots["web-app"];
    expect(root.default_mcp_servers).toEqual(["github"]);
    expect(root.default_skills).toEqual(["deploy"]);

    for (const serverId of root.default_mcp_servers!) {
      expect(artifacts.mcp[serverId]).toBeDefined();
    }
    for (const skillId of root.default_skills!) {
      expect(artifacts.skills[skillId]).toBeDefined();
    }
  });
});

describe("DRY References Pattern (docs/references.md)", () => {
  it("multiple skills reference the same reference document", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        skills: ["./skills.json"],
        references: ["./references.json"],
      }),
      "skills.json": {
        deploy: exampleSkill("deploy", { references: ["git-workflow", "staging-env"] }),
        review: exampleSkill("review", { references: ["git-workflow", "code-standards"] }),
        release: exampleSkill("release", { references: ["git-workflow"] }),
      },
      "references.json": {
        "git-workflow": exampleReference("git-workflow"),
        "staging-env": exampleReference("staging-env"),
        "code-standards": exampleReference("code-standards"),
      },
    });
    cleanups.push(cleanup);

    const artifacts = resolveArtifacts(`${dir}/air.json`);

    expect(artifacts.skills["deploy"].references).toContain("git-workflow");
    expect(artifacts.skills["review"].references).toContain("git-workflow");
    expect(artifacts.skills["release"].references).toContain("git-workflow");
    expect(artifacts.references["git-workflow"]).toBeDefined();
    expect(artifacts.skills["deploy"].references).toContain("staging-env");
    expect(artifacts.skills["review"].references).toContain("code-standards");
  });
});
