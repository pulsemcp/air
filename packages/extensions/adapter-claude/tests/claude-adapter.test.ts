import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { ClaudeAdapter } from "../src/claude-adapter.js";
import type {
  ResolvedArtifacts,
  McpServerEntry,
  SkillEntry,
  HookEntry,
  PluginEntry,
  RootEntry,
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

describe("ClaudeAdapter", () => {
  const adapter = new ClaudeAdapter();

  describe("metadata", () => {
    it("has correct name and displayName", () => {
      expect(adapter.name).toBe("claude");
      expect(adapter.displayName).toBe("Claude Code");
    });
  });

  describe("translateMcpServers", () => {
    it("translates stdio servers", () => {
      const servers: Record<string, McpServerEntry> = {
        github: {
          title: "GitHub",
          description: "GitHub MCP",
          type: "stdio",
          command: "npx",
          args: ["-y", "@mcp/github@1.0.0"],
          env: { TOKEN: "${GITHUB_TOKEN}" },
        },
      };

      const result = adapter.translateMcpServers(servers) as any;
      expect(result).toEqual({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "@mcp/github@1.0.0"],
            env: { TOKEN: "${GITHUB_TOKEN}" },
          },
        },
      });
      // stdio servers should NOT include type (Claude Code infers it from command)
      expect(result.mcpServers.github.type).toBeUndefined();
    });

    it("strips title and description from output", () => {
      const servers: Record<string, McpServerEntry> = {
        test: {
          title: "Should be stripped",
          description: "Should also be stripped",
          type: "stdio",
          command: "test",
        },
      };

      const result = adapter.translateMcpServers(servers) as any;
      expect(result.mcpServers.test.title).toBeUndefined();
      expect(result.mcpServers.test.description).toBeUndefined();
    });

    it("translates streamable-http to http for Claude Code compatibility", () => {
      const servers: Record<string, McpServerEntry> = {
        remote: {
          type: "streamable-http",
          url: "https://mcp.example.com/api",
          headers: { Authorization: "Bearer ${TOKEN}" },
        },
      };

      const result = adapter.translateMcpServers(servers) as any;
      expect(result.mcpServers.remote).toEqual({
        type: "http",
        url: "https://mcp.example.com/api",
        headers: { Authorization: "Bearer ${TOKEN}" },
      });
    });

    it("preserves type field for sse servers", () => {
      const servers: Record<string, McpServerEntry> = {
        events: {
          type: "sse",
          url: "https://mcp.example.com/sse",
        },
      };

      const result = adapter.translateMcpServers(servers) as any;
      expect(result.mcpServers.events).toEqual({
        type: "sse",
        url: "https://mcp.example.com/sse",
      });
    });

    it("translates OAuth with callbackPort from redirectUri", () => {
      const servers: Record<string, McpServerEntry> = {
        authed: {
          type: "sse",
          url: "https://mcp.example.com",
          oauth: {
            clientId: "my-client",
            scopes: ["read", "write"],
            redirectUri: "http://localhost:3456/callback",
          },
        },
      };

      const result = adapter.translateMcpServers(servers) as any;
      expect(result.mcpServers.authed.type).toBe("sse");
      expect(result.mcpServers.authed.oauth).toEqual({
        clientId: "my-client",
        scopes: ["read", "write"],
        callbackPort: 3456,
      });
    });
  });

  describe("translatePlugin", () => {
    it("translates plugin format and strips artifact references", () => {
      const plugin: PluginEntry = {
        description: "Linting and formatting tools",
        version: "1.2.0",
        skills: ["lint-fix"],
        mcp_servers: ["eslint-server"],
        hooks: ["lint-pre-commit"],
      };

      const result = adapter.translatePlugin("code-quality", plugin);
      expect(result).toEqual({
        name: "code-quality",
        description: "Linting and formatting tools",
        version: "1.2.0",
      });
      // Artifact references are for CLI deduplication, not passed to agent
      expect(result.skills).toBeUndefined();
      expect(result.mcp_servers).toBeUndefined();
      expect(result.hooks).toBeUndefined();
    });

    it("omits optional fields when not present", () => {
      const plugin: PluginEntry = {
        description: "A minimal plugin",
      };

      const result = adapter.translatePlugin("minimal", plugin);
      expect(result).toEqual({
        name: "minimal",
        description: "A minimal plugin",
      });
      expect(result.version).toBeUndefined();
    });
  });

  describe("generateConfig", () => {
    it("defaults to empty artifacts when no root is specified (opt-in)", () => {
      const artifacts = emptyArtifacts();
      artifacts.skills["a"] = {
        description: "Skill A",
        path: "skills/a",
      };
      artifacts.skills["b"] = {
        description: "Skill B",
        path: "skills/b",
      };
      artifacts.mcp["server"] = {
        type: "stdio",
        command: "test",
      };

      const config = adapter.generateConfig(artifacts);
      expect(config.skillPaths).toEqual([]);
      expect(config.mcpConfig).toEqual({ mcpServers: {} });
    });

    it("filters by root defaults when root is specified", () => {
      const artifacts = emptyArtifacts();
      artifacts.skills["deploy"] = {
        description: "Deploy",
        path: "skills/deploy",
      };
      artifacts.skills["review"] = {
        description: "Review",
        path: "skills/review",
      };
      artifacts.mcp["github"] = {
        type: "stdio",
        command: "gh",
      };
      artifacts.mcp["slack"] = {
        type: "stdio",
        command: "slack",
      };

      const root: RootEntry = {
        description: "Web app",
        default_skills: ["deploy"],
        default_mcp_servers: ["github"],
      };

      const config = adapter.generateConfig(artifacts, root);
      expect(config.skillPaths).toEqual(["skills/deploy"]);

      // Only github should be in MCP config
      const mcpConfig = config.mcpConfig as any;
      expect(mcpConfig.mcpServers["github"]).toBeDefined();
      expect(mcpConfig.mcpServers["slack"]).toBeUndefined();
    });

    it("throws on unknown skill IDs in root defaults", () => {
      const artifacts = emptyArtifacts();
      artifacts.skills["deploy"] = {
        id: "deploy",
        description: "Deploy",
        path: "skills/deploy",
      };
      const root: RootEntry = {
        description: "Test",
        default_skills: ["nonexistent"],
      };

      expect(() => adapter.generateConfig(artifacts, root)).toThrow(
        /Unknown skill ID\(s\): nonexistent\. Available: deploy/
      );
    });

    it("throws on unknown MCP server IDs in root defaults", () => {
      const artifacts = emptyArtifacts();
      artifacts.mcp["github"] = { type: "stdio", command: "gh" };
      const root: RootEntry = {
        name: "test",
        description: "Test",
        default_mcp_servers: ["github", "nonexistent"],
      };

      expect(() => adapter.generateConfig(artifacts, root)).toThrow(
        /Unknown MCP server ID\(s\): nonexistent\. Available: github/
      );
    });
  });

  describe("buildStartCommand", () => {
    it("returns claude command", () => {
      const cmd = adapter.buildStartCommand({
        agent: "claude",
        env: {},
      });
      expect(cmd.command).toBe("claude");
    });
  });

  describe("prepareSession", () => {
    let tempDir: string;
    let airHomeDir: string;
    let originalAirHome: string | undefined;

    function createTempDir(): string {
      tempDir = resolve(
        tmpdir(),
        `air-claude-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      mkdirSync(tempDir, { recursive: true });
      return tempDir;
    }

    beforeEach(() => {
      // Sandbox the per-user AIR home so manifest writes don't pollute ~/.air/
      airHomeDir = resolve(
        tmpdir(),
        `air-home-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      originalAirHome = process.env.AIR_HOME;
      process.env.AIR_HOME = airHomeDir;
    });

    afterEach(() => {
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      if (airHomeDir && existsSync(airHomeDir)) {
        rmSync(airHomeDir, { recursive: true, force: true });
      }
      if (originalAirHome === undefined) {
        delete process.env.AIR_HOME;
      } else {
        process.env.AIR_HOME = originalAirHome;
      }
    });

    it("writes .mcp.json with translated servers", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();
      artifacts.mcp["github"] = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@mcp/github"],
        env: { TOKEN: "literal-value" },
      };

      const root: RootEntry = {
        name: "test",
        description: "Test",
        default_mcp_servers: ["github"],
      };

      const result = await adapter.prepareSession(artifacts, dir, { root });

      const mcpPath = join(dir, ".mcp.json");
      expect(result.configFiles).toContain(mcpPath);
      expect(existsSync(mcpPath)).toBe(true);

      const mcpJson = JSON.parse(readFileSync(mcpPath, "utf-8"));
      expect(mcpJson.mcpServers.github.command).toBe("npx");
      expect(mcpJson.mcpServers.github.env.TOKEN).toBe("literal-value");
    });

    it("writes .mcp.json with type field for non-stdio servers", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();
      artifacts.mcp["granola"] = {
        type: "streamable-http",
        url: "https://mcp.granola.ai/mcp",
      };
      artifacts.mcp["events"] = {
        type: "sse",
        url: "https://mcp.example.com/sse",
        headers: { Authorization: "Bearer token" },
      };

      const root: RootEntry = {
        name: "test",
        description: "Test",
        default_mcp_servers: ["granola", "events"],
      };

      await adapter.prepareSession(artifacts, dir, { root });

      const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
      expect(mcpJson.mcpServers.granola.type).toBe("http");
      expect(mcpJson.mcpServers.granola.url).toBe("https://mcp.granola.ai/mcp");
      expect(mcpJson.mcpServers.events.type).toBe("sse");
      expect(mcpJson.mcpServers.events.url).toBe("https://mcp.example.com/sse");
    });

    it("writes ${VAR} patterns through without resolution", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();
      artifacts.mcp["server"] = {
        type: "stdio",
        command: "npx",
        env: { API_KEY: "${MY_SECRET}", OTHER: "${ANOTHER_VAR}" },
      };

      const root: RootEntry = {
        name: "test",
        description: "Test",
        default_mcp_servers: ["server"],
      };

      await adapter.prepareSession(artifacts, dir, { root });

      const mcpJson = JSON.parse(
        readFileSync(join(dir, ".mcp.json"), "utf-8")
      );
      expect(mcpJson.mcpServers.server.env.API_KEY).toBe("${MY_SECRET}");
      expect(mcpJson.mcpServers.server.env.OTHER).toBe("${ANOTHER_VAR}");
    });

    it("injects skills into .claude/skills/", async () => {
      const dir = createTempDir();

      // Create a skill source directory
      const skillSrcDir = join(dir, "..", "skills", "deploy");
      mkdirSync(skillSrcDir, { recursive: true });
      writeFileSync(
        join(skillSrcDir, "SKILL.md"),
        "---\nname: deploy\n---\n# Deploy"
      );

      const artifacts = emptyArtifacts();
      artifacts.skills["deploy"] = {
        description: "Deploy skill",
        path: resolve(skillSrcDir),
      };

      const root: RootEntry = {
        name: "test",
        description: "Test",
        default_skills: ["deploy"],
      };

      const result = await adapter.prepareSession(artifacts, dir, { root });

      const injectedSkill = join(dir, ".claude", "skills", "deploy", "SKILL.md");
      expect(existsSync(injectedSkill)).toBe(true);
      expect(readFileSync(injectedSkill, "utf-8")).toContain("# Deploy");
      expect(result.skillPaths).toHaveLength(1);
    });

    it("copies references alongside skills", async () => {
      const dir = createTempDir();

      // Skill source
      const skillSrcDir = join(dir, "..", "skills", "deploy");
      mkdirSync(skillSrcDir, { recursive: true });
      writeFileSync(join(skillSrcDir, "SKILL.md"), "# Deploy");

      // Reference source
      const refSrcDir = join(dir, "..", "references");
      mkdirSync(refSrcDir, { recursive: true });
      writeFileSync(
        join(refSrcDir, "GIT_WORKFLOW.md"),
        "# Git Workflow"
      );

      const artifacts = emptyArtifacts();
      artifacts.skills["deploy"] = {
        description: "Deploy",
        path: resolve(skillSrcDir),
        references: ["git-workflow"],
      };
      artifacts.references["git-workflow"] = {
        description: "Git workflow",
        path: resolve(refSrcDir, "GIT_WORKFLOW.md"),
      };

      const root: RootEntry = {
        name: "test",
        description: "Test",
        default_skills: ["deploy"],
      };

      await adapter.prepareSession(artifacts, dir, { root });

      const refPath = join(
        dir,
        ".claude",
        "skills",
        "deploy",
        "references",
        "GIT_WORKFLOW.md"
      );
      expect(existsSync(refPath)).toBe(true);
      expect(readFileSync(refPath, "utf-8")).toContain("# Git Workflow");
    });

    it("skips skills that already exist locally", async () => {
      const dir = createTempDir();

      // Pre-existing local skill
      const localSkillDir = join(dir, ".claude", "skills", "deploy");
      mkdirSync(localSkillDir, { recursive: true });
      writeFileSync(join(localSkillDir, "SKILL.md"), "# Local version");

      // Catalog skill source
      const catalogSkillDir = join(dir, "..", "skills", "deploy");
      mkdirSync(catalogSkillDir, { recursive: true });
      writeFileSync(join(catalogSkillDir, "SKILL.md"), "# Catalog version");

      const artifacts = emptyArtifacts();
      artifacts.skills["deploy"] = {
        description: "Deploy",
        path: resolve(catalogSkillDir),
      };

      const root: RootEntry = {
        name: "test",
        description: "Test",
        default_skills: ["deploy"],
      };

      const result = await adapter.prepareSession(artifacts, dir, { root });

      // Local version should be preserved
      const content = readFileSync(
        join(localSkillDir, "SKILL.md"),
        "utf-8"
      );
      expect(content).toContain("# Local version");
      // Should not be in skillPaths since it was skipped
      expect(result.skillPaths).toHaveLength(0);
    });

    it("filters artifacts by root defaults", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();
      artifacts.mcp["github"] = {
        type: "stdio",
        command: "gh",
      };
      artifacts.mcp["slack"] = {
        type: "stdio",
        command: "slack",
      };

      const root: RootEntry = {
        description: "Web app",
        default_mcp_servers: ["github"],
      };

      await adapter.prepareSession(artifacts, dir, { root });

      const mcpJson = JSON.parse(
        readFileSync(join(dir, ".mcp.json"), "utf-8")
      );
      expect(mcpJson.mcpServers["github"]).toBeDefined();
      expect(mcpJson.mcpServers["slack"]).toBeUndefined();
    });

    it("returns a start command with cwd set to targetDir", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();

      const result = await adapter.prepareSession(artifacts, dir);

      expect(result.startCommand.command).toBe("claude");
      expect(result.startCommand.cwd).toBe(dir);
    });

    describe("unknown ID validation", () => {
      it("throws on unknown MCP server IDs from overrides", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.mcp["github"] = { type: "stdio", command: "gh" };

        await expect(
          adapter.prepareSession(artifacts, dir, {
            mcpServerOverrides: ["github", "nonexistent"],
          })
        ).rejects.toThrow(
          /Unknown MCP server ID\(s\): nonexistent\. Available: github/
        );
      });

      it("throws on unknown MCP server IDs from root defaults", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.mcp["github"] = { type: "stdio", command: "gh" };

        const root: RootEntry = {
          name: "test",
          description: "Test",
          default_mcp_servers: ["github", "invalid-server"],
        };

        await expect(
          adapter.prepareSession(artifacts, dir, { root })
        ).rejects.toThrow(
          /Unknown MCP server ID\(s\): invalid-server\. Available: github/
        );
      });

      it("throws on unknown skill IDs from overrides", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.skills["deploy"] = {
          id: "deploy",
          description: "Deploy",
          path: "/tmp/skills/deploy",
        };

        await expect(
          adapter.prepareSession(artifacts, dir, {
            skillOverrides: ["deploy", "bogus-skill"],
          })
        ).rejects.toThrow(
          /Unknown skill ID\(s\): bogus-skill\. Available: deploy/
        );
      });

      it("throws on unknown skill IDs from root defaults", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        const root: RootEntry = {
          name: "test",
          description: "Test",
          default_skills: ["nonexistent-skill"],
        };

        await expect(
          adapter.prepareSession(artifacts, dir, { root })
        ).rejects.toThrow(
          /Unknown skill ID\(s\): nonexistent-skill\. None available/
        );
      });

      it("throws on unknown hook IDs from root defaults", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.hooks["lint"] = {
          id: "lint",
          description: "Lint hook",
          path: "/tmp/hooks/lint",
        };

        const root: RootEntry = {
          name: "test",
          description: "Test",
          default_hooks: ["lint", "nonexistent-hook"],
        };

        await expect(
          adapter.prepareSession(artifacts, dir, { root })
        ).rejects.toThrow(
          /Unknown hook ID\(s\): nonexistent-hook\. Available: lint/
        );
      });

      it("throws on unknown plugin IDs from root defaults", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.plugins["code-quality"] = {
          id: "code-quality",
          description: "Linting tools",
        };

        const root: RootEntry = {
          name: "test",
          description: "Test",
          default_plugins: ["code-quality", "nonexistent-plugin"],
        };

        await expect(
          adapter.prepareSession(artifacts, dir, { root })
        ).rejects.toThrow(
          /Unknown plugin ID\(s\): nonexistent-plugin\. Available: code-quality/
        );
      });

      it("lists multiple unknown IDs in the error", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.mcp["github"] = { type: "stdio", command: "gh" };

        await expect(
          adapter.prepareSession(artifacts, dir, {
            mcpServerOverrides: ["bad-one", "bad-two"],
          })
        ).rejects.toThrow(
          /Unknown MCP server ID\(s\): bad-one, bad-two/
        );
      });
    });

    describe("subagent root merging", () => {
      it("merges subagent roots' MCP servers and skills into parent session", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        // Parent's MCP server
        artifacts.mcp["github"] = { type: "stdio", command: "gh" };
        // Subagent's MCP servers
        artifacts.mcp["postgres"] = { type: "stdio", command: "psql" };
        artifacts.mcp["slack"] = { type: "stdio", command: "slack" };

        // Parent skill source
        const parentSkillDir = join(dir, "..", "skills", "deploy");
        mkdirSync(parentSkillDir, { recursive: true });
        writeFileSync(join(parentSkillDir, "SKILL.md"), "# Deploy");

        // Subagent skill source
        const subSkillDir = join(dir, "..", "skills", "validate");
        mkdirSync(subSkillDir, { recursive: true });
        writeFileSync(join(subSkillDir, "SKILL.md"), "# Validate");

        artifacts.skills["deploy"] = {
          description: "Deploy skill",
          path: resolve(parentSkillDir),
        };
        artifacts.skills["validate"] = {
          description: "Validate skill",
          path: resolve(subSkillDir),
        };

        // Define roots
        artifacts.roots["sub-configs"] = {
          description: "Config subagent",
          default_mcp_servers: ["postgres", "slack"],
          default_skills: ["validate"],
        };

        const root: RootEntry = {
          description: "Parent root",
          default_mcp_servers: ["github"],
          default_skills: ["deploy"],
          default_subagent_roots: ["sub-configs"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        // MCP config should include parent + subagent servers
        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(mcpJson.mcpServers["github"]).toBeDefined();
        expect(mcpJson.mcpServers["postgres"]).toBeDefined();
        expect(mcpJson.mcpServers["slack"]).toBeDefined();

        // Both skills should be injected
        expect(existsSync(join(dir, ".claude", "skills", "deploy", "SKILL.md"))).toBe(true);
        expect(existsSync(join(dir, ".claude", "skills", "validate", "SKILL.md"))).toBe(true);
      });

      it("generates subagent context system prompt", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        // Add the MCP server and skill referenced by the subagent root
        artifacts.mcp["web-search"] = { type: "stdio", command: "search" };
        artifacts.skills["find-source"] = {
          id: "find-source",
          description: "Find source",
          path: join(dir, "..", "skills", "find-source"),
        };

        artifacts.roots["research"] = {
          display_name: "Research Agent",
          description: "Researches server sources",
          default_mcp_servers: ["web-search"],
          default_skills: ["find-source"],
          subdirectory: "agents/research",
        };

        const root: RootEntry = {
          description: "Server onboarding",
          default_subagent_roots: ["research"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        // subagentContext should be populated
        expect(result.subagentContext).toBeDefined();
        expect(result.subagentContext).toContain("Subagent Root Dependencies");
        expect(result.subagentContext).toContain("Research Agent");
        expect(result.subagentContext).toContain("Researches server sources");
        expect(result.subagentContext).toContain("web-search");
        expect(result.subagentContext).toContain("find-source");
        expect(result.subagentContext).toContain("agents/research");

        // No file written — context is ephemeral
        expect(existsSync(join(dir, ".claude", "subagent-roots-context.md"))).toBe(false);

        // Start command should include --append-system-prompt
        expect(result.startCommand.args).toContain("--append-system-prompt");
      });

      it("skips subagent merge when skipSubagentMerge is true", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.mcp["github"] = { type: "stdio", command: "gh" };
        artifacts.mcp["postgres"] = { type: "stdio", command: "psql" };

        artifacts.roots["sub-db"] = {
          description: "DB subagent",
          default_mcp_servers: ["postgres"],
        };

        const root: RootEntry = {
          description: "Parent root",
          default_mcp_servers: ["github"],
          default_subagent_roots: ["sub-db"],
        };

        const result = await adapter.prepareSession(artifacts, dir, {
          root,
          skipSubagentMerge: true,
        });

        // Only parent's MCP server should be present
        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(mcpJson.mcpServers["github"]).toBeDefined();
        expect(mcpJson.mcpServers["postgres"]).toBeUndefined();

        // No subagent context
        expect(result.subagentContext).toBeUndefined();
        expect(existsSync(join(dir, ".claude", "subagent-roots-context.md"))).toBe(false);
      });

      it("handles missing subagent root references gracefully", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.mcp["github"] = { type: "stdio", command: "gh" };

        const root: RootEntry = {
          description: "Parent root",
          default_mcp_servers: ["github"],
          default_subagent_roots: ["nonexistent-root"],
        };

        // Should not throw
        const result = await adapter.prepareSession(artifacts, dir, { root });

        // Only parent's server, no subagent context
        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(mcpJson.mcpServers["github"]).toBeDefined();
        expect(result.subagentContext).toBeUndefined();
      });

      it("merges multiple subagent roots and deduplicates", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.mcp["github"] = { type: "stdio", command: "gh" };
        artifacts.mcp["postgres"] = { type: "stdio", command: "psql" };
        artifacts.mcp["slack"] = { type: "stdio", command: "slack" };

        artifacts.roots["sub-a"] = {
          description: "Subagent A",
          default_mcp_servers: ["github", "postgres"],
        };
        artifacts.roots["sub-b"] = {
          description: "Subagent B",
          default_mcp_servers: ["postgres", "slack"],
        };

        const root: RootEntry = {
          description: "Parent root",
          default_mcp_servers: ["github"],
          default_subagent_roots: ["sub-a", "sub-b"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        // All three should be present (deduplicated union)
        expect(Object.keys(mcpJson.mcpServers).sort()).toEqual(["github", "postgres", "slack"]);

        // Context should mention both subagent roots
        expect(result.subagentContext).toContain("Subagent A");
        expect(result.subagentContext).toContain("Subagent B");
      });

      it("skips MCP merge when mcpServerOverrides are provided", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.mcp["github"] = { type: "stdio", command: "gh" };
        artifacts.mcp["postgres"] = { type: "stdio", command: "psql" };
        artifacts.mcp["slack"] = { type: "stdio", command: "slack" };

        artifacts.roots["sub-db"] = {
          description: "DB subagent",
          default_mcp_servers: ["postgres"],
        };

        const root: RootEntry = {
          description: "Parent root",
          default_mcp_servers: ["github"],
          default_subagent_roots: ["sub-db"],
        };

        // Explicit overrides should be the final word — subagent servers not re-added
        await adapter.prepareSession(artifacts, dir, {
          root,
          mcpServerOverrides: ["github", "slack"],
        });

        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(Object.keys(mcpJson.mcpServers).sort()).toEqual(["github", "slack"]);
        // postgres from subagent should NOT be added when overrides are explicit
        expect(mcpJson.mcpServers["postgres"]).toBeUndefined();
      });

      it("skips skill merge when skillOverrides are provided", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        // Create real skill source directories
        const parentSkillSrc = join(dir, "..", "skills-src", "parent-skill");
        const subSkillSrc = join(dir, "..", "skills-src", "sub-skill");
        mkdirSync(parentSkillSrc, { recursive: true });
        mkdirSync(subSkillSrc, { recursive: true });
        writeFileSync(join(parentSkillSrc, "SKILL.md"), "# Parent");
        writeFileSync(join(subSkillSrc, "SKILL.md"), "# Sub");

        artifacts.skills["parent-skill"] = { description: "Parent", path: resolve(parentSkillSrc) };
        artifacts.skills["sub-skill"] = { description: "Sub", path: resolve(subSkillSrc) };

        artifacts.roots["sub-root"] = {
          description: "Subagent",
          default_skills: ["sub-skill"],
        };

        const root: RootEntry = {
          description: "Parent root",
          default_skills: ["parent-skill"],
          default_subagent_roots: ["sub-root"],
        };

        // Explicit skill overrides — subagent skills not re-added
        await adapter.prepareSession(artifacts, dir, {
          root,
          skillOverrides: ["parent-skill"],
        });

        expect(existsSync(join(dir, ".claude", "skills", "parent-skill"))).toBe(true);
        expect(existsSync(join(dir, ".claude", "skills", "sub-skill"))).toBe(false);
      });

      it("still merges MCP servers when only skill overrides are provided", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.mcp["github"] = { type: "stdio", command: "gh" };
        artifacts.mcp["postgres"] = { type: "stdio", command: "psql" };

        const parentSkillSrc = join(dir, "..", "skills-src2", "parent-skill");
        mkdirSync(parentSkillSrc, { recursive: true });
        writeFileSync(join(parentSkillSrc, "SKILL.md"), "# Parent");
        artifacts.skills["parent-skill"] = { description: "Parent", path: resolve(parentSkillSrc) };

        artifacts.roots["sub-db"] = {
          description: "DB subagent",
          default_mcp_servers: ["postgres"],
        };

        const root: RootEntry = {
          description: "Parent root",
          default_mcp_servers: ["github"],
          default_skills: ["parent-skill"],
          default_subagent_roots: ["sub-db"],
        };

        // Skill overrides are set, but MCP overrides are NOT — MCP merge should still happen
        await adapter.prepareSession(artifacts, dir, {
          root,
          skillOverrides: ["parent-skill"],
        });

        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(Object.keys(mcpJson.mcpServers).sort()).toEqual(["github", "postgres"]);
      });

      it("does not merge when root has no default_subagent_roots", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.mcp["github"] = { type: "stdio", command: "gh" };

        const root: RootEntry = {
          description: "Simple root",
          default_mcp_servers: ["github"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        expect(result.subagentContext).toBeUndefined();
        expect(result.startCommand.args).not.toContain("--append-system-prompt");
      });
    });

    describe("hook injection", () => {
      it("injects path-based hooks into .claude/hooks/", async () => {
        const dir = createTempDir();

        // Create a hook source directory with HOOK.json and a script
        const hookSrcDir = join(dir, "..", "hooks", "lint-pre-commit");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "pre_commit", command: "npx", args: ["lint-staged"] })
        );
        writeFileSync(join(hookSrcDir, "run.sh"), "#!/bin/bash\nnpx lint-staged");

        const artifacts = emptyArtifacts();
        artifacts.hooks["lint-pre-commit"] = {
          description: "Pre-commit lint check",
          path: resolve(hookSrcDir),
        };

        const root: RootEntry = {
          name: "test",
          description: "Test",
          default_hooks: ["lint-pre-commit"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        const hookJson = join(dir, ".claude", "hooks", "lint-pre-commit", "HOOK.json");
        const hookScript = join(dir, ".claude", "hooks", "lint-pre-commit", "run.sh");
        expect(existsSync(hookJson)).toBe(true);
        expect(existsSync(hookScript)).toBe(true);
        expect(JSON.parse(readFileSync(hookJson, "utf-8")).event).toBe("pre_commit");
        expect(result.hookPaths).toHaveLength(1);
      });

      it("skips hooks that already exist locally", async () => {
        const dir = createTempDir();

        // Pre-existing local hook
        const localHookDir = join(dir, ".claude", "hooks", "my-hook");
        mkdirSync(localHookDir, { recursive: true });
        writeFileSync(
          join(localHookDir, "HOOK.json"),
          JSON.stringify({ event: "session_start", command: "echo", args: ["local"] })
        );

        // Catalog hook source
        const catalogHookDir = join(dir, "..", "hooks", "my-hook");
        mkdirSync(catalogHookDir, { recursive: true });
        writeFileSync(
          join(catalogHookDir, "HOOK.json"),
          JSON.stringify({ event: "session_start", command: "echo", args: ["catalog"] })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["my-hook"] = {
          description: "My hook",
          path: resolve(catalogHookDir),
        };

        const root: RootEntry = {
          name: "test",
          description: "Test",
          default_hooks: ["my-hook"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        // Local version should be preserved
        const content = JSON.parse(
          readFileSync(join(localHookDir, "HOOK.json"), "utf-8")
        );
        expect(content.args).toEqual(["local"]);
        expect(result.hookPaths).toHaveLength(0);
      });

      it("filters hooks by root default_hooks", async () => {
        const dir = createTempDir();

        // Create two hook sources
        const hookADir = join(dir, "..", "hooks", "hook-a");
        mkdirSync(hookADir, { recursive: true });
        writeFileSync(join(hookADir, "HOOK.json"), JSON.stringify({ event: "pre_commit", command: "a" }));

        const hookBDir = join(dir, "..", "hooks", "hook-b");
        mkdirSync(hookBDir, { recursive: true });
        writeFileSync(join(hookBDir, "HOOK.json"), JSON.stringify({ event: "post_commit", command: "b" }));

        const artifacts = emptyArtifacts();
        artifacts.hooks["hook-a"] = { description: "Hook A", path: resolve(hookADir) };
        artifacts.hooks["hook-b"] = { description: "Hook B", path: resolve(hookBDir) };

        const root: RootEntry = {
          description: "Test root",
          default_hooks: ["hook-a"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        expect(existsSync(join(dir, ".claude", "hooks", "hook-a", "HOOK.json"))).toBe(true);
        expect(existsSync(join(dir, ".claude", "hooks", "hook-b"))).toBe(false);
        expect(result.hookPaths).toHaveLength(1);
      });

      it("copies hook references", async () => {
        const dir = createTempDir();

        // Hook source
        const hookSrcDir = join(dir, "..", "hooks", "my-hook");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(join(hookSrcDir, "HOOK.json"), JSON.stringify({ event: "pre_commit", command: "lint" }));

        // Reference source
        const refSrcDir = join(dir, "..", "references");
        mkdirSync(refSrcDir, { recursive: true });
        writeFileSync(join(refSrcDir, "CODE_STANDARDS.md"), "# Code Standards");

        const artifacts = emptyArtifacts();
        artifacts.hooks["my-hook"] = {
          description: "My hook",
          path: resolve(hookSrcDir),
          references: ["code-standards"],
        };
        artifacts.references["code-standards"] = {
          description: "Code standards",
          path: resolve(refSrcDir, "CODE_STANDARDS.md"),
        };

        const root: RootEntry = {
          name: "test",
          description: "Test",
          default_hooks: ["my-hook"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const refPath = join(dir, ".claude", "hooks", "my-hook", "references", "CODE_STANDARDS.md");
        expect(existsSync(refPath)).toBe(true);
        expect(readFileSync(refPath, "utf-8")).toContain("# Code Standards");
      });

      it("returns empty hookPaths when no hooks are defined", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        const result = await adapter.prepareSession(artifacts, dir);

        expect(result.hookPaths).toEqual([]);
      });
    });

    describe("opt-in defaults", () => {
      it("loads no artifacts when no root is provided", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        // Add artifacts that should NOT be loaded without explicit root defaults
        artifacts.mcp["github"] = { type: "stdio", command: "gh" };
        artifacts.mcp["slack"] = { type: "stdio", command: "slack" };

        const skillSrcDir = join(dir, "..", "skills", "deploy");
        mkdirSync(skillSrcDir, { recursive: true });
        writeFileSync(join(skillSrcDir, "SKILL.md"), "# Deploy");
        artifacts.skills["deploy"] = {
          id: "deploy",
          description: "Deploy",
          path: resolve(skillSrcDir),
        };

        const hookSrcDir = join(dir, "..", "hooks", "my-hook");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(join(hookSrcDir, "HOOK.json"), JSON.stringify({ event: "pre_commit" }));
        artifacts.hooks["my-hook"] = {
          id: "my-hook",
          description: "My hook",
          path: resolve(hookSrcDir),
        };

        artifacts.plugins["quality"] = {
          id: "quality",
          description: "Quality plugin",
        };

        const result = await adapter.prepareSession(artifacts, dir);

        // .mcp.json should have empty mcpServers
        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(mcpJson.mcpServers).toEqual({});

        // No skills should be injected
        expect(existsSync(join(dir, ".claude", "skills", "deploy"))).toBe(false);
        expect(result.skillPaths).toEqual([]);

        // No hooks should be injected
        expect(existsSync(join(dir, ".claude", "hooks", "my-hook"))).toBe(false);
        expect(result.hookPaths).toEqual([]);
      });

      it("loads no artifacts when root has no default_* fields", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.mcp["github"] = { type: "stdio", command: "gh" };

        const skillSrcDir = join(dir, "..", "skills", "deploy");
        mkdirSync(skillSrcDir, { recursive: true });
        writeFileSync(join(skillSrcDir, "SKILL.md"), "# Deploy");
        artifacts.skills["deploy"] = {
          id: "deploy",
          description: "Deploy",
          path: resolve(skillSrcDir),
        };

        const root: RootEntry = {
          name: "minimal",
          description: "A root with no default_* fields",
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(mcpJson.mcpServers).toEqual({});
        expect(existsSync(join(dir, ".claude", "skills", "deploy"))).toBe(false);
        expect(result.skillPaths).toEqual([]);
        expect(result.hookPaths).toEqual([]);
      });

      it("respects CLI overrides even without root defaults", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.mcp["github"] = { type: "stdio", command: "gh" };
        artifacts.mcp["slack"] = { type: "stdio", command: "slack" };

        const skillSrcDir = join(dir, "..", "skills", "deploy");
        mkdirSync(skillSrcDir, { recursive: true });
        writeFileSync(join(skillSrcDir, "SKILL.md"), "# Deploy");
        artifacts.skills["deploy"] = {
          id: "deploy",
          description: "Deploy",
          path: resolve(skillSrcDir),
        };

        const result = await adapter.prepareSession(artifacts, dir, {
          mcpServerOverrides: ["github"],
          skillOverrides: ["deploy"],
        });

        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(mcpJson.mcpServers["github"]).toBeDefined();
        expect(mcpJson.mcpServers["slack"]).toBeUndefined();
        expect(result.skillPaths).toHaveLength(1);
      });

      it("respects hookOverrides over root defaults", async () => {
        const dir = createTempDir();

        // Create two hook sources
        const hookADir = join(dir, "..", "hooks", "hook-a");
        mkdirSync(hookADir, { recursive: true });
        writeFileSync(join(hookADir, "HOOK.json"), JSON.stringify({ event: "pre_commit", command: "a" }));

        const hookBDir = join(dir, "..", "hooks", "hook-b");
        mkdirSync(hookBDir, { recursive: true });
        writeFileSync(join(hookBDir, "HOOK.json"), JSON.stringify({ event: "post_commit", command: "b" }));

        const artifacts = emptyArtifacts();
        artifacts.hooks["hook-a"] = { description: "Hook A", path: resolve(hookADir) };
        artifacts.hooks["hook-b"] = { description: "Hook B", path: resolve(hookBDir) };

        const root: RootEntry = {
          description: "Test root",
          default_hooks: ["hook-a", "hook-b"],
        };

        // Override: only activate hook-b
        const result = await adapter.prepareSession(artifacts, dir, {
          root,
          hookOverrides: ["hook-b"],
        });

        expect(existsSync(join(dir, ".claude", "hooks", "hook-a"))).toBe(false);
        expect(existsSync(join(dir, ".claude", "hooks", "hook-b", "HOOK.json"))).toBe(true);
        expect(result.hookPaths).toHaveLength(1);
      });

      it("respects hookOverrides even without root defaults", async () => {
        const dir = createTempDir();

        const hookDir = join(dir, "..", "hooks", "hook-a");
        mkdirSync(hookDir, { recursive: true });
        writeFileSync(join(hookDir, "HOOK.json"), JSON.stringify({ event: "pre_commit", command: "a" }));

        const artifacts = emptyArtifacts();
        artifacts.hooks["hook-a"] = { description: "Hook A", path: resolve(hookDir) };

        const result = await adapter.prepareSession(artifacts, dir, {
          hookOverrides: ["hook-a"],
        });

        expect(existsSync(join(dir, ".claude", "hooks", "hook-a", "HOOK.json"))).toBe(true);
        expect(result.hookPaths).toHaveLength(1);
      });

      it("respects pluginOverrides over root defaults", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.plugins["quality"] = { description: "Quality plugin" };
        artifacts.plugins["security"] = { description: "Security plugin" };

        const root: RootEntry = {
          description: "Test root",
          default_plugins: ["quality", "security"],
        };

        // Override: only activate security — should not throw for valid IDs
        // and should reject unknown plugin IDs (validated via filterByIds)
        await adapter.prepareSession(artifacts, dir, {
          root,
          pluginOverrides: ["security"],
        });

        // Verify that an unknown plugin in the override is rejected
        await expect(
          adapter.prepareSession(artifacts, dir, {
            root,
            pluginOverrides: ["nonexistent"],
          })
        ).rejects.toThrow(/Unknown plugin ID\(s\): nonexistent/);
      });

      it("respects pluginOverrides even without root defaults", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.plugins["quality"] = { description: "Quality plugin" };

        // No root, but pluginOverrides provided — should not throw
        await adapter.prepareSession(artifacts, dir, {
          pluginOverrides: ["quality"],
        });
      });

      it("empty hookOverrides activates no hooks even with root defaults", async () => {
        const dir = createTempDir();

        const hookDir = join(dir, "..", "hooks", "hook-a");
        mkdirSync(hookDir, { recursive: true });
        writeFileSync(join(hookDir, "HOOK.json"), JSON.stringify({ event: "pre_commit", command: "a" }));

        const artifacts = emptyArtifacts();
        artifacts.hooks["hook-a"] = { description: "Hook A", path: resolve(hookDir) };

        const root: RootEntry = {
          description: "Test root",
          default_hooks: ["hook-a"],
        };

        // Empty array override means "activate none"
        const result = await adapter.prepareSession(artifacts, dir, {
          root,
          hookOverrides: [],
        });

        expect(existsSync(join(dir, ".claude", "hooks", "hook-a"))).toBe(false);
        expect(result.hookPaths).toHaveLength(0);
      });

      it("empty pluginOverrides activates no plugins even with root defaults", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.plugins["quality"] = { description: "Quality plugin" };

        const root: RootEntry = {
          description: "Test root",
          default_plugins: ["quality"],
        };

        // Empty array override means "activate none" — should not throw
        await adapter.prepareSession(artifacts, dir, {
          root,
          pluginOverrides: [],
        });
      });

      it("throws on unknown hook IDs from hookOverrides", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.hooks["lint"] = {
          description: "Lint hook",
          path: "/tmp/hooks/lint",
        };

        await expect(
          adapter.prepareSession(artifacts, dir, {
            hookOverrides: ["lint", "nonexistent-hook"],
          })
        ).rejects.toThrow(
          /Unknown hook ID\(s\): nonexistent-hook\. Available: lint/
        );
      });

      it("throws on unknown plugin IDs from pluginOverrides", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();
        artifacts.plugins["quality"] = { description: "Quality plugin" };

        await expect(
          adapter.prepareSession(artifacts, dir, {
            pluginOverrides: ["quality", "nonexistent-plugin"],
          })
        ).rejects.toThrow(
          /Unknown plugin ID\(s\): nonexistent-plugin\. Available: quality/
        );
      });
    });

    describe("hook registration in settings.json", () => {
      it("registers a copied hook in .claude/settings.json", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "session-audit");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "session_start", command: "echo", args: ["started"] })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["session-audit"] = {
          description: "Session audit",
          path: resolve(hookSrcDir),
        };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["session-audit"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        const settingsPath = join(dir, ".claude", "settings.json");
        expect(existsSync(settingsPath)).toBe(true);
        expect(result.configFiles).toContain(settingsPath);

        const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        expect(settings.hooks).toBeDefined();
        expect(settings.hooks.SessionStart).toHaveLength(1);
        expect(settings.hooks.SessionStart[0].matcher).toBe("");
        expect(settings.hooks.SessionStart[0].hooks).toHaveLength(1);
        expect(settings.hooks.SessionStart[0].hooks[0].type).toBe("command");
        expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("echo started");
      });

      it("maps AIR event names to Claude Code event names", async () => {
        const dir = createTempDir();

        const eventMappings: [string, string][] = [
          ["session_start", "SessionStart"],
          ["session_end", "SessionEnd"],
          ["pre_tool_call", "PreToolUse"],
          ["post_tool_call", "PostToolUse"],
          ["notification", "Notification"],
        ];

        const artifacts = emptyArtifacts();
        for (const [i, [airEvent]] of eventMappings.entries()) {
          const hookId = `hook-${i}`;
          const hookSrcDir = join(dir, "..", "hooks", hookId);
          mkdirSync(hookSrcDir, { recursive: true });
          writeFileSync(
            join(hookSrcDir, "HOOK.json"),
            JSON.stringify({ event: airEvent, command: `cmd-${i}` })
          );
          artifacts.hooks[hookId] = {
            description: `Hook ${i}`,
            path: resolve(hookSrcDir),
          };
        }

        const root: RootEntry = {
          description: "Test",
          default_hooks: eventMappings.map((_, i) => `hook-${i}`),
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf-8"));
        for (const [i, [, claudeEvent]] of eventMappings.entries()) {
          const eventHooks = settings.hooks[claudeEvent] as unknown[];
          expect(eventHooks).toBeDefined();
          const entry = eventHooks.find(
            (g: any) => g.hooks[0].command === `cmd-${i}`
          );
          expect(entry).toBeDefined();
        }
      });

      it("appends multiple hooks targeting the same Claude Code event", async () => {
        const dir = createTempDir();

        const hookADir = join(dir, "..", "hooks", "hook-a");
        mkdirSync(hookADir, { recursive: true });
        writeFileSync(
          join(hookADir, "HOOK.json"),
          JSON.stringify({ event: "pre_tool_call", command: "lint" })
        );

        const hookBDir = join(dir, "..", "hooks", "hook-b");
        mkdirSync(hookBDir, { recursive: true });
        writeFileSync(
          join(hookBDir, "HOOK.json"),
          JSON.stringify({ event: "pre_tool_call", command: "typecheck" })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["hook-a"] = { description: "A", path: resolve(hookADir) };
        artifacts.hooks["hook-b"] = { description: "B", path: resolve(hookBDir) };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["hook-a", "hook-b"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf-8"));
        expect(settings.hooks.PreToolUse).toHaveLength(2);
        const commands = settings.hooks.PreToolUse.map((g: any) => g.hooks[0].command);
        expect(commands).toContain("lint");
        expect(commands).toContain("typecheck");
      });

      it("merges with existing settings.json without overwriting", async () => {
        const dir = createTempDir();

        // Pre-populate settings.json with existing content
        const claudeDir = join(dir, ".claude");
        mkdirSync(claudeDir, { recursive: true });
        writeFileSync(
          join(claudeDir, "settings.json"),
          JSON.stringify({
            permissions: { allow: ["Read"] },
            hooks: {
              Stop: [{ matcher: "", hooks: [{ type: "command", command: "existing-stop" }] }],
            },
          })
        );

        const hookSrcDir = join(dir, "..", "hooks", "my-hook");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "session_end", command: "new-stop" })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["my-hook"] = { description: "My hook", path: resolve(hookSrcDir) };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["my-hook"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8"));
        // Existing non-hook settings preserved
        expect(settings.permissions).toEqual({ allow: ["Read"] });
        // Existing Stop hook preserved unchanged
        expect(settings.hooks.Stop).toHaveLength(1);
        expect(settings.hooks.Stop[0].hooks[0].command).toBe("existing-stop");
        // New session_end hook goes under SessionEnd
        expect(settings.hooks.SessionEnd).toHaveLength(1);
        expect(settings.hooks.SessionEnd[0].hooks[0].command).toBe("new-stop");
      });

      it("carries through matcher field from HOOK.json", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "bash-guard");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "pre_tool_call", command: "validate", matcher: "Bash" })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["bash-guard"] = { description: "Guard", path: resolve(hookSrcDir) };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["bash-guard"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf-8"));
        expect(settings.hooks.PreToolUse[0].matcher).toBe("Bash");
      });

      it("carries through timeout_seconds as timeout", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "slow-hook");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "session_start", command: "slow-cmd", timeout_seconds: 60 })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["slow-hook"] = { description: "Slow", path: resolve(hookSrcDir) };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["slow-hook"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf-8"));
        expect(settings.hooks.SessionStart[0].hooks[0].timeout).toBe(60);
      });

      it("combines command and args into a single command string", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "lint-hook");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "pre_tool_call", command: "npx", args: ["lint-staged", "--quiet"] })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["lint-hook"] = { description: "Lint", path: resolve(hookSrcDir) };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["lint-hook"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf-8"));
        expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("npx lint-staged --quiet");
      });

      it("resolves relative command paths to hook install directory", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "notify");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "session_start", command: "./notify.sh" })
        );
        writeFileSync(join(hookSrcDir, "notify.sh"), "#!/bin/bash\necho hello");

        const artifacts = emptyArtifacts();
        artifacts.hooks["notify"] = { description: "Notify", path: resolve(hookSrcDir) };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["notify"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf-8"));
        expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
          join(".claude", "hooks", "notify", "notify.sh")
        );
      });

      it("does not write settings.json when no hooks are copied", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        const result = await adapter.prepareSession(artifacts, dir);

        const settingsPath = join(dir, ".claude", "settings.json");
        expect(existsSync(settingsPath)).toBe(false);
        expect(result.configFiles).not.toContain(settingsPath);
      });

      it("skips hooks with unknown AIR events", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "unknown-event-hook");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "custom_event", command: "custom-cmd" })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["unknown-event-hook"] = {
          description: "Unknown event",
          path: resolve(hookSrcDir),
        };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["unknown-event-hook"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        // Hook was copied but unknown event skipped in registration
        expect(result.hookPaths).toHaveLength(1);
        const settingsPath = join(dir, ".claude", "settings.json");
        // settings.json is still written (even if empty hooks) because hookPaths.length > 0
        expect(existsSync(settingsPath)).toBe(true);
        const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        expect(Object.keys(settings.hooks)).toHaveLength(0);
      });

      it("does not register skipped (pre-existing) hooks", async () => {
        const dir = createTempDir();

        // Pre-existing local hook
        const localHookDir = join(dir, ".claude", "hooks", "local-hook");
        mkdirSync(localHookDir, { recursive: true });
        writeFileSync(
          join(localHookDir, "HOOK.json"),
          JSON.stringify({ event: "session_start", command: "local-cmd" })
        );

        // Catalog hook source
        const catalogHookDir = join(dir, "..", "hooks", "local-hook");
        mkdirSync(catalogHookDir, { recursive: true });
        writeFileSync(
          join(catalogHookDir, "HOOK.json"),
          JSON.stringify({ event: "session_start", command: "catalog-cmd" })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["local-hook"] = { description: "Local hook", path: resolve(catalogHookDir) };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["local-hook"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        // Hook was skipped — not in hookPaths
        expect(result.hookPaths).toHaveLength(0);
        // No settings.json written since no hooks were copied
        expect(existsSync(join(dir, ".claude", "settings.json"))).toBe(false);
      });

      it("skips pre_commit and post_commit events (no direct Claude Code equivalent)", async () => {
        const dir = createTempDir();

        const hookADir = join(dir, "..", "hooks", "pre-commit-hook");
        mkdirSync(hookADir, { recursive: true });
        writeFileSync(
          join(hookADir, "HOOK.json"),
          JSON.stringify({ event: "pre_commit", command: "lint" })
        );

        const hookBDir = join(dir, "..", "hooks", "post-commit-hook");
        mkdirSync(hookBDir, { recursive: true });
        writeFileSync(
          join(hookBDir, "HOOK.json"),
          JSON.stringify({ event: "post_commit", command: "notify" })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["pre-commit-hook"] = { description: "Pre", path: resolve(hookADir) };
        artifacts.hooks["post-commit-hook"] = { description: "Post", path: resolve(hookBDir) };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["pre-commit-hook", "post-commit-hook"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf-8"));
        // pre_commit and post_commit have no Claude Code mapping — skipped
        expect(settings.hooks.PreToolUse).toBeUndefined();
        expect(settings.hooks.PostToolUse).toBeUndefined();
        expect(Object.keys(settings.hooks)).toHaveLength(0);
      });

      it("shell-escapes args containing spaces or metacharacters", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "complex-hook");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({
            event: "pre_tool_call",
            command: "bash",
            args: ["-c", "echo hello world"],
          })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["complex-hook"] = { description: "Complex", path: resolve(hookSrcDir) };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["complex-hook"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf-8"));
        // "echo hello world" contains spaces — should be single-quoted
        expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe(
          "bash -c 'echo hello world'"
        );
      });

      it("skips hooks with malformed HOOK.json", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "bad-json-hook");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(join(hookSrcDir, "HOOK.json"), "{ invalid json }");

        const artifacts = emptyArtifacts();
        artifacts.hooks["bad-json-hook"] = {
          description: "Bad JSON",
          path: resolve(hookSrcDir),
        };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["bad-json-hook"],
        };

        // Should not throw — gracefully skips the malformed hook
        const result = await adapter.prepareSession(artifacts, dir, { root });
        expect(result.hookPaths).toHaveLength(1);

        const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf-8"));
        expect(Object.keys(settings.hooks)).toHaveLength(0);
      });

      it("skips hooks with missing command field in HOOK.json", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks", "no-cmd-hook");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "session_start" })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["no-cmd-hook"] = {
          description: "No command",
          path: resolve(hookSrcDir),
        };

        const root: RootEntry = {
          description: "Test",
          default_hooks: ["no-cmd-hook"],
        };

        // Should not throw — gracefully skips the hook
        const result = await adapter.prepareSession(artifacts, dir, { root });
        expect(result.hookPaths).toHaveLength(1);

        const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf-8"));
        expect(Object.keys(settings.hooks)).toHaveLength(0);
      });
    });

    describe("plugin artifact resolution", () => {
      it("merges plugin mcp_servers into .mcp.json", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.mcp["github"] = { type: "stdio", command: "gh" };
        artifacts.mcp["playwright-custom"] = { type: "stdio", command: "playwright" };
        artifacts.mcp["remote-fs"] = { type: "stdio", command: "remote-fs" };

        artifacts.plugins["screenshots-videos"] = {
          description: "Screenshot and video capture",
          mcp_servers: ["playwright-custom", "remote-fs"],
        };

        const root: RootEntry = {
          description: "Test root",
          default_mcp_servers: ["github"],
          default_plugins: ["screenshots-videos"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(mcpJson.mcpServers["github"]).toBeDefined();
        expect(mcpJson.mcpServers["playwright-custom"]).toBeDefined();
        expect(mcpJson.mcpServers["remote-fs"]).toBeDefined();
      });

      it("merges plugin skills into session", async () => {
        const dir = createTempDir();

        const skillSrcDir = join(dir, "..", "skills-plugin", "lint-fix");
        mkdirSync(skillSrcDir, { recursive: true });
        writeFileSync(join(skillSrcDir, "SKILL.md"), "# Lint Fix");

        const parentSkillSrc = join(dir, "..", "skills-plugin", "deploy");
        mkdirSync(parentSkillSrc, { recursive: true });
        writeFileSync(join(parentSkillSrc, "SKILL.md"), "# Deploy");

        const artifacts = emptyArtifacts();
        artifacts.skills["deploy"] = { description: "Deploy", path: resolve(parentSkillSrc) };
        artifacts.skills["lint-fix"] = { description: "Lint fix", path: resolve(skillSrcDir) };

        artifacts.plugins["code-quality"] = {
          description: "Code quality tools",
          skills: ["lint-fix"],
        };

        const root: RootEntry = {
          description: "Test root",
          default_skills: ["deploy"],
          default_plugins: ["code-quality"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        expect(existsSync(join(dir, ".claude", "skills", "deploy", "SKILL.md"))).toBe(true);
        expect(existsSync(join(dir, ".claude", "skills", "lint-fix", "SKILL.md"))).toBe(true);
        expect(result.skillPaths).toHaveLength(2);
      });

      it("merges plugin hooks into session", async () => {
        const dir = createTempDir();

        const hookSrcDir = join(dir, "..", "hooks-plugin", "lint-pre-commit");
        mkdirSync(hookSrcDir, { recursive: true });
        writeFileSync(
          join(hookSrcDir, "HOOK.json"),
          JSON.stringify({ event: "pre_tool_call", command: "npx", args: ["lint-staged"] })
        );

        const artifacts = emptyArtifacts();
        artifacts.hooks["lint-pre-commit"] = {
          description: "Pre-commit lint",
          path: resolve(hookSrcDir),
        };

        artifacts.plugins["code-quality"] = {
          description: "Code quality tools",
          hooks: ["lint-pre-commit"],
        };

        const root: RootEntry = {
          description: "Test root",
          default_plugins: ["code-quality"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        expect(existsSync(join(dir, ".claude", "hooks", "lint-pre-commit", "HOOK.json"))).toBe(true);
        expect(result.hookPaths).toHaveLength(1);
      });

      it("deduplicates when plugin and root share artifact IDs", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.mcp["github"] = { type: "stdio", command: "gh" };
        artifacts.mcp["slack"] = { type: "stdio", command: "slack" };

        artifacts.plugins["collab-tools"] = {
          description: "Collaboration",
          mcp_servers: ["github", "slack"],
        };

        const root: RootEntry = {
          description: "Test root",
          default_mcp_servers: ["github"],
          default_plugins: ["collab-tools"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(Object.keys(mcpJson.mcpServers).sort()).toEqual(["github", "slack"]);
      });

      it("merges artifacts from multiple plugins", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.mcp["playwright"] = { type: "stdio", command: "playwright" };
        artifacts.mcp["eslint-server"] = { type: "stdio", command: "eslint" };

        artifacts.plugins["screenshots"] = {
          description: "Screenshots",
          mcp_servers: ["playwright"],
        };
        artifacts.plugins["linting"] = {
          description: "Linting",
          mcp_servers: ["eslint-server"],
        };

        const root: RootEntry = {
          description: "Test root",
          default_plugins: ["screenshots", "linting"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(mcpJson.mcpServers["playwright"]).toBeDefined();
        expect(mcpJson.mcpServers["eslint-server"]).toBeDefined();
      });

      it("plugin artifacts are additive even when explicit overrides are provided", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.mcp["github"] = { type: "stdio", command: "gh" };
        artifacts.mcp["playwright"] = { type: "stdio", command: "playwright" };

        artifacts.plugins["screenshots"] = {
          description: "Screenshots",
          mcp_servers: ["playwright"],
        };

        const root: RootEntry = {
          description: "Test root",
          default_mcp_servers: ["github"],
          default_plugins: ["screenshots"],
        };

        await adapter.prepareSession(artifacts, dir, {
          root,
          mcpServerOverrides: ["github"],
        });

        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(mcpJson.mcpServers["github"]).toBeDefined();
        expect(mcpJson.mcpServers["playwright"]).toBeDefined();
      });

      it("throws when plugin references a nonexistent MCP server", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.plugins["bad-plugin"] = {
          description: "References missing server",
          mcp_servers: ["nonexistent-server"],
        };

        const root: RootEntry = {
          description: "Test root",
          default_plugins: ["bad-plugin"],
        };

        await expect(
          adapter.prepareSession(artifacts, dir, { root })
        ).rejects.toThrow(
          /Unknown MCP server ID\(s\): nonexistent-server/
        );
      });

      it("throws when plugin references a nonexistent skill", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.plugins["bad-plugin"] = {
          description: "References missing skill",
          skills: ["nonexistent-skill"],
        };

        const root: RootEntry = {
          description: "Test root",
          default_plugins: ["bad-plugin"],
        };

        await expect(
          adapter.prepareSession(artifacts, dir, { root })
        ).rejects.toThrow(
          /Unknown skill ID\(s\): nonexistent-skill/
        );
      });

      it("plugin with no artifact arrays does not affect session", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.mcp["github"] = { type: "stdio", command: "gh" };

        artifacts.plugins["minimal"] = {
          description: "A minimal plugin with no artifacts",
        };

        const root: RootEntry = {
          description: "Test root",
          default_mcp_servers: ["github"],
          default_plugins: ["minimal"],
        };

        await adapter.prepareSession(artifacts, dir, { root });

        const mcpJson = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(Object.keys(mcpJson.mcpServers)).toEqual(["github"]);
      });
    });

    describe("manifest-based reconciliation", () => {
      // End-to-end: run prepareSession twice with different selections and
      // assert that artifacts removed from the selection are cleaned up,
      // while user-authored artifacts and pre-existing .mcp.json keys are
      // preserved. This exercises the full manifest round-trip: build →
      // write → load → diff → cleanup.

      function writeSkillSrc(dir: string, id: string): string {
        const src = join(dir, "..", `src-${id}`, "skills", id);
        mkdirSync(src, { recursive: true });
        writeFileSync(join(src, "SKILL.md"), `---\nname: ${id}\n---\n# ${id}`);
        return resolve(src);
      }

      function writeHookSrc(dir: string, id: string, command: string): string {
        const src = join(dir, "..", `src-${id}`, "hooks", id);
        mkdirSync(src, { recursive: true });
        writeFileSync(
          join(src, "HOOK.json"),
          JSON.stringify({ event: "session_start", command })
        );
        return resolve(src);
      }

      it("removes stale skills, hooks, and MCP servers on re-run with a different selection", async () => {
        const dir = createTempDir();

        const artifacts = emptyArtifacts();
        artifacts.skills["skill-a"] = {
          description: "A",
          path: writeSkillSrc(dir, "skill-a"),
        };
        artifacts.skills["skill-b"] = {
          description: "B",
          path: writeSkillSrc(dir, "skill-b"),
        };
        artifacts.hooks["hook-a"] = {
          description: "A",
          path: writeHookSrc(dir, "hook-a", "cmd-a"),
        };
        artifacts.hooks["hook-b"] = {
          description: "B",
          path: writeHookSrc(dir, "hook-b", "cmd-b"),
        };
        artifacts.mcp["mcp-a"] = { type: "stdio", command: "cmd-a" };
        artifacts.mcp["mcp-b"] = { type: "stdio", command: "cmd-b" };

        // First run: selection A (everything).
        await adapter.prepareSession(artifacts, dir, {
          root: {
            description: "Test",
            default_skills: ["skill-a", "skill-b"],
            default_hooks: ["hook-a", "hook-b"],
            default_mcp_servers: ["mcp-a", "mcp-b"],
          },
        });

        expect(existsSync(join(dir, ".claude", "skills", "skill-a"))).toBe(true);
        expect(existsSync(join(dir, ".claude", "skills", "skill-b"))).toBe(true);
        expect(existsSync(join(dir, ".claude", "hooks", "hook-a"))).toBe(true);
        expect(existsSync(join(dir, ".claude", "hooks", "hook-b"))).toBe(true);
        {
          const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
          expect(Object.keys(mcp.mcpServers).sort()).toEqual(["mcp-a", "mcp-b"]);
          const settings = JSON.parse(
            readFileSync(join(dir, ".claude", "settings.json"), "utf-8")
          );
          expect(settings.hooks.SessionStart).toHaveLength(2);
        }

        // Second run: selection B (drops -b of each type).
        await adapter.prepareSession(artifacts, dir, {
          root: {
            description: "Test",
            default_skills: ["skill-a"],
            default_hooks: ["hook-a"],
            default_mcp_servers: ["mcp-a"],
          },
        });

        expect(existsSync(join(dir, ".claude", "skills", "skill-a"))).toBe(true);
        expect(existsSync(join(dir, ".claude", "skills", "skill-b"))).toBe(false);
        expect(existsSync(join(dir, ".claude", "hooks", "hook-a"))).toBe(true);
        expect(existsSync(join(dir, ".claude", "hooks", "hook-b"))).toBe(false);

        const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(Object.keys(mcp.mcpServers)).toEqual(["mcp-a"]);

        const settings = JSON.parse(
          readFileSync(join(dir, ".claude", "settings.json"), "utf-8")
        );
        expect(settings.hooks.SessionStart).toHaveLength(1);
        expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("cmd-a");
      });

      it("preserves user-authored MCP servers and settings hooks across re-runs", async () => {
        const dir = createTempDir();

        const artifacts = emptyArtifacts();
        artifacts.hooks["hook-a"] = {
          description: "A",
          path: writeHookSrc(dir, "hook-a", "cmd-a"),
        };
        artifacts.mcp["mcp-a"] = { type: "stdio", command: "cmd-a" };

        // Seed .mcp.json and .claude/settings.json with user-authored entries
        // that AIR must never touch.
        mkdirSync(join(dir, ".claude"), { recursive: true });
        writeFileSync(
          join(dir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              "user-mcp": { type: "stdio", command: "user-cmd" },
            },
          })
        );
        writeFileSync(
          join(dir, ".claude", "settings.json"),
          JSON.stringify({
            permissions: { allow: ["Bash(*)"] },
            hooks: {
              SessionStart: [
                {
                  matcher: "",
                  hooks: [{ type: "command", command: "user-hook.sh" }],
                },
              ],
            },
          })
        );

        // First run: AIR adds mcp-a and hook-a.
        await adapter.prepareSession(artifacts, dir, {
          root: {
            description: "Test",
            default_hooks: ["hook-a"],
            default_mcp_servers: ["mcp-a"],
          },
        });

        // Second run: AIR removes mcp-a and hook-a. User entries must remain.
        await adapter.prepareSession(artifacts, dir, {
          root: {
            description: "Test",
            default_hooks: [],
            default_mcp_servers: [],
          },
        });

        const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8"));
        expect(mcp.mcpServers["user-mcp"]).toEqual({
          type: "stdio",
          command: "user-cmd",
        });
        expect(mcp.mcpServers["mcp-a"]).toBeUndefined();

        const settings = JSON.parse(
          readFileSync(join(dir, ".claude", "settings.json"), "utf-8")
        );
        expect(settings.permissions).toEqual({ allow: ["Bash(*)"] });
        expect(settings.hooks.SessionStart).toHaveLength(1);
        expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
          "user-hook.sh"
        );
        expect(existsSync(join(dir, ".claude", "hooks", "hook-a"))).toBe(false);
      });

      it("treats a missing manifest as no prior state (no cleanup, no error)", async () => {
        const dir = createTempDir();

        const artifacts = emptyArtifacts();
        artifacts.skills["skill-a"] = {
          description: "A",
          path: writeSkillSrc(dir, "skill-a"),
        };

        // No prior manifest on disk → first run should just write artifacts.
        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_skills: ["skill-a"] },
        });

        expect(existsSync(join(dir, ".claude", "skills", "skill-a"))).toBe(true);
      });

      it("treats a corrupt manifest as no prior state (falls back cleanly)", async () => {
        const dir = createTempDir();

        const artifacts = emptyArtifacts();
        artifacts.skills["skill-a"] = {
          description: "A",
          path: writeSkillSrc(dir, "skill-a"),
        };

        // Write a corrupt manifest file at the exact path the adapter will
        // try to load. diffManifest should see `null` and do nothing stale.
        const { getManifestPath } = await import("@pulsemcp/air-core");
        const manifestPath = getManifestPath(dir);
        mkdirSync(join(manifestPath, "..").replace(/\/+$/, "") || "/", {
          recursive: true,
        });
        writeFileSync(manifestPath, "{ not valid json");

        await expect(
          adapter.prepareSession(artifacts, dir, {
            root: { description: "Test", default_skills: ["skill-a"] },
          })
        ).resolves.toBeDefined();

        expect(existsSync(join(dir, ".claude", "skills", "skill-a"))).toBe(true);
      });

      it("does not error when user has already deleted a previously-managed artifact", async () => {
        const dir = createTempDir();

        const artifacts = emptyArtifacts();
        artifacts.skills["skill-a"] = {
          description: "A",
          path: writeSkillSrc(dir, "skill-a"),
        };

        // First run: writes skill-a and records it in the manifest.
        await adapter.prepareSession(artifacts, dir, {
          root: { description: "Test", default_skills: ["skill-a"] },
        });
        expect(existsSync(join(dir, ".claude", "skills", "skill-a"))).toBe(true);

        // User manually deletes the skill between runs.
        rmSync(join(dir, ".claude", "skills", "skill-a"), {
          recursive: true,
          force: true,
        });

        // Second run with an empty selection: cleanup should be a no-op,
        // not throw on the missing directory.
        await expect(
          adapter.prepareSession(artifacts, dir, {
            root: { description: "Test", default_skills: [] },
          })
        ).resolves.toBeDefined();
      });
    });
  });

  describe("generateConfig plugin artifact resolution", () => {
    it("merges plugin mcp_servers into config", () => {
      const artifacts = emptyArtifacts();
      artifacts.mcp["github"] = { type: "stdio", command: "gh" };
      artifacts.mcp["playwright"] = { type: "stdio", command: "playwright" };

      artifacts.plugins["screenshots"] = {
        description: "Screenshots",
        mcp_servers: ["playwright"],
      };

      const root: RootEntry = {
        description: "Test root",
        default_mcp_servers: ["github"],
        default_plugins: ["screenshots"],
      };

      const config = adapter.generateConfig(artifacts, root);
      const mcpConfig = config.mcpConfig as any;

      expect(mcpConfig.mcpServers["github"]).toBeDefined();
      expect(mcpConfig.mcpServers["playwright"]).toBeDefined();
    });

    it("merges plugin skills into config", () => {
      const artifacts = emptyArtifacts();
      artifacts.skills["deploy"] = { description: "Deploy", path: "skills/deploy" };
      artifacts.skills["lint-fix"] = { description: "Lint fix", path: "skills/lint-fix" };

      artifacts.plugins["code-quality"] = {
        description: "Code quality",
        skills: ["lint-fix"],
      };

      const root: RootEntry = {
        description: "Test root",
        default_skills: ["deploy"],
        default_plugins: ["code-quality"],
      };

      const config = adapter.generateConfig(artifacts, root);
      expect(config.skillPaths).toEqual(["skills/deploy", "skills/lint-fix"]);
    });

    it("handles plugin mcp_servers when root has no default_mcp_servers", () => {
      const artifacts = emptyArtifacts();
      artifacts.mcp["playwright"] = { type: "stdio", command: "playwright" };

      artifacts.plugins["screenshots"] = {
        description: "Screenshots",
        mcp_servers: ["playwright"],
      };

      const root: RootEntry = {
        description: "Test root",
        default_plugins: ["screenshots"],
      };

      const config = adapter.generateConfig(artifacts, root);
      const mcpConfig = config.mcpConfig as any;
      expect(mcpConfig.mcpServers["playwright"]).toBeDefined();
    });
  });
});
