import { execSync } from "child_process";
import type {
  AgentAdapter,
  AgentSessionConfig,
  StartCommand,
} from "./types.js";
import type {
  ResolvedArtifacts,
  RootEntry,
  McpServerEntry,
  McpOAuthConfig,
  PluginEntry,
} from "../config.js";

export class ClaudeAdapter implements AgentAdapter {
  name = "claude" as const;
  displayName = "Claude Code";

  async isAvailable(): Promise<boolean> {
    try {
      execSync("which claude", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  generateConfig(
    artifacts: ResolvedArtifacts,
    root?: RootEntry,
    _workDir?: string
  ): AgentSessionConfig {
    // Resolve which artifacts to use based on root defaults
    const mcpServers = root?.default_mcp_servers
      ? this.filterByIds(artifacts.mcp, root.default_mcp_servers)
      : artifacts.mcp;

    const plugins = root?.default_plugins
      ? this.filterByIds(artifacts.plugins, root.default_plugins)
      : artifacts.plugins;

    // Translate MCP servers to Claude Code format
    const mcpConfig = this.translateMcpServers(mcpServers);

    // Translate plugins to Claude Code format
    const pluginConfigs = Object.values(plugins).map((p) =>
      this.translatePlugin(p)
    );

    // Collect skill paths
    const skillIds = root?.default_skills
      ? root.default_skills
      : Object.keys(artifacts.skills);
    const skillPaths = skillIds
      .filter((id) => artifacts.skills[id])
      .map((id) => artifacts.skills[id].path);

    return {
      agent: "claude",
      mcpConfig,
      pluginConfigs,
      skillPaths,
      env: {},
    };
  }

  buildStartCommand(config: AgentSessionConfig): StartCommand {
    const args: string[] = [];

    // Claude Code is started via the `claude` CLI
    return {
      command: "claude",
      args,
      env: config.env,
      cwd: config.workDir,
    };
  }

  /** Translate AIR mcp.json format to Claude Code .mcp.json format */
  translateMcpServers(
    servers: Record<string, McpServerEntry>
  ): Record<string, unknown> {
    const mcpServers: Record<string, Record<string, unknown>> = {};

    for (const [name, server] of Object.entries(servers)) {
      if (server.type === "stdio") {
        mcpServers[name] = {
          command: server.command,
          ...(server.args && { args: server.args }),
          ...(server.env && { env: server.env }),
        };
      } else {
        // sse or streamable-http
        mcpServers[name] = {
          url: server.url,
          ...(server.headers && { headers: server.headers }),
          ...(server.oauth && { oauth: this.translateOAuth(server.oauth) }),
        };
      }
    }

    return { mcpServers };
  }

  /** Translate AIR oauth config to Claude Code oauth format */
  private translateOAuth(oauth: McpOAuthConfig): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (oauth.clientId) {
      result.clientId = oauth.clientId;
    }
    if (oauth.redirectUri) {
      // Claude Code uses callbackPort; extract port from redirectUri
      try {
        const url = new URL(oauth.redirectUri);
        if (url.port) {
          result.callbackPort = parseInt(url.port, 10);
        }
      } catch {
        // If redirectUri isn't parseable, omit callbackPort
      }
    }
    // Note: Claude Code does not currently support a scopes field in its
    // oauth config. We pass it through for forward compatibility.
    if (oauth.scopes) {
      result.scopes = oauth.scopes;
    }
    return result;
  }

  /** Translate an AIR plugin to Claude Code plugin format */
  translatePlugin(plugin: PluginEntry): Record<string, unknown> {
    return {
      name: plugin.id,
      description: plugin.description,
      command: plugin.command,
      ...(plugin.args && { args: plugin.args }),
      ...(plugin.timeout_seconds && { timeout: plugin.timeout_seconds }),
    };
  }

  private filterByIds<T>(
    all: Record<string, T>,
    ids: string[]
  ): Record<string, T> {
    const filtered: Record<string, T> = {};
    for (const id of ids) {
      if (all[id]) {
        filtered[id] = all[id];
      }
    }
    return filtered;
  }
}
