import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { resolve, join } from "path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "fs";
import { tmpdir } from "os";

const CLI = resolve(__dirname, "../src/index.ts");
const run = (args: string, env?: Record<string, string>) =>
  execSync(`npx tsx ${CLI} ${args}`, {
    encoding: "utf-8",
    cwd: resolve(__dirname, "../../.."),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

const tryRun = (args: string, env?: Record<string, string>) => {
  try {
    return { stdout: run(args, env), exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status,
    };
  }
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

function createTemp(files: Record<string, unknown>): string {
  const dir = resolve(
    tmpdir(),
    `air-prepare-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(
      path,
      typeof content === "string" ? content : JSON.stringify(content, null, 2)
    );
  }
  return dir;
}

describe("prepare command", () => {
  it("writes .mcp.json to target directory", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
      },
      "mcp.json": {
        github: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@mcp/github"],
          env: { TOKEN: "abc" },
        },
      },
    });

    const target = createTemp({});

    const result = tryRun(
      `prepare --config ${join(catalog, "air.json")} --target ${target}`
    );
    expect(result.exitCode).toBe(0);

    // Should have written .mcp.json
    const mcpJsonPath = join(target, ".mcp.json");
    expect(existsSync(mcpJsonPath)).toBe(true);

    const mcpJson = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    expect(mcpJson.mcpServers.github).toBeDefined();
    expect(mcpJson.mcpServers.github.command).toBe("npx");
    expect(mcpJson.mcpServers.github.env.TOKEN).toBe("abc");

    // Should output JSON to stdout
    const output = JSON.parse(result.stdout);
    expect(output.configFiles).toContain(mcpJsonPath);
  });

  it("injects skills from catalog into target", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
      },
      "skills.json": {
        "my-skill": {
          id: "my-skill",
          description: "A test skill",
          path: "skills/my-skill",
        },
      },
      "skills/my-skill/SKILL.md": "# My Skill\nDo the thing.",
    });

    const target = createTemp({});

    const result = tryRun(
      `prepare --config ${join(catalog, "air.json")} --target ${target}`
    );
    expect(result.exitCode).toBe(0);

    // Skill should be copied to .claude/skills/my-skill/
    const skillMd = join(target, ".claude", "skills", "my-skill", "SKILL.md");
    expect(existsSync(skillMd)).toBe(true);
    expect(readFileSync(skillMd, "utf-8")).toContain("My Skill");

    const output = JSON.parse(result.stdout);
    expect(output.skillPaths).toContain(
      join(target, ".claude", "skills", "my-skill")
    );
  });

  it("respects local priority — does not overwrite existing skills", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
      },
      "skills.json": {
        "existing-skill": {
          id: "existing-skill",
          description: "Catalog version",
          path: "skills/existing-skill",
        },
      },
      "skills/existing-skill/SKILL.md": "# Catalog Version",
    });

    const target = createTemp({
      ".claude/skills/existing-skill/SKILL.md": "# Local Version",
    });

    const result = tryRun(
      `prepare --config ${join(catalog, "air.json")} --target ${target}`
    );
    expect(result.exitCode).toBe(0);

    // Local version should be preserved
    const skillMd = join(
      target,
      ".claude",
      "skills",
      "existing-skill",
      "SKILL.md"
    );
    expect(readFileSync(skillMd, "utf-8")).toContain("Local Version");
  });

  it("filters artifacts by root defaults", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "mcp.json": {
        github: { type: "stdio", command: "npx", args: ["github-mcp"] },
        slack: { type: "stdio", command: "npx", args: ["slack-mcp"] },
        postgres: { type: "stdio", command: "npx", args: ["pg-mcp"] },
      },
      "roots.json": {
        "web-app": {
          name: "web-app",
          description: "Web app root",
          default_mcp_servers: ["github", "postgres"],
        },
      },
    });

    const target = createTemp({});

    const result = tryRun(
      `prepare --config ${join(catalog, "air.json")} --root web-app --target ${target}`
    );
    expect(result.exitCode).toBe(0);

    const mcpJson = JSON.parse(
      readFileSync(join(target, ".mcp.json"), "utf-8")
    );
    expect(mcpJson.mcpServers.github).toBeDefined();
    expect(mcpJson.mcpServers.postgres).toBeDefined();
    expect(mcpJson.mcpServers.slack).toBeUndefined();
  });

  it("supports --skills override", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        "skill-a": {
          id: "skill-a",
          description: "Skill A",
          path: "skills/skill-a",
        },
        "skill-b": {
          id: "skill-b",
          description: "Skill B",
          path: "skills/skill-b",
        },
        "skill-c": {
          id: "skill-c",
          description: "Skill C",
          path: "skills/skill-c",
        },
      },
      "skills/skill-a/SKILL.md": "# A",
      "skills/skill-b/SKILL.md": "# B",
      "skills/skill-c/SKILL.md": "# C",
      "roots.json": {
        myroot: {
          name: "myroot",
          description: "Test root",
          default_skills: ["skill-a", "skill-b"],
        },
      },
    });

    const target = createTemp({});

    // Override to only use skill-c (ignoring root defaults)
    const result = tryRun(
      `prepare --config ${join(catalog, "air.json")} --root myroot --skills skill-c --target ${target}`
    );
    expect(result.exitCode).toBe(0);

    expect(
      existsSync(join(target, ".claude", "skills", "skill-c", "SKILL.md"))
    ).toBe(true);
    expect(
      existsSync(join(target, ".claude", "skills", "skill-a"))
    ).toBe(false);
    expect(
      existsSync(join(target, ".claude", "skills", "skill-b"))
    ).toBe(false);
  });

  it("supports --mcp-servers override", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "mcp.json": {
        github: { type: "stdio", command: "npx", args: ["github-mcp"] },
        slack: { type: "stdio", command: "npx", args: ["slack-mcp"] },
      },
      "roots.json": {
        myroot: {
          name: "myroot",
          description: "Test",
          default_mcp_servers: ["github"],
        },
      },
    });

    const target = createTemp({});

    // Override to only use slack (ignoring root's default of github)
    const result = tryRun(
      `prepare --config ${join(catalog, "air.json")} --root myroot --mcp-servers slack --target ${target}`
    );
    expect(result.exitCode).toBe(0);

    const mcpJson = JSON.parse(
      readFileSync(join(target, ".mcp.json"), "utf-8")
    );
    expect(mcpJson.mcpServers.slack).toBeDefined();
    expect(mcpJson.mcpServers.github).toBeUndefined();
  });

  it("injects skill references", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        references: ["./references.json"],
      },
      "skills.json": {
        deploy: {
          id: "deploy",
          description: "Deploy skill",
          path: "skills/deploy",
          references: ["git-workflow"],
        },
      },
      "references.json": {
        "git-workflow": {
          id: "git-workflow",
          description: "Git workflow guide",
          file: "references/GIT_WORKFLOW.md",
        },
      },
      "skills/deploy/SKILL.md": "# Deploy",
      "references/GIT_WORKFLOW.md": "# Git Workflow\nBranch naming...",
    });

    const target = createTemp({});

    const result = tryRun(
      `prepare --config ${join(catalog, "air.json")} --target ${target}`
    );
    expect(result.exitCode).toBe(0);

    const refPath = join(
      target,
      ".claude",
      "skills",
      "deploy",
      "references",
      "GIT_WORKFLOW.md"
    );
    expect(existsSync(refPath)).toBe(true);
    expect(readFileSync(refPath, "utf-8")).toContain("Branch naming");
  });

  it("fails gracefully with missing air.json", () => {
    const result = tryRun(
      `prepare --config /nonexistent/air.json --target /tmp`
    );
    expect(result.exitCode).not.toBe(0);
  });

  it("fails gracefully with unknown root", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        roots: ["./roots.json"],
      },
      "roots.json": {},
    });

    const result = tryRun(
      `prepare --config ${join(catalog, "air.json")} --root nonexistent`
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not found");
  });

  it("is idempotent — running prepare twice produces same result", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        skills: ["./skills.json"],
      },
      "mcp.json": {
        github: { type: "stdio", command: "npx", args: ["gh"] },
      },
      "skills.json": {
        "my-skill": {
          id: "my-skill",
          description: "Test",
          path: "skills/my-skill",
        },
      },
      "skills/my-skill/SKILL.md": "# Skill",
    });

    const target = createTemp({});

    // Run prepare twice
    tryRun(
      `prepare --config ${join(catalog, "air.json")} --target ${target}`
    );
    const result = tryRun(
      `prepare --config ${join(catalog, "air.json")} --target ${target}`
    );
    expect(result.exitCode).toBe(0);

    // .mcp.json should still be valid
    const mcpJson = JSON.parse(
      readFileSync(join(target, ".mcp.json"), "utf-8")
    );
    expect(mcpJson.mcpServers.github).toBeDefined();

    // Skill should still exist (second run skips due to local priority)
    expect(
      existsSync(join(target, ".claude", "skills", "my-skill", "SKILL.md"))
    ).toBe(true);
  });
});
