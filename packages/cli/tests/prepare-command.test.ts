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
        roots: ["./roots.json"],
      },
      "mcp.json": {
        github: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@mcp/github"],
          env: { TOKEN: "abc" },
        },
      },
      "roots.json": {
        default: { name: "default", description: "Default", default_mcp_servers: ["github"] },
      },
    });

    const target = createTemp({});

    const result = tryRun(
      `prepare claude --config ${join(catalog, "air.json")} --root default --target ${target}`
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
        roots: ["./roots.json"],
      },
      "skills.json": {
        "my-skill": {
          id: "my-skill",
          description: "A test skill",
          path: "skills/my-skill",
        },
      },
      "skills/my-skill/SKILL.md": "# My Skill\nDo the thing.",
      "roots.json": {
        default: { name: "default", description: "Default", default_skills: ["my-skill"] },
      },
    });

    const target = createTemp({});

    const result = tryRun(
      `prepare claude --config ${join(catalog, "air.json")} --root default --target ${target}`
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
        roots: ["./roots.json"],
      },
      "skills.json": {
        "existing-skill": {
          id: "existing-skill",
          description: "Catalog version",
          path: "skills/existing-skill",
        },
      },
      "skills/existing-skill/SKILL.md": "# Catalog Version",
      "roots.json": {
        default: { name: "default", description: "Default", default_skills: ["existing-skill"] },
      },
    });

    const target = createTemp({
      ".claude/skills/existing-skill/SKILL.md": "# Local Version",
    });

    const result = tryRun(
      `prepare claude --config ${join(catalog, "air.json")} --root default --target ${target}`
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
      `prepare claude --config ${join(catalog, "air.json")} --root web-app --target ${target}`
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
      `prepare claude --config ${join(catalog, "air.json")} --root myroot --skills skill-c --target ${target}`
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
      `prepare claude --config ${join(catalog, "air.json")} --root myroot --mcp-servers slack --target ${target}`
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
        roots: ["./roots.json"],
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
      "roots.json": {
        default: { name: "default", description: "Default", default_skills: ["deploy"] },
      },
    });

    const target = createTemp({});

    const result = tryRun(
      `prepare claude --config ${join(catalog, "air.json")} --root default --target ${target}`
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

  it("fails when adapter argument is missing", () => {
    const catalog = createTemp({
      "air.json": { name: "test" },
    });

    const result = tryRun(
      `prepare --config ${join(catalog, "air.json")}`
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("missing required argument");
  });

  it("fails gracefully with missing air.json", () => {
    const result = tryRun(
      `prepare claude --config /nonexistent/air.json --target /tmp`
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
      `prepare claude --config ${join(catalog, "air.json")} --root nonexistent`
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not found");
  });

  it("merges subagent roots' artifacts into parent session", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "mcp.json": {
        "ao-mcp": { type: "stdio", command: "npx", args: ["ao-mcp"] },
        "pg-prod": { type: "stdio", command: "npx", args: ["pg"] },
        "web-search": { type: "stdio", command: "npx", args: ["search"] },
        "proctor": { type: "stdio", command: "npx", args: ["proctor"] },
      },
      "skills.json": {
        "onboard-server": {
          id: "onboard-server",
          description: "Onboard a server",
          path: "skills/onboard-server",
        },
        "validate-config": {
          id: "validate-config",
          description: "Validate config",
          path: "skills/validate-config",
        },
        "find-source": {
          id: "find-source",
          description: "Find canonical source",
          path: "skills/find-source",
        },
      },
      "skills/onboard-server/SKILL.md": "# Onboard Server",
      "skills/validate-config/SKILL.md": "# Validate Config",
      "skills/find-source/SKILL.md": "# Find Source",
      "roots.json": {
        "server-onboarding": {
          name: "server-onboarding",
          display_name: "Server Onboarding",
          description: "Onboard MCP servers to PulseMCP",
          default_mcp_servers: ["ao-mcp"],
          default_skills: ["onboard-server"],
          default_subagent_roots: ["onboarding-configs", "onboarding-research"],
        },
        "onboarding-configs": {
          name: "onboarding-configs",
          display_name: "Onboarding: Configs",
          description: "Prepare server configs",
          default_mcp_servers: ["pg-prod"],
          default_skills: ["validate-config"],
          subdirectory: "subagents/configs",
          user_invocable: false,
        },
        "onboarding-research": {
          name: "onboarding-research",
          display_name: "Onboarding: Research",
          description: "Research server sources",
          default_mcp_servers: ["web-search"],
          default_skills: ["find-source"],
          subdirectory: "subagents/research",
          user_invocable: false,
        },
      },
    });

    const target = createTemp({});

    const result = tryRun(
      `prepare claude --config ${join(catalog, "air.json")} --root server-onboarding --target ${target}`
    );
    expect(result.exitCode).toBe(0);

    // Parent + subagent MCP servers should all be present
    const mcpJson = JSON.parse(
      readFileSync(join(target, ".mcp.json"), "utf-8")
    );
    expect(mcpJson.mcpServers["ao-mcp"]).toBeDefined();
    expect(mcpJson.mcpServers["pg-prod"]).toBeDefined();
    expect(mcpJson.mcpServers["web-search"]).toBeDefined();
    // proctor was not referenced by any root
    expect(mcpJson.mcpServers["proctor"]).toBeUndefined();

    // All skills should be injected
    expect(existsSync(join(target, ".claude", "skills", "onboard-server", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "skills", "validate-config", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "skills", "find-source", "SKILL.md"))).toBe(true);

    // No file written — context is ephemeral
    expect(existsSync(join(target, ".claude", "subagent-roots-context.md"))).toBe(false);

    // Output should include subagentContext
    const output = JSON.parse(result.stdout);
    expect(output.subagentContext).toBeDefined();
    expect(output.subagentContext).toContain("Subagent Root Dependencies");
  });

  it("skips subagent merge with --no-subagent-merge flag", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "mcp.json": {
        "ao-mcp": { type: "stdio", command: "npx", args: ["ao-mcp"] },
        "pg-prod": { type: "stdio", command: "npx", args: ["pg"] },
      },
      "roots.json": {
        "server-onboarding": {
          name: "server-onboarding",
          description: "Onboard servers",
          default_mcp_servers: ["ao-mcp"],
          default_subagent_roots: ["sub-db"],
        },
        "sub-db": {
          name: "sub-db",
          description: "DB subagent",
          default_mcp_servers: ["pg-prod"],
        },
      },
    });

    const target = createTemp({});

    const result = tryRun(
      `prepare claude --config ${join(catalog, "air.json")} --root server-onboarding --no-subagent-merge --target ${target}`
    );
    expect(result.exitCode).toBe(0);

    // Only parent's MCP server should be present (subagent's was not merged)
    const mcpJson = JSON.parse(
      readFileSync(join(target, ".mcp.json"), "utf-8")
    );
    expect(mcpJson.mcpServers["ao-mcp"]).toBeDefined();
    expect(mcpJson.mcpServers["pg-prod"]).toBeUndefined();

    // No subagent context file
    expect(existsSync(join(target, ".claude", "subagent-roots-context.md"))).toBe(false);

    // No subagentContext in output
    const output = JSON.parse(result.stdout);
    expect(output.subagentContext).toBeUndefined();
  });

  it("is idempotent — running prepare twice produces same result", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        skills: ["./skills.json"],
        roots: ["./roots.json"],
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
      "roots.json": {
        default: { name: "default", description: "Default", default_mcp_servers: ["github"], default_skills: ["my-skill"] },
      },
    });

    const target = createTemp({});

    // Run prepare twice
    tryRun(
      `prepare claude --config ${join(catalog, "air.json")} --root default --target ${target}`
    );
    const result = tryRun(
      `prepare claude --config ${join(catalog, "air.json")} --root default --target ${target}`
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
