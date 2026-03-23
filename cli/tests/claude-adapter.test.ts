import { describe, it, expect } from "vitest";
import { ClaudeAdapter } from "../src/lib/agents/claude.js";
import type { ResolvedArtifacts, RootEntry } from "../src/lib/config.js";
import { emptyArtifacts } from "../src/lib/config.js";
import {
  exampleSkill,
  exampleMcpStdio,
  exampleMcpHttp,
  examplePlugin,
  exampleRoot,
  exampleHook,
} from "./helpers.js";

describe("ClaudeAdapter", () => {
  const adapter = new ClaudeAdapter();

  describe("metadata", () => {
    it("has correct name", () => {
      expect(adapter.name).toBe("claude");
    });

    it("has correct display name", () => {
      expect(adapter.displayName).toBe("Claude Code");
    });
  });

  describe("translateMcpServers", () => {
    it("translates stdio servers to Claude Code format", () => {
      const servers = {
        github: {
          title: "GitHub",
          description: "GitHub access",
          type: "stdio" as const,
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github@0.6.2"],
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
        },
      };

      const result = adapter.translateMcpServers(servers);

      expect(result).toEqual({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github@0.6.2"],
            env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
          },
        },
      });
    });

    it("translates remote servers to Claude Code format", () => {
      const servers = {
        analytics: {
          title: "Analytics",
          description: "Analytics MCP",
          type: "streamable-http" as const,
          url: "https://mcp.example.com/mcp",
          headers: { Authorization: "Bearer ${TOKEN}" },
        },
      };

      const result = adapter.translateMcpServers(servers);

      expect(result).toEqual({
        mcpServers: {
          analytics: {
            url: "https://mcp.example.com/mcp",
            headers: { Authorization: "Bearer ${TOKEN}" },
          },
        },
      });
    });

    it("strips title and description from translated servers", () => {
      const servers = {
        test: {
          title: "Test Server",
          description: "Should be stripped",
          type: "stdio" as const,
          command: "npx",
        },
      };

      const result = adapter.translateMcpServers(servers);
      const translated = (result.mcpServers as any).test;

      expect(translated.title).toBeUndefined();
      expect(translated.description).toBeUndefined();
      expect(translated.command).toBe("npx");
    });

    it("translates multiple servers of different types", () => {
      const servers = {
        local: {
          type: "stdio" as const,
          command: "npx",
          args: ["-y", "test@1.0"],
        },
        remote: {
          type: "sse" as const,
          url: "https://example.com/sse",
        },
      };

      const result = adapter.translateMcpServers(servers);
      const mcpServers = result.mcpServers as Record<
        string,
        Record<string, unknown>
      >;

      expect(mcpServers.local.command).toBe("npx");
      expect(mcpServers.local.url).toBeUndefined();
      expect(mcpServers.remote.url).toBe("https://example.com/sse");
      expect(mcpServers.remote.command).toBeUndefined();
    });

    it("omits optional fields when not present", () => {
      const servers = {
        minimal: {
          type: "stdio" as const,
          command: "npx",
        },
      };

      const result = adapter.translateMcpServers(servers);
      const translated = (result.mcpServers as any).minimal;

      expect(translated).toEqual({ command: "npx" });
      expect(translated.args).toBeUndefined();
      expect(translated.env).toBeUndefined();
    });
  });

  describe("translatePlugin", () => {
    it("translates AIR plugin to Claude Code format", () => {
      const plugin = {
        id: "eslint-autofix",
        title: "ESLint",
        description: "Auto-fix linting issues",
        type: "command" as const,
        command: "npx",
        args: ["eslint", "--fix", "."],
        timeout_seconds: 60,
      };

      const result = adapter.translatePlugin(plugin);

      expect(result).toEqual({
        name: "eslint-autofix",
        description: "Auto-fix linting issues",
        command: "npx",
        args: ["eslint", "--fix", "."],
        timeout: 60,
      });
    });

    it("omits timeout when not specified", () => {
      const plugin = {
        id: "my-plugin",
        description: "A plugin",
        type: "command" as const,
        command: "npx",
      };

      const result = adapter.translatePlugin(plugin);

      expect(result.timeout).toBeUndefined();
    });

    it("omits args when not specified", () => {
      const plugin = {
        id: "my-plugin",
        description: "A plugin",
        type: "command" as const,
        command: "npx",
      };

      const result = adapter.translatePlugin(plugin);

      expect(result.args).toBeUndefined();
    });
  });

  describe("generateConfig", () => {
    it("generates config with all artifacts when no root specified", () => {
      const artifacts: ResolvedArtifacts = {
        skills: {
          "skill-a": exampleSkill("skill-a") as any,
          "skill-b": exampleSkill("skill-b") as any,
        },
        references: {},
        mcp: {
          github: exampleMcpStdio({ title: "GitHub" }) as any,
          analytics: exampleMcpHttp({ title: "Analytics" }) as any,
        },
        plugins: {
          lint: examplePlugin("lint") as any,
        },
        roots: {},
        hooks: {},
      };

      const config = adapter.generateConfig(artifacts);

      // All MCP servers included
      const mcpServers = (config.mcpConfig as any)?.mcpServers;
      expect(Object.keys(mcpServers)).toHaveLength(2);

      // All plugins included
      expect(config.pluginConfigs).toHaveLength(1);

      // All skills included
      expect(config.skillPaths).toHaveLength(2);
    });

    it("filters artifacts by root defaults when root specified", () => {
      const artifacts: ResolvedArtifacts = {
        skills: {
          "skill-a": exampleSkill("skill-a") as any,
          "skill-b": exampleSkill("skill-b") as any,
          "skill-c": exampleSkill("skill-c") as any,
        },
        references: {},
        mcp: {
          github: exampleMcpStdio() as any,
          postgres: exampleMcpStdio() as any,
          redis: exampleMcpStdio() as any,
        },
        plugins: {
          lint: examplePlugin("lint") as any,
          format: examplePlugin("format") as any,
        },
        roots: {},
        hooks: {},
      };

      const root: RootEntry = {
        name: "web-app",
        description: "Web app",
        default_mcp_servers: ["github", "postgres"],
        default_skills: ["skill-a", "skill-b"],
        default_plugins: ["lint"],
      };

      const config = adapter.generateConfig(artifacts, root);

      // Only root's MCP servers
      const mcpServers = (config.mcpConfig as any)?.mcpServers;
      expect(Object.keys(mcpServers)).toHaveLength(2);
      expect(mcpServers.github).toBeDefined();
      expect(mcpServers.postgres).toBeDefined();
      expect(mcpServers.redis).toBeUndefined();

      // Only root's plugins
      expect(config.pluginConfigs).toHaveLength(1);

      // Only root's skills
      expect(config.skillPaths).toHaveLength(2);
    });

    it("handles root with empty defaults", () => {
      const artifacts: ResolvedArtifacts = {
        ...emptyArtifacts(),
        mcp: { github: exampleMcpStdio() as any },
        skills: { "skill-a": exampleSkill("skill-a") as any },
      };

      const root: RootEntry = {
        name: "minimal",
        description: "Minimal root",
        default_mcp_servers: [],
        default_skills: [],
        default_plugins: [],
      };

      const config = adapter.generateConfig(artifacts, root);

      const mcpServers = (config.mcpConfig as any)?.mcpServers;
      expect(Object.keys(mcpServers)).toHaveLength(0);
      expect(config.skillPaths).toHaveLength(0);
      expect(config.pluginConfigs).toHaveLength(0);
    });

    it("gracefully handles missing referenced artifacts in root", () => {
      const artifacts: ResolvedArtifacts = {
        ...emptyArtifacts(),
        mcp: { github: exampleMcpStdio() as any },
      };

      const root: RootEntry = {
        name: "test",
        description: "Test",
        default_mcp_servers: ["github", "nonexistent"],
        default_skills: ["nonexistent-skill"],
      };

      const config = adapter.generateConfig(artifacts, root);

      // Only includes the server that exists
      const mcpServers = (config.mcpConfig as any)?.mcpServers;
      expect(Object.keys(mcpServers)).toHaveLength(1);
      expect(mcpServers.github).toBeDefined();

      // No skill paths (none exist)
      expect(config.skillPaths).toHaveLength(0);
    });
  });

  describe("buildStartCommand", () => {
    it("returns claude as the command", () => {
      const cmd = adapter.buildStartCommand({
        agent: "claude",
        mcpConfig: {},
      });

      expect(cmd.command).toBe("claude");
    });
  });
});
