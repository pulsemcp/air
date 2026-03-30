import { execSync } from "child_process";
import type {
  AgentAdapter,
  AgentSessionConfig,
  StartCommand,
  ResolvedArtifacts,
  RootEntry,
  McpServerEntry,
  McpOAuthConfig,
  PluginEntry,
} from "@pulsemcp/air-core";

export class ClaudeAdapter implements AgentAdapter {
  name = "claude";
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
    const mcpServers = root?.default_mcp_servers
      ? this.filterByIds(artifacts.mcp, root.default_mcp_servers)
      : artifacts.mcp;

    const plugins = root?.default_plugins
      ? this.filterByIds(artifacts.plugins, root.default_plugins)
      : artifacts.plugins;

    const mcpConfig = this.translateMcpServers(mcpServers);

    const pluginConfigs = Object.values(plugins).map((p) =>
      this.translatePlugin(p)
    );

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
      try {
        const url = new URL(oauth.redirectUri);
        if (url.port) {
          result.callbackPort = parseInt(url.port, 10);
        }
      } catch {
        // If redirectUri isn't parseable, omit callbackPort
      }
    }
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
