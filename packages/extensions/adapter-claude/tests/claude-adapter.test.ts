import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { ClaudeAdapter } from "../src/claude-adapter.js";
import type {
  ResolvedArtifacts,
  McpServerEntry,
  SkillEntry,
  PluginEntry,
  RootEntry,
  SecretResolver,
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

      const result = adapter.translateMcpServers(servers);
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

    it("translates remote servers (sse/streamable-http)", () => {
      const servers: Record<string, McpServerEntry> = {
        remote: {
          type: "streamable-http",
          url: "https://mcp.example.com/api",
          headers: { Authorization: "Bearer ${TOKEN}" },
        },
      };

      const result = adapter.translateMcpServers(servers) as any;
      expect(result.mcpServers.remote).toEqual({
        type: "streamable-http",
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
        id: "code-quality",
        description: "Linting and formatting tools",
        version: "1.2.0",
        skills: ["lint-fix"],
        mcp_servers: ["eslint-server"],
        hooks: ["lint-pre-commit"],
      };

      const result = adapter.translatePlugin(plugin);
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
        id: "minimal",
        description: "A minimal plugin",
      };

      const result = adapter.translatePlugin(plugin);
      expect(result).toEqual({
        name: "minimal",
        description: "A minimal plugin",
      });
      expect(result.version).toBeUndefined();
    });
  });

  describe("generateConfig", () => {
    it("uses all artifacts when no root is specified", () => {
      const artifacts = emptyArtifacts();
      artifacts.skills["a"] = {
        id: "a",
        description: "Skill A",
        path: "skills/a",
      };
      artifacts.skills["b"] = {
        id: "b",
        description: "Skill B",
        path: "skills/b",
      };
      artifacts.mcp["server"] = {
        type: "stdio",
        command: "test",
      };

      const config = adapter.generateConfig(artifacts);
      expect(config.skillPaths).toEqual(["skills/a", "skills/b"]);
      expect(config.mcpConfig).toBeDefined();
    });

    it("filters by root defaults when root is specified", () => {
      const artifacts = emptyArtifacts();
      artifacts.skills["deploy"] = {
        id: "deploy",
        description: "Deploy",
        path: "skills/deploy",
      };
      artifacts.skills["review"] = {
        id: "review",
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
        name: "web-app",
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

    it("handles missing skill references gracefully", () => {
      const artifacts = emptyArtifacts();
      const root: RootEntry = {
        name: "test",
        description: "Test",
        default_skills: ["nonexistent"],
      };

      const config = adapter.generateConfig(artifacts, root);
      expect(config.skillPaths).toEqual([]);
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

    function createTempDir(): string {
      tempDir = resolve(
        tmpdir(),
        `air-claude-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      mkdirSync(tempDir, { recursive: true });
      return tempDir;
    }

    afterEach(() => {
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
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

      const result = await adapter.prepareSession(artifacts, dir);

      const mcpPath = join(dir, ".mcp.json");
      expect(result.configFiles).toContain(mcpPath);
      expect(existsSync(mcpPath)).toBe(true);

      const mcpJson = JSON.parse(readFileSync(mcpPath, "utf-8"));
      expect(mcpJson.mcpServers.github.command).toBe("npx");
      expect(mcpJson.mcpServers.github.env.TOKEN).toBe("literal-value");
    });

    it("resolves ${VAR} patterns via secret resolvers", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();
      artifacts.mcp["server"] = {
        type: "stdio",
        command: "npx",
        env: { API_KEY: "${MY_SECRET}" },
      };

      const mockResolver: SecretResolver = {
        name: "mock",
        resolve: async (key) =>
          key === "MY_SECRET" ? "resolved-secret-value" : undefined,
      };

      await adapter.prepareSession(artifacts, dir, {
        secretResolvers: [mockResolver],
      });

      const mcpJson = JSON.parse(
        readFileSync(join(dir, ".mcp.json"), "utf-8")
      );
      expect(mcpJson.mcpServers.server.env.API_KEY).toBe(
        "resolved-secret-value"
      );
    });

    it("leaves ${VAR} unresolved when no resolver matches", async () => {
      const dir = createTempDir();
      const artifacts = emptyArtifacts();
      artifacts.mcp["server"] = {
        type: "stdio",
        command: "npx",
        env: { KEY: "${UNKNOWN_VAR}" },
      };

      await adapter.prepareSession(artifacts, dir, {
        secretResolvers: [
          {
            name: "empty",
            resolve: async () => undefined,
          },
        ],
      });

      const mcpJson = JSON.parse(
        readFileSync(join(dir, ".mcp.json"), "utf-8")
      );
      expect(mcpJson.mcpServers.server.env.KEY).toBe("${UNKNOWN_VAR}");
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
        id: "deploy",
        description: "Deploy skill",
        path: resolve(skillSrcDir),
      };

      const result = await adapter.prepareSession(artifacts, dir);

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
        id: "deploy",
        description: "Deploy",
        path: resolve(skillSrcDir),
        references: ["git-workflow"],
      };
      artifacts.references["git-workflow"] = {
        id: "git-workflow",
        description: "Git workflow",
        file: resolve(refSrcDir, "GIT_WORKFLOW.md"),
      };

      await adapter.prepareSession(artifacts, dir);

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
        id: "deploy",
        description: "Deploy",
        path: resolve(catalogSkillDir),
      };

      const result = await adapter.prepareSession(artifacts, dir);

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
        name: "web-app",
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
          id: "deploy",
          description: "Deploy skill",
          path: resolve(parentSkillDir),
        };
        artifacts.skills["validate"] = {
          id: "validate",
          description: "Validate skill",
          path: resolve(subSkillDir),
        };

        // Define roots
        artifacts.roots["sub-configs"] = {
          name: "sub-configs",
          description: "Config subagent",
          default_mcp_servers: ["postgres", "slack"],
          default_skills: ["validate"],
        };

        const root: RootEntry = {
          name: "parent",
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

        artifacts.roots["research"] = {
          name: "research",
          display_name: "Research Agent",
          description: "Researches server sources",
          default_mcp_servers: ["web-search"],
          default_skills: ["find-source"],
          subdirectory: "agents/research",
        };

        const root: RootEntry = {
          name: "onboarding",
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
          name: "sub-db",
          description: "DB subagent",
          default_mcp_servers: ["postgres"],
        };

        const root: RootEntry = {
          name: "parent",
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
          name: "parent",
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
          name: "sub-a",
          description: "Subagent A",
          default_mcp_servers: ["github", "postgres"],
        };
        artifacts.roots["sub-b"] = {
          name: "sub-b",
          description: "Subagent B",
          default_mcp_servers: ["postgres", "slack"],
        };

        const root: RootEntry = {
          name: "parent",
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

      it("does not merge when root has no default_subagent_roots", async () => {
        const dir = createTempDir();
        const artifacts = emptyArtifacts();

        artifacts.mcp["github"] = { type: "stdio", command: "gh" };

        const root: RootEntry = {
          name: "simple",
          description: "Simple root",
          default_mcp_servers: ["github"],
        };

        const result = await adapter.prepareSession(artifacts, dir, { root });

        expect(result.subagentContext).toBeUndefined();
        expect(result.startCommand.args).not.toContain("--append-system-prompt");
      });
    });
  });
});
