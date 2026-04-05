import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
  statSync,
} from "fs";
import { resolve, join, dirname } from "path";
import type {
  AgentAdapter,
  AgentSessionConfig,
  StartCommand,
  ResolvedArtifacts,
  RootEntry,
  McpServerEntry,
  McpOAuthConfig,
  PluginEntry,
  SecretResolver,
  PrepareSessionOptions,
  PreparedSession,
} from "@pulsemcp/air-core";

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

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

  /**
   * Prepare a working directory for a Claude Code session.
   * Writes .mcp.json, injects skills + references into .claude/skills/,
   * and returns the start command.
   */
  async prepareSession(
    artifacts: ResolvedArtifacts,
    targetDir: string,
    options?: PrepareSessionOptions
  ): Promise<PreparedSession> {
    const root = options?.root;
    const resolvers = options?.secretResolvers || [];
    const baseDir = options?.baseDir || dirname(targetDir);
    const configFiles: string[] = [];
    const skillPaths: string[] = [];

    // 1. Resolve which artifacts to activate (overrides take precedence over root defaults)
    const mcpServerIds = options?.mcpServerOverrides
      ?? root?.default_mcp_servers
      ?? undefined;
    const mcpServers = mcpServerIds
      ? this.filterByIds(artifacts.mcp, mcpServerIds)
      : artifacts.mcp;

    const plugins = root?.default_plugins
      ? this.filterByIds(artifacts.plugins, root.default_plugins)
      : artifacts.plugins;

    const skillIds = options?.skillOverrides
      ?? root?.default_skills
      ?? Object.keys(artifacts.skills);

    // 2. Write .mcp.json with resolved secrets
    const resolvedServers = await this.resolveServerSecrets(
      mcpServers,
      resolvers
    );
    const mcpConfig = this.translateMcpServers(resolvedServers);
    const mcpConfigPath = join(targetDir, ".mcp.json");
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    configFiles.push(mcpConfigPath);

    // 3. Inject skills + references into .claude/skills/
    for (const skillId of skillIds) {
      const skill = artifacts.skills[skillId];
      if (!skill) continue;

      const skillTargetDir = join(targetDir, ".claude", "skills", skillId);

      // Skip if skill already exists locally (local takes priority)
      if (existsSync(skillTargetDir)) continue;

      // Copy skill directory contents (resolved relative to baseDir)
      const skillSourceDir = resolve(baseDir, skill.path);
      if (existsSync(skillSourceDir)) {
        this.copyDirRecursive(skillSourceDir, skillTargetDir);
        skillPaths.push(skillTargetDir);
      }

      // Copy referenced documents
      if (skill.references && skill.references.length > 0) {
        const refsTargetDir = join(skillTargetDir, "references");
        for (const refId of skill.references) {
          const ref = artifacts.references[refId];
          if (!ref) continue;
          const refSourcePath = resolve(baseDir, ref.file);
          if (existsSync(refSourcePath)) {
            const refTargetPath = join(
              refsTargetDir,
              ref.file.split("/").pop() || ref.file
            );
            mkdirSync(dirname(refTargetPath), { recursive: true });
            copyFileSync(refSourcePath, refTargetPath);
          }
        }
      }
    }

    // 4. Build start command
    const config = this.generateConfig(artifacts, root, targetDir);
    const startCommand = this.buildStartCommand({
      ...config,
      workDir: targetDir,
    });

    return { configFiles, skillPaths, startCommand };
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
      ...(plugin.version && { version: plugin.version }),
    };
  }

  /**
   * Resolve ${VAR} patterns in MCP server env values and URLs using
   * the provided secret resolvers. Falls through resolvers in order.
   */
  private async resolveServerSecrets(
    servers: Record<string, McpServerEntry>,
    resolvers: SecretResolver[]
  ): Promise<Record<string, McpServerEntry>> {
    if (resolvers.length === 0) return servers;

    const resolved: Record<string, McpServerEntry> = {};
    for (const [name, server] of Object.entries(servers)) {
      resolved[name] = {
        ...server,
        ...(server.env && {
          env: await this.resolveEnvMap(server.env, resolvers),
        }),
        ...(server.url && {
          url: await this.resolveString(server.url, resolvers),
        }),
        ...(server.headers && {
          headers: await this.resolveEnvMap(server.headers, resolvers),
        }),
      };
    }
    return resolved;
  }

  private async resolveEnvMap(
    env: Record<string, string>,
    resolvers: SecretResolver[]
  ): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      resolved[key] = await this.resolveString(value, resolvers);
    }
    return resolved;
  }

  private async resolveString(
    value: string,
    resolvers: SecretResolver[]
  ): Promise<string> {
    const matches = [...value.matchAll(ENV_VAR_PATTERN)];
    if (matches.length === 0) return value;

    let result = value;
    for (const match of matches) {
      const varName = match[1];
      for (const resolver of resolvers) {
        const resolved = await resolver.resolve(varName);
        if (resolved !== undefined) {
          result = result.replace(match[0], resolved);
          break;
        }
      }
    }
    return result;
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

  private copyDirRecursive(src: string, dest: string): void {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      if (statSync(srcPath).isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }
}
