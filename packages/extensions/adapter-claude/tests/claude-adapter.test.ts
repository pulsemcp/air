import { describe, it, expect } from "vitest";
import { ClaudeAdapter } from "../src/claude-adapter.js";
import type {
  ResolvedArtifacts,
  McpServerEntry,
  SkillEntry,
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
        url: "https://mcp.example.com/api",
        headers: { Authorization: "Bearer ${TOKEN}" },
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
      expect(result.mcpServers.authed.oauth).toEqual({
        clientId: "my-client",
        scopes: ["read", "write"],
        callbackPort: 3456,
      });
    });
  });

  describe("translatePlugin", () => {
    it("translates plugin format", () => {
      const plugin: PluginEntry = {
        id: "eslint",
        description: "Run ESLint",
        type: "command",
        command: "npx",
        args: ["eslint", "--fix", "."],
        timeout_seconds: 30,
      };

      const result = adapter.translatePlugin(plugin);
      expect(result).toEqual({
        name: "eslint",
        description: "Run ESLint",
        command: "npx",
        args: ["eslint", "--fix", "."],
        timeout: 30,
      });
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
});
