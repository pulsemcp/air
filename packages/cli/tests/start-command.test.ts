import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";

const CLI = resolve(__dirname, "../src/index.ts");

const tryRun = (args: string, env?: Record<string, string>) => {
  try {
    const stdout = execSync(`npx tsx ${CLI} ${args}`, {
      encoding: "utf-8",
      cwd: resolve(__dirname, "../../.."),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() || "",
      stderr: err.stderr?.toString() || "",
      exitCode: err.status ?? 1,
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
    `air-start-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

// These tests use --dry-run so we don't actually spawn the agent. Dry run
// respects the CLI artifact flags, which is what we want to verify.
describe("start command — CLI artifact selection flags", () => {
  it("--skills adds on top of root defaults (union)", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        "skill-a": { description: "Skill A", path: "skills/skill-a" },
        "skill-b": { description: "Skill B", path: "skills/skill-b" },
        "skill-c": { description: "Skill C", path: "skills/skill-c" },
      },
      "skills/skill-a/SKILL.md": "# A",
      "skills/skill-b/SKILL.md": "# B",
      "skills/skill-c/SKILL.md": "# C",
      "roots.json": {
        myroot: {
          description: "Test root",
          default_skills: ["skill-a", "skill-b"],
        },
      },
    });

    const result = tryRun(
      `start claude --root myroot --dry-run --skills skill-c`,
      { AIR_CONFIG: resolve(catalog, "air.json") }
    );

    expect(result.exitCode).toBe(0);
    // All three: defaults (a, b) + added (c)
    expect(result.stdout).toContain("skill-a");
    expect(result.stdout).toContain("skill-b");
    expect(result.stdout).toContain("skill-c");
    expect(result.stdout).toContain("Skills (3)");
  });

  it("--without-skills removes specific skills from root defaults", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        "skill-a": { description: "Skill A", path: "skills/skill-a" },
        "skill-b": { description: "Skill B", path: "skills/skill-b" },
        "skill-c": { description: "Skill C", path: "skills/skill-c" },
      },
      "skills/skill-a/SKILL.md": "# A",
      "skills/skill-b/SKILL.md": "# B",
      "skills/skill-c/SKILL.md": "# C",
      "roots.json": {
        myroot: {
          description: "Test root",
          default_skills: ["skill-a", "skill-b", "skill-c"],
        },
      },
    });

    const result = tryRun(
      `start claude --root myroot --dry-run --without-skills skill-b`,
      { AIR_CONFIG: resolve(catalog, "air.json") }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("skill-a");
    expect(result.stdout).toContain("skill-c");
    expect(result.stdout).toContain("Skills (2)");
    // skill-b removed — verify it does not appear as a selected skill bullet
    expect(result.stdout).not.toMatch(/\u2022 skill-b\b/);
  });

  it("--without-defaults drops all root defaults", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        "skill-a": { description: "Skill A", path: "skills/skill-a" },
      },
      "skills/skill-a/SKILL.md": "# A",
      "mcp.json": {
        github: { type: "stdio", command: "npx", args: ["gh"] },
      },
      "roots.json": {
        myroot: {
          description: "Test",
          default_skills: ["skill-a"],
          default_mcp_servers: ["github"],
        },
      },
    });

    const result = tryRun(
      `start claude --root myroot --dry-run --without-defaults`,
      { AIR_CONFIG: resolve(catalog, "air.json") }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Skills (0)");
    expect(result.stdout).toContain("MCP Servers (0)");
    expect(result.stdout).not.toMatch(/\u2022 skill-a\b/);
    expect(result.stdout).not.toMatch(/\u2022 github\b/);
  });

  it("--without-defaults combined with --skills activates only the added skill", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        "skill-a": { description: "Skill A", path: "skills/skill-a" },
        "skill-b": { description: "Skill B", path: "skills/skill-b" },
      },
      "skills/skill-a/SKILL.md": "# A",
      "skills/skill-b/SKILL.md": "# B",
      "roots.json": {
        myroot: {
          description: "Test",
          default_skills: ["skill-a"],
        },
      },
    });

    const result = tryRun(
      `start claude --root myroot --dry-run --without-defaults --skills skill-b`,
      { AIR_CONFIG: resolve(catalog, "air.json") }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Skills (1)");
    expect(result.stdout).toContain("skill-b");
    expect(result.stdout).not.toMatch(/\u2022 skill-a\b/);
  });

  it("unspecified categories are unaffected by flags for other categories", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        "skill-a": { description: "Skill A", path: "skills/skill-a" },
        "skill-b": { description: "Skill B", path: "skills/skill-b" },
      },
      "skills/skill-a/SKILL.md": "# A",
      "skills/skill-b/SKILL.md": "# B",
      "mcp.json": {
        github: { type: "stdio", command: "npx", args: ["gh"] },
      },
      "roots.json": {
        myroot: {
          description: "Test",
          default_skills: ["skill-a"],
          default_mcp_servers: ["github"],
        },
      },
    });

    const result = tryRun(
      `start claude --root myroot --dry-run --skills skill-b`,
      { AIR_CONFIG: resolve(catalog, "air.json") }
    );

    expect(result.exitCode).toBe(0);
    // Skills: default skill-a plus added skill-b
    expect(result.stdout).toContain("Skills (2)");
    expect(result.stdout).toContain("skill-a");
    expect(result.stdout).toContain("skill-b");
    // MCP untouched: still uses root default
    expect(result.stdout).toContain("github");
  });

  it("parses comma-separated list with surrounding whitespace", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        "skill-a": { description: "Skill A", path: "skills/skill-a" },
        "skill-b": { description: "Skill B", path: "skills/skill-b" },
      },
      "skills/skill-a/SKILL.md": "# A",
      "skills/skill-b/SKILL.md": "# B",
      "roots.json": {
        myroot: { description: "Test", default_skills: [] },
      },
    });

    const result = tryRun(
      `start claude --root myroot --dry-run --skills "skill-a , skill-b"`,
      { AIR_CONFIG: resolve(catalog, "air.json") }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("skill-a");
    expect(result.stdout).toContain("skill-b");
    expect(result.stdout).toContain("Skills (2)");
  });

  it("supports --without-skills and --without-mcp-servers together", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        "skill-a": { description: "Skill A", path: "skills/skill-a" },
        "skill-b": { description: "Skill B", path: "skills/skill-b" },
      },
      "skills/skill-a/SKILL.md": "# A",
      "skills/skill-b/SKILL.md": "# B",
      "mcp.json": {
        github: { type: "stdio", command: "npx", args: ["gh"] },
        slack: { type: "stdio", command: "npx", args: ["slack"] },
      },
      "roots.json": {
        myroot: {
          description: "Test",
          default_skills: ["skill-a", "skill-b"],
          default_mcp_servers: ["github", "slack"],
        },
      },
    });

    const result = tryRun(
      `start claude --root myroot --dry-run --without-skills skill-a --without-mcp-servers slack`,
      { AIR_CONFIG: resolve(catalog, "air.json") }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Skills (1)");
    expect(result.stdout).toContain("skill-b");
    expect(result.stdout).not.toMatch(/\u2022 skill-a\b/);
    expect(result.stdout).toContain("MCP Servers (1)");
    expect(result.stdout).toContain("github");
    expect(result.stdout).not.toMatch(/\u2022 slack\b/);
  });

  it("supports --hooks and --plugins adds", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        hooks: ["./hooks.json"],
        plugins: ["./plugins.json"],
        roots: ["./roots.json"],
      },
      "hooks.json": {
        "hook-a": {
          description: "Hook A",
          path: "hooks/hook-a",
        },
        "hook-b": {
          description: "Hook B",
          path: "hooks/hook-b",
        },
      },
      "hooks/hook-a/HOOK.json": {
        events: [
          { event: "PreToolUse", matcher: ".*", command: "echo a" },
        ],
      },
      "hooks/hook-b/HOOK.json": {
        events: [
          { event: "PreToolUse", matcher: ".*", command: "echo b" },
        ],
      },
      "plugins.json": {
        "plugin-a": {
          description: "Plugin A",
          version: "1.0.0",
          author: { name: "Test" },
        },
        "plugin-b": {
          description: "Plugin B",
          version: "1.0.0",
          author: { name: "Test" },
        },
      },
      "roots.json": {
        myroot: {
          description: "Test",
          default_hooks: ["hook-a"],
          default_plugins: ["plugin-a"],
        },
      },
    });

    const result = tryRun(
      `start claude --root myroot --dry-run --hooks hook-b --plugins plugin-b`,
      { AIR_CONFIG: resolve(catalog, "air.json") }
    );

    expect(result.exitCode).toBe(0);
    // Hooks: default + added
    expect(result.stdout).toContain("Hooks (2)");
    expect(result.stdout).toContain("hook-a");
    expect(result.stdout).toContain("hook-b");
    // Plugins: default + added
    expect(result.stdout).toContain("Plugins (2)");
    expect(result.stdout).toContain("plugin-a");
    expect(result.stdout).toContain("plugin-b");
  });

  it("combining --skills and --without-skills within the same category works", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        "skill-a": { description: "Skill A", path: "skills/skill-a" },
        "skill-b": { description: "Skill B", path: "skills/skill-b" },
        "skill-c": { description: "Skill C", path: "skills/skill-c" },
      },
      "skills/skill-a/SKILL.md": "# A",
      "skills/skill-b/SKILL.md": "# B",
      "skills/skill-c/SKILL.md": "# C",
      "roots.json": {
        myroot: {
          description: "Test",
          default_skills: ["skill-a", "skill-b"],
        },
      },
    });

    const result = tryRun(
      `start claude --root myroot --dry-run --skills skill-c --without-skills skill-a`,
      { AIR_CONFIG: resolve(catalog, "air.json") }
    );

    expect(result.exitCode).toBe(0);
    // Final: default skill-b + added skill-c; skill-a removed
    expect(result.stdout).toContain("Skills (2)");
    expect(result.stdout).toContain("skill-b");
    expect(result.stdout).toContain("skill-c");
    expect(result.stdout).not.toMatch(/\u2022 skill-a\b/);
  });
});
