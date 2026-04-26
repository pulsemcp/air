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

    // Entries keyed by qualified id (@local/<short>)
    expect(output.mcp["@local/github"]).toBeDefined();
    expect(output.mcp["@local/github"].type).toBe("stdio");
    expect(output.skills["@local/my-skill"]).toBeDefined();
    expect(output.roots["@local/default"]).toBeDefined();
    expect(output.roots["@local/default"].default_mcp_servers).toContain(
      "@local/github"
    );
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
    const skillPath = output.skills["@local/my-skill"].path;
    // Core resolves path fields to absolute paths
    expect(skillPath.startsWith("/")).toBe(true);
    expect(skillPath).toContain("skills/my-skill");
  });

  it("hard-fails on duplicate qualified IDs across index files in the same scope", () => {
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
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("@local/github");
  });

  it("supports exclude to drop catalog entries by qualified ID", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        exclude: ["@local/dropped"],
      },
      "mcp.json": {
        kept: { type: "stdio", command: "npx", args: ["kept"] },
        dropped: { type: "stdio", command: "npx", args: ["dropped"] },
      },
    });

    const result = tryRun(
      `resolve --json --config ${join(catalog, "air.json")}`
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.mcp["@local/kept"]).toBeDefined();
    expect(output.mcp["@local/dropped"]).toBeUndefined();
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
    expect(output.mcp["@local/slack"]).toBeDefined();
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
    expect(output.mcp["@local/provider-resolved-server"]).toBeDefined();
    expect(output.mcp["@local/provider-resolved-server"].args).toEqual([
      "from-stub-provider",
    ]);
  });

  describe("--no-scope flag", () => {
    it("rewrites all keys to bare shortnames in a single-scope universe", () => {
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
          deploy: {
            description: "Deploy skill",
            path: "skills/deploy",
          },
        },
        "skills/deploy/SKILL.md": "# Deploy",
        "roots.json": {
          default: {
            description: "Default root",
            default_mcp_servers: ["github"],
            default_skills: ["deploy"],
          },
        },
      });

      const result = tryRun(
        `resolve --no-scope --config ${join(catalog, "air.json")}`
      );
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);

      // Top-level keys are bare shortnames.
      expect(output.mcp["github"]).toBeDefined();
      expect(output.mcp["@local/github"]).toBeUndefined();
      expect(output.skills["deploy"]).toBeDefined();
      expect(output.skills["@local/deploy"]).toBeUndefined();
      expect(output.roots["default"]).toBeDefined();
      expect(output.roots["@local/default"]).toBeUndefined();

      // Reference fields inside entries are bare too.
      expect(output.roots["default"].default_mcp_servers).toEqual(["github"]);
      expect(output.roots["default"].default_skills).toEqual(["deploy"]);
    });

    it("rewrites reference fields across plugins, hooks, and skills", () => {
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
            description: "Deploy",
            path: "skills/deploy",
          },
        },
        "skills/deploy/SKILL.md": "# Deploy",
        "plugins.json": {
          quality: {
            description: "Quality",
            skills: ["deploy"],
            mcp_servers: ["gh"],
          },
        },
      });

      const result = tryRun(
        `resolve --no-scope --config ${join(catalog, "air.json")}`
      );
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.plugins["quality"].skills).toEqual(["deploy"]);
      expect(output.plugins["quality"].mcp_servers).toEqual(["gh"]);
    });

    it("hard-fails on cross-scope shortname collisions with the documented error format", () => {
      // Two scopes contribute the same shortname `github`: @local from
      // ./local-mcp.json and @acme via the stub provider's getScope.
      const catalog = createTemp({
        "air.json": {
          name: "test",
          extensions: ["./stub-provider-ext.js"],
          mcp: ["./local-mcp.json", "stub://acme-mcp"],
        },
        "local-mcp.json": {
          github: { type: "stdio", command: "npx", args: ["local-gh"] },
        },
        "stub-provider-ext.js": `
export default {
  name: "stub-provider-ext",
  provider: {
    scheme: "stub",
    getScope() { return "acme"; },
    async resolve(uri) {
      return {
        github: { type: "stdio", command: "npx", args: ["acme-gh"] },
      };
    },
    resolveSourceDir() { return "/tmp"; },
  },
};
`,
      });

      const result = tryRun(
        `resolve --no-scope --config ${join(catalog, "air.json")}`
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(
        "--no-scope requires unique shortnames across all scopes"
      );
      expect(result.stderr).toContain(
        'shortname "github" maps to multiple qualified IDs'
      );
      expect(result.stderr).toContain("- @local/github");
      expect(result.stderr).toContain("- @acme/github");
      expect(result.stderr).toContain("air.json#exclude");
    });

    it("default behavior (no flag) is unchanged — keys remain qualified", () => {
      const catalog = createTemp({
        "air.json": {
          name: "test",
          mcp: ["./mcp.json"],
        },
        "mcp.json": {
          github: { type: "stdio", command: "npx", args: ["gh"] },
        },
      });

      const result = tryRun(
        `resolve --config ${join(catalog, "air.json")}`
      );
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.mcp["@local/github"]).toBeDefined();
      expect(output.mcp["github"]).toBeUndefined();
    });
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
    expect(output.plugins["@local/my-plugin"]).toBeDefined();
    expect(output.plugins["@local/my-plugin"].skills).toContain("@local/deploy");
  });
});
