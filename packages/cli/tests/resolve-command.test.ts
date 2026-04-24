import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { resolve, join } from "path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
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
    return { stdout: run(args, env), stderr: "", exitCode: 0 };
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
    `air-resolve-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

describe("resolve command", () => {
  it("prints the merged artifact tree as JSON", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "mcp.json": {
        github: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@mcp/github"],
        },
      },
      "skills.json": {
        "my-skill": {
          description: "Test skill",
          path: "skills/my-skill",
        },
      },
      "skills/my-skill/SKILL.md": "# My Skill",
      "roots.json": {
        default: {
          description: "Default root",
          default_mcp_servers: ["github"],
          default_skills: ["my-skill"],
        },
      },
    });

    const result = tryRun(
      `resolve --json --config ${join(catalog, "air.json")}`
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);

    // Expected top-level keys for ResolvedArtifacts
    expect(output).toHaveProperty("skills");
    expect(output).toHaveProperty("references");
    expect(output).toHaveProperty("mcp");
    expect(output).toHaveProperty("plugins");
    expect(output).toHaveProperty("roots");
    expect(output).toHaveProperty("hooks");

    // Entries keyed by id
    expect(output.mcp.github).toBeDefined();
    expect(output.mcp.github.type).toBe("stdio");
    expect(output.skills["my-skill"]).toBeDefined();
    expect(output.roots.default).toBeDefined();
    expect(output.roots.default.default_mcp_servers).toContain("github");
  });

  it("returns absolute paths on skill entries", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
      },
      "skills.json": {
        "my-skill": {
          description: "Skill",
          path: "skills/my-skill",
        },
      },
      "skills/my-skill/SKILL.md": "# Skill",
    });

    const result = tryRun(
      `resolve --json --config ${join(catalog, "air.json")}`
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    const skillPath = output.skills["my-skill"].path;
    // Core resolves path fields to absolute paths
    expect(skillPath.startsWith("/")).toBe(true);
    expect(skillPath).toContain("skills/my-skill");
  });

  it("applies later-wins override across multiple index files", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./base.json", "./override.json"],
      },
      "base.json": {
        github: { type: "stdio", command: "npx", args: ["base-gh"] },
      },
      "override.json": {
        github: { type: "stdio", command: "npx", args: ["override-gh"] },
      },
    });

    const result = tryRun(
      `resolve --json --config ${join(catalog, "air.json")}`
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    // Later entry should win by id (full replacement)
    expect(output.mcp.github.args).toEqual(["override-gh"]);
  });

  it("respects AIR_CONFIG env var when --config is omitted", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
      },
      "mcp.json": {
        slack: { type: "stdio", command: "npx", args: ["slack-mcp"] },
      },
    });

    const result = tryRun(`resolve --json`, {
      AIR_CONFIG: join(catalog, "air.json"),
    });
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.mcp.slack).toBeDefined();
  });

  it("emits empty maps for unused artifact types", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
      },
      "mcp.json": {
        gh: { type: "stdio", command: "npx", args: ["gh"] },
      },
    });

    const result = tryRun(
      `resolve --json --config ${join(catalog, "air.json")}`
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.skills).toEqual({});
    expect(output.references).toEqual({});
    expect(output.plugins).toEqual({});
    expect(output.roots).toEqual({});
    expect(output.hooks).toEqual({});
  });

  it("fails gracefully when air.json is missing", () => {
    const result = tryRun(`resolve --json --config /nonexistent/air.json`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Error");
  });

  it("loads extension-provided catalog providers and resolves custom URI schemes", () => {
    // Stub extension with a catalog provider for a custom `stub://` scheme.
    // If `resolveFullArtifacts` doesn't load extensions, the URI would fail
    // with "No catalog provider registered for scheme stub://".
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["./stub-provider-ext.js"],
        mcp: ["stub://virtual-servers"],
      },
      "stub-provider-ext.js": `
export default {
  name: "stub-provider-ext",
  provider: {
    scheme: "stub",
    async fileExists() {
      return true;
    },
    async resolve(uri) {
      // Return synthetic MCP server content so we can assert the provider
      // was actually invoked (not just loaded).
      return {
        "provider-resolved-server": {
          type: "stdio",
          command: "echo",
          args: ["from-stub-provider"],
        },
      };
    },
    resolveSourceDir() {
      return "/tmp";
    },
  },
};
`,
    });

    const result = tryRun(
      `resolve --json --config ${join(catalog, "air.json")}`
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.mcp["provider-resolved-server"]).toBeDefined();
    expect(output.mcp["provider-resolved-server"].args).toEqual([
      "from-stub-provider",
    ]);
  });

  it("expands plugins into their constituent artifacts", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        skills: ["./skills.json"],
        plugins: ["./plugins.json"],
      },
      "mcp.json": {
        gh: { type: "stdio", command: "npx", args: ["gh"] },
      },
      "skills.json": {
        deploy: {
          description: "Deploy skill",
          path: "skills/deploy",
        },
      },
      "skills/deploy/SKILL.md": "# Deploy",
      "plugins.json": {
        "my-plugin": {
          description: "A plugin",
          skills: ["deploy"],
          mcp_servers: ["gh"],
        },
      },
    });

    const result = tryRun(
      `resolve --json --config ${join(catalog, "air.json")}`
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.plugins["my-plugin"]).toBeDefined();
    expect(output.plugins["my-plugin"].skills).toContain("deploy");
  });
});
