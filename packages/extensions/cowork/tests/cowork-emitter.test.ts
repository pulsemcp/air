import { describe, it, expect, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  chmodSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CoworkEmitter } from "../src/cowork-emitter.js";
import type {
  ResolvedArtifacts,
  McpServerEntry,
  SkillEntry,
  HookEntry,
  PluginEntry,
  ReferenceEntry,
} from "@pulsemcp/air-core";

function emptyArtifacts(): ResolvedArtifacts {
  return {
    skills: {},
    references: {},
    mcp: {},
    plugins: {},
    roots: {},
    hooks: {},
  };
}

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `cowork-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function createSkillOnDisk(baseDir: string, skillId: string): string {
  const skillDir = join(baseDir, skillId);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${skillId}\n---\nSkill content for ${skillId}\n`
  );
  return skillDir;
}

function createHookOnDisk(
  baseDir: string,
  hookId: string,
  hookJson: Record<string, unknown>
): string {
  const hookDir = join(baseDir, hookId);
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(join(hookDir, "HOOK.json"), JSON.stringify(hookJson));
  return hookDir;
}

function createReferenceOnDisk(baseDir: string, filename: string): string {
  const refPath = join(baseDir, filename);
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(refPath, `Reference content for ${filename}\n`);
  return refPath;
}

describe("CoworkEmitter", () => {
  const emitter = new CoworkEmitter();

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  describe("metadata", () => {
    it("has correct name and displayName", () => {
      expect(emitter.name).toBe("cowork");
      expect(emitter.displayName).toBe("Claude Co-work");
    });
  });

  describe("buildManifest", () => {
    it("builds manifest with required fields", () => {
      const plugin: PluginEntry = {
        description: "A test plugin",
      };
      const manifest = emitter.buildManifest("test-plugin", plugin);
      expect(manifest).toEqual({
        name: "test-plugin",
        description: "A test plugin",
      });
    });

    it("includes optional metadata fields when present", () => {
      const plugin: PluginEntry = {
        title: "Test Plugin",
        description: "A test plugin",
        version: "1.2.3",
        author: { name: "Test Author", email: "test@example.com" },
        homepage: "https://example.com",
        repository: "https://github.com/test/repo",
        license: "MIT",
        keywords: ["test", "plugin"],
      };
      const manifest = emitter.buildManifest("test-plugin", plugin);
      expect(manifest).toEqual({
        name: "test-plugin",
        description: "A test plugin",
        version: "1.2.3",
        author: { name: "Test Author", email: "test@example.com" },
        homepage: "https://example.com",
        repository: "https://github.com/test/repo",
        license: "MIT",
        keywords: ["test", "plugin"],
      });
    });

    it("omits undefined optional fields", () => {
      const plugin: PluginEntry = {
        description: "Minimal plugin",
        version: "1.0.0",
      };
      const manifest = emitter.buildManifest("minimal", plugin);
      expect(manifest).toEqual({
        name: "minimal",
        description: "Minimal plugin",
        version: "1.0.0",
      });
      expect(manifest.author).toBeUndefined();
      expect(manifest.homepage).toBeUndefined();
    });
  });

  describe("buildMcpConfig", () => {
    it("translates stdio servers", () => {
      const artifacts = emptyArtifacts();
      artifacts.mcp = {
        github: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@mcp/github@1.0.0"],
          env: { TOKEN: "${GITHUB_TOKEN}" },
        },
      };

      const result = emitter.buildMcpConfig(artifacts, ["github"]);
      expect(result).toEqual({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "@mcp/github@1.0.0"],
            env: { TOKEN: "${GITHUB_TOKEN}" },
          },
        },
      });
    });

    it("translates streamable-http to http", () => {
      const artifacts = emptyArtifacts();
      artifacts.mcp = {
        remote: {
          type: "streamable-http",
          url: "https://mcp.example.com/api",
          headers: { Authorization: "Bearer ${TOKEN}" },
        },
      };

      const result = emitter.buildMcpConfig(artifacts, ["remote"]);
      expect(result.mcpServers.remote).toEqual({
        type: "http",
        url: "https://mcp.example.com/api",
        headers: { Authorization: "Bearer ${TOKEN}" },
      });
    });

    it("preserves sse type", () => {
      const artifacts = emptyArtifacts();
      artifacts.mcp = {
        events: { type: "sse", url: "https://mcp.example.com/sse" },
      };

      const result = emitter.buildMcpConfig(artifacts, ["events"]);
      expect(result.mcpServers.events.type).toBe("sse");
    });

    it("translates OAuth with callbackPort extraction", () => {
      const artifacts = emptyArtifacts();
      artifacts.mcp = {
        oauth: {
          type: "streamable-http",
          url: "https://mcp.example.com",
          oauth: {
            clientId: "abc123",
            scopes: ["read", "write"],
            redirectUri: "http://localhost:3456/callback",
          },
        },
      };

      const result = emitter.buildMcpConfig(artifacts, ["oauth"]);
      expect(result.mcpServers.oauth.oauth).toEqual({
        clientId: "abc123",
        callbackPort: 3456,
        scopes: ["read", "write"],
      });
    });

    it("passes authServerMetadataUrl and clientSecret through oauth translation", () => {
      const artifacts = emptyArtifacts();
      artifacts.mcp = {
        bigquery: {
          type: "streamable-http",
          url: "https://bigquery.googleapis.com/mcp",
          oauth: {
            clientId: "my-client",
            clientSecret: "resolved-secret-value",
            authServerMetadataUrl:
              "https://accounts.google.com/.well-known/openid-configuration",
          },
        },
      };

      const result = emitter.buildMcpConfig(artifacts, ["bigquery"]);
      expect(result.mcpServers.bigquery.oauth).toEqual({
        clientId: "my-client",
        clientSecret: "resolved-secret-value",
        authServerMetadataUrl:
          "https://accounts.google.com/.well-known/openid-configuration",
      });
    });

    it("skips unknown server IDs", () => {
      const artifacts = emptyArtifacts();
      artifacts.mcp = {
        exists: { type: "stdio", command: "test" },
      };

      const result = emitter.buildMcpConfig(artifacts, [
        "exists",
        "does-not-exist",
      ]);
      expect(Object.keys(result.mcpServers)).toEqual(["exists"]);
    });
  });

  describe("buildHookCommand", () => {
    it("rewrites relative paths to use CLAUDE_PLUGIN_ROOT", () => {
      const cmd = emitter.buildHookCommand("my-hook", "./notify.sh");
      expect(cmd).toBe("${CLAUDE_PLUGIN_ROOT}/scripts/my-hook/notify.sh");
    });

    it("leaves absolute/non-relative commands unchanged", () => {
      const cmd = emitter.buildHookCommand("my-hook", "npx", [
        "lint-staged",
      ]);
      expect(cmd).toBe("npx lint-staged");
    });

    it("escapes shell metacharacters in args", () => {
      const cmd = emitter.buildHookCommand("my-hook", "echo", [
        "hello world",
        "safe",
      ]);
      expect(cmd).toBe("echo 'hello world' safe");
    });
  });

  describe("buildHooksConfig", () => {
    it("translates AIR hooks to Co-work inline format", () => {
      const sourceDir = makeTempDir();
      const hookDir = createHookOnDisk(sourceDir, "notify", {
        event: "session_start",
        command: "./notify.sh",
        timeout_seconds: 10,
        matcher: "",
      });

      const artifacts = emptyArtifacts();
      artifacts.hooks = {
        notify: { description: "Notify hook", path: hookDir },
      };

      const pluginDir = makeTempDir();
      const result = emitter.buildHooksConfig(artifacts, ["notify"], pluginDir);

      expect(result.hooks).toHaveProperty("SessionStart");
      expect(result.hooks.SessionStart).toHaveLength(1);

      const group = result.hooks.SessionStart[0] as any;
      expect(group.matcher).toBe("");
      expect(group.hooks).toHaveLength(1);
      expect(group.hooks[0].type).toBe("command");
      expect(group.hooks[0].command).toBe(
        "${CLAUDE_PLUGIN_ROOT}/scripts/notify/notify.sh"
      );
      expect(group.hooks[0].timeout).toBe(10);
    });

    it("maps multiple AIR events to Co-work events", () => {
      const sourceDir = makeTempDir();
      const hookDir1 = createHookOnDisk(sourceDir, "start", {
        event: "session_start",
        command: "echo",
        args: ["started"],
      });
      const hookDir2 = createHookOnDisk(sourceDir, "end", {
        event: "session_end",
        command: "echo",
        args: ["ended"],
      });

      const artifacts = emptyArtifacts();
      artifacts.hooks = {
        start: { description: "Start hook", path: hookDir1 },
        end: { description: "End hook", path: hookDir2 },
      };

      const pluginDir = makeTempDir();
      const result = emitter.buildHooksConfig(
        artifacts,
        ["start", "end"],
        pluginDir
      );

      expect(result.hooks).toHaveProperty("SessionStart");
      expect(result.hooks).toHaveProperty("SessionEnd");
    });

    it("skips hooks with unmapped AIR events", () => {
      const sourceDir = makeTempDir();
      const hookDir = createHookOnDisk(sourceDir, "pre-commit", {
        event: "pre_commit",
        command: "npx",
        args: ["lint-staged"],
      });

      const artifacts = emptyArtifacts();
      artifacts.hooks = {
        "pre-commit": { description: "Pre-commit", path: hookDir },
      };

      const pluginDir = makeTempDir();
      const result = emitter.buildHooksConfig(
        artifacts,
        ["pre-commit"],
        pluginDir
      );

      expect(Object.keys(result.hooks)).toHaveLength(0);
    });

    it("skips hooks with malformed HOOK.json", () => {
      const sourceDir = makeTempDir();
      const hookDir = join(sourceDir, "broken");
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(join(hookDir, "HOOK.json"), "not valid json {{{");

      const artifacts = emptyArtifacts();
      artifacts.hooks = {
        broken: { description: "Broken hook", path: hookDir },
      };

      const pluginDir = makeTempDir();
      const result = emitter.buildHooksConfig(
        artifacts,
        ["broken"],
        pluginDir
      );

      expect(Object.keys(result.hooks)).toHaveLength(0);
    });
  });

  describe("buildPlugin", () => {
    it("writes plugin manifest to .claude-plugin/plugin.json", () => {
      const outputDir = makeTempDir();
      const pluginDir = join(outputDir, "my-plugin");

      const artifacts = emptyArtifacts();
      artifacts.plugins = {
        "my-plugin": {
          description: "Test plugin",
          version: "1.0.0",
        },
      };

      emitter.buildPlugin(
        artifacts,
        "my-plugin",
        artifacts.plugins["my-plugin"],
        pluginDir
      );

      const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");
      expect(existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.name).toBe("my-plugin");
      expect(manifest.description).toBe("Test plugin");
      expect(manifest.version).toBe("1.0.0");
    });

    it("copies skills into skills/ directory", () => {
      const sourceDir = makeTempDir();
      const skillPath = createSkillOnDisk(sourceDir, "lint-fix");

      const outputDir = makeTempDir();
      const pluginDir = join(outputDir, "code-quality");

      const artifacts = emptyArtifacts();
      artifacts.skills = {
        "lint-fix": {
          description: "Lint fixer",
          path: skillPath,
        },
      };
      artifacts.plugins = {
        "code-quality": {
          description: "Code quality",
          skills: ["lint-fix"],
        },
      };

      emitter.buildPlugin(
        artifacts,
        "code-quality",
        artifacts.plugins["code-quality"],
        pluginDir
      );

      const skillMd = join(pluginDir, "skills", "lint-fix", "SKILL.md");
      expect(existsSync(skillMd)).toBe(true);
      expect(readFileSync(skillMd, "utf-8")).toContain("lint-fix");
    });

    it("copies skill references into skills/{id}/references/", () => {
      const sourceDir = makeTempDir();
      const skillPath = createSkillOnDisk(sourceDir, "deploy");
      const refPath = createReferenceOnDisk(
        join(sourceDir, "refs"),
        "deploy-guide.md"
      );

      const outputDir = makeTempDir();
      const pluginDir = join(outputDir, "deploy-plugin");

      const artifacts = emptyArtifacts();
      artifacts.skills = {
        deploy: {
          description: "Deploy skill",
          path: skillPath,
          references: ["deploy-guide"],
        },
      };
      artifacts.references = {
        "deploy-guide": {
          description: "Deploy guide",
          path: refPath,
        },
      };
      artifacts.plugins = {
        "deploy-plugin": {
          description: "Deploy plugin",
          skills: ["deploy"],
        },
      };

      emitter.buildPlugin(
        artifacts,
        "deploy-plugin",
        artifacts.plugins["deploy-plugin"],
        pluginDir
      );

      const refFile = join(
        pluginDir,
        "skills",
        "deploy",
        "references",
        "deploy-guide.md"
      );
      expect(existsSync(refFile)).toBe(true);
    });

    it("writes hooks/hooks.json in Co-work format", () => {
      const sourceDir = makeTempDir();
      const hookDir = createHookOnDisk(sourceDir, "notify", {
        event: "session_start",
        command: "./notify.sh",
        timeout_seconds: 10,
      });

      const outputDir = makeTempDir();
      const pluginDir = join(outputDir, "notifier");

      const artifacts = emptyArtifacts();
      artifacts.hooks = {
        notify: { description: "Notify", path: hookDir },
      };
      artifacts.plugins = {
        notifier: {
          description: "Notification plugin",
          hooks: ["notify"],
        },
      };

      emitter.buildPlugin(
        artifacts,
        "notifier",
        artifacts.plugins["notifier"],
        pluginDir
      );

      const hooksJsonPath = join(pluginDir, "hooks", "hooks.json");
      expect(existsSync(hooksJsonPath)).toBe(true);

      const hooksConfig = JSON.parse(readFileSync(hooksJsonPath, "utf-8"));
      expect(hooksConfig.hooks).toHaveProperty("SessionStart");
    });

    it("copies hook scripts into scripts/{hookId}/", () => {
      const sourceDir = makeTempDir();
      const hookDir = join(sourceDir, "notify");
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(
        join(hookDir, "HOOK.json"),
        JSON.stringify({ event: "session_start", command: "./notify.sh" })
      );
      writeFileSync(join(hookDir, "notify.sh"), "#!/bin/bash\necho hello");

      const outputDir = makeTempDir();
      const pluginDir = join(outputDir, "notifier");

      const artifacts = emptyArtifacts();
      artifacts.hooks = {
        notify: { description: "Notify", path: hookDir },
      };
      artifacts.plugins = {
        notifier: {
          description: "Notification plugin",
          hooks: ["notify"],
        },
      };

      emitter.buildPlugin(
        artifacts,
        "notifier",
        artifacts.plugins["notifier"],
        pluginDir
      );

      const scriptPath = join(pluginDir, "scripts", "notify", "notify.sh");
      expect(existsSync(scriptPath)).toBe(true);
      expect(readFileSync(scriptPath, "utf-8")).toContain("echo hello");
    });

    it("does not copy HOOK.json to scripts directory", () => {
      const sourceDir = makeTempDir();
      const hookDir = join(sourceDir, "my-hook");
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(
        join(hookDir, "HOOK.json"),
        JSON.stringify({ event: "session_start", command: "echo" })
      );
      writeFileSync(join(hookDir, "run.sh"), "#!/bin/bash\necho run");

      const outputDir = makeTempDir();
      const pluginDir = join(outputDir, "test");

      const artifacts = emptyArtifacts();
      artifacts.hooks = {
        "my-hook": { description: "Test hook", path: hookDir },
      };
      artifacts.plugins = {
        test: { description: "Test", hooks: ["my-hook"] },
      };

      emitter.buildPlugin(
        artifacts,
        "test",
        artifacts.plugins["test"],
        pluginDir
      );

      const scriptsDir = join(pluginDir, "scripts", "my-hook");
      expect(existsSync(join(scriptsDir, "run.sh"))).toBe(true);
      expect(existsSync(join(scriptsDir, "HOOK.json"))).toBe(false);
    });

    it("writes .mcp.json with translated servers", () => {
      const outputDir = makeTempDir();
      const pluginDir = join(outputDir, "mcp-plugin");

      const artifacts = emptyArtifacts();
      artifacts.mcp = {
        db: {
          type: "stdio",
          command: "npx",
          args: ["@mcp/db"],
          env: { DB_URL: "${DATABASE_URL}" },
        },
      };
      artifacts.plugins = {
        "mcp-plugin": {
          description: "MCP plugin",
          mcp_servers: ["db"],
        },
      };

      emitter.buildPlugin(
        artifacts,
        "mcp-plugin",
        artifacts.plugins["mcp-plugin"],
        pluginDir
      );

      const mcpPath = join(pluginDir, ".mcp.json");
      expect(existsSync(mcpPath)).toBe(true);

      const mcpConfig = JSON.parse(readFileSync(mcpPath, "utf-8"));
      expect(mcpConfig.mcpServers.db.command).toBe("npx");
      expect(mcpConfig.mcpServers.db.env.DB_URL).toBe("${DATABASE_URL}");
    });

    it("returns correct counts", () => {
      const sourceDir = makeTempDir();
      const skillPath = createSkillOnDisk(sourceDir, "skill-1");
      const hookDir = createHookOnDisk(sourceDir, "hook-1", {
        event: "session_start",
        command: "echo",
      });

      const outputDir = makeTempDir();
      const pluginDir = join(outputDir, "counted");

      const artifacts = emptyArtifacts();
      artifacts.skills = {
        "skill-1": { description: "Skill 1", path: skillPath },
      };
      artifacts.hooks = {
        "hook-1": { description: "Hook 1", path: hookDir },
      };
      artifacts.mcp = {
        server1: { type: "stdio", command: "test" },
        server2: { type: "stdio", command: "test2" },
      };
      artifacts.plugins = {
        counted: {
          description: "Counted",
          skills: ["skill-1"],
          hooks: ["hook-1"],
          mcp_servers: ["server1", "server2"],
        },
      };

      const result = emitter.buildPlugin(
        artifacts,
        "counted",
        artifacts.plugins["counted"],
        pluginDir
      );

      expect(result.id).toBe("counted");
      expect(result.skillCount).toBe(1);
      expect(result.hookCount).toBe(1);
      expect(result.mcpServerCount).toBe(2);
    });

    it("handles plugin with no artifacts gracefully", () => {
      const outputDir = makeTempDir();
      const pluginDir = join(outputDir, "empty");

      const artifacts = emptyArtifacts();
      artifacts.plugins = {
        empty: { description: "Empty plugin" },
      };

      const result = emitter.buildPlugin(
        artifacts,
        "empty",
        artifacts.plugins["empty"],
        pluginDir
      );

      expect(result.skillCount).toBe(0);
      expect(result.hookCount).toBe(0);
      expect(result.mcpServerCount).toBe(0);
      expect(existsSync(join(pluginDir, ".claude-plugin", "plugin.json"))).toBe(
        true
      );
      expect(existsSync(join(pluginDir, "hooks"))).toBe(false);
      expect(existsSync(join(pluginDir, ".mcp.json"))).toBe(false);
    });
  });

  describe("buildMarketplace", () => {
    it("builds marketplace directory with multiple plugins", async () => {
      const sourceDir = makeTempDir();
      const skill1 = createSkillOnDisk(sourceDir, "lint");
      const skill2 = createSkillOnDisk(sourceDir, "deploy");

      const outputDir = join(makeTempDir(), "marketplace");

      const artifacts = emptyArtifacts();
      artifacts.skills = {
        lint: { description: "Lint", path: skill1 },
        deploy: { description: "Deploy", path: skill2 },
      };
      artifacts.plugins = {
        "code-quality": {
          title: "Code Quality",
          description: "Code quality suite",
          version: "1.0.0",
          skills: ["lint"],
        },
        "deploy-toolkit": {
          title: "Deploy Toolkit",
          description: "Deployment tools",
          version: "2.0.0",
          skills: ["deploy"],
          keywords: ["deploy", "ci"],
        },
      };

      const result = await emitter.buildMarketplace(
        artifacts,
        ["code-quality", "deploy-toolkit"],
        outputDir
      );

      expect(result.plugins).toHaveLength(2);
      expect(result.indexPath).toBe(
        join(outputDir, ".claude-plugin", "marketplace.json")
      );

      // Check marketplace.json
      const index = JSON.parse(readFileSync(result.indexPath, "utf-8"));
      expect(index.name).toBe("air-marketplace");
      expect(index.owner).toEqual({ name: "AIR" });
      expect(index.metadata.description).toBe(
        "Plugin marketplace generated from AIR configuration"
      );
      expect(index.plugins).toHaveLength(2);
      expect(index.plugins[0].name).toBe("code-quality");
      expect(index.plugins[0].source).toBe("./code-quality");
      expect(index.plugins[0].version).toBe("1.0.0");
      expect(index.plugins[1].name).toBe("deploy-toolkit");
      expect(index.plugins[1].keywords).toEqual(["deploy", "ci"]);

      // Check plugin directories exist
      expect(
        existsSync(join(outputDir, "code-quality", ".claude-plugin", "plugin.json"))
      ).toBe(true);
      expect(
        existsSync(join(outputDir, "deploy-toolkit", ".claude-plugin", "plugin.json"))
      ).toBe(true);

      // Check skills were copied
      expect(
        existsSync(join(outputDir, "code-quality", "skills", "lint", "SKILL.md"))
      ).toBe(true);
      expect(
        existsSync(join(outputDir, "deploy-toolkit", "skills", "deploy", "SKILL.md"))
      ).toBe(true);
    });

    it("supports custom marketplace name and description", async () => {
      const outputDir = join(makeTempDir(), "marketplace");

      const artifacts = emptyArtifacts();
      artifacts.plugins = {
        minimal: { description: "Minimal" },
      };

      await emitter.buildMarketplace(artifacts, ["minimal"], outputDir, {
        marketplaceName: "acme-plugins",
        marketplaceDescription: "Acme Corp internal plugins",
        marketplaceOwner: { name: "Acme Corp", email: "dev@acme.com" },
      });

      const index = JSON.parse(
        readFileSync(
          join(outputDir, ".claude-plugin", "marketplace.json"),
          "utf-8"
        )
      );
      expect(index.name).toBe("acme-plugins");
      expect(index.owner).toEqual({
        name: "Acme Corp",
        email: "dev@acme.com",
      });
      expect(index.metadata.description).toBe("Acme Corp internal plugins");
    });

    it("throws on unknown plugin IDs", async () => {
      const outputDir = join(makeTempDir(), "marketplace");
      const artifacts = emptyArtifacts();
      artifacts.plugins = {
        exists: { description: "Exists" },
      };

      await expect(
        emitter.buildMarketplace(
          artifacts,
          ["exists", "does-not-exist"],
          outputDir
        )
      ).rejects.toThrow("Unknown plugin ID(s): does-not-exist");
    });

    it("produces a complete plugin with skills, hooks, and MCP servers", async () => {
      const sourceDir = makeTempDir();
      const skillPath = createSkillOnDisk(sourceDir, "review");
      const hookDir = join(sourceDir, "pre-review");
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(
        join(hookDir, "HOOK.json"),
        JSON.stringify({
          event: "pre_tool_call",
          command: "./check.sh",
          matcher: "Write|Edit",
          timeout_seconds: 5,
        })
      );
      writeFileSync(join(hookDir, "check.sh"), "#!/bin/bash\nexit 0");

      const outputDir = join(makeTempDir(), "marketplace");

      const artifacts = emptyArtifacts();
      artifacts.skills = {
        review: { description: "Code review", path: skillPath },
      };
      artifacts.hooks = {
        "pre-review": { description: "Pre-review check", path: hookDir },
      };
      artifacts.mcp = {
        "lint-server": {
          type: "stdio",
          command: "npx",
          args: ["@mcp/lint"],
        },
      };
      artifacts.plugins = {
        "full-suite": {
          description: "Full review suite",
          version: "3.0.0",
          skills: ["review"],
          hooks: ["pre-review"],
          mcp_servers: ["lint-server"],
        },
      };

      const result = await emitter.buildMarketplace(
        artifacts,
        ["full-suite"],
        outputDir
      );

      const pluginDir = join(outputDir, "full-suite");

      // Manifest
      const manifest = JSON.parse(
        readFileSync(
          join(pluginDir, ".claude-plugin", "plugin.json"),
          "utf-8"
        )
      );
      expect(manifest.name).toBe("full-suite");
      expect(manifest.version).toBe("3.0.0");

      // Skill
      expect(
        existsSync(join(pluginDir, "skills", "review", "SKILL.md"))
      ).toBe(true);

      // Hooks (inline format)
      const hooks = JSON.parse(
        readFileSync(join(pluginDir, "hooks", "hooks.json"), "utf-8")
      );
      expect(hooks.hooks.PreToolUse).toBeDefined();
      const group = hooks.hooks.PreToolUse[0] as any;
      expect(group.matcher).toBe("Write|Edit");
      expect(group.hooks[0].command).toBe(
        "${CLAUDE_PLUGIN_ROOT}/scripts/pre-review/check.sh"
      );
      expect(group.hooks[0].timeout).toBe(5);

      // Hook scripts
      expect(
        existsSync(join(pluginDir, "scripts", "pre-review", "check.sh"))
      ).toBe(true);

      // MCP config
      const mcp = JSON.parse(
        readFileSync(join(pluginDir, ".mcp.json"), "utf-8")
      );
      expect(mcp.mcpServers["lint-server"].command).toBe("npx");

      // Counts
      expect(result.plugins[0].skillCount).toBe(1);
      expect(result.plugins[0].hookCount).toBe(1);
      expect(result.plugins[0].mcpServerCount).toBe(1);
    });
  });
});
