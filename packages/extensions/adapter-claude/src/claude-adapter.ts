import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
  statSync,
} from "fs";
import { join, dirname } from "path";
import type {
  AgentAdapter,
  AgentSessionConfig,
  StartCommand,
  ResolvedArtifacts,
  RootEntry,
  McpServerEntry,
  McpOAuthConfig,
  PluginEntry,
  PrepareSessionOptions,
  PreparedSession,
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
      ? this.filterByIds(artifacts.mcp, root.default_mcp_servers, "MCP server")
      : {};

    const plugins = root?.default_plugins
      ? this.filterByIds(artifacts.plugins, root.default_plugins, "plugin")
      : {};

    const mcpConfig = this.translateMcpServers(mcpServers);

    const pluginConfigs = Object.entries(plugins).map(([id, p]) =>
      this.translatePlugin(id, p)
    );

    const skillIds = root?.default_skills ?? [];
    if (root?.default_skills) {
      this.validateIds(artifacts.skills, skillIds, "skill");
    }
    const skillPaths = skillIds.map((id) => artifacts.skills[id].path);

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
   * injects path-based hooks into .claude/hooks/, and returns the start command.
   *
   * When the root declares default_subagent_roots and skipSubagentMerge is not set,
   * subagent roots' skills and MCP servers are merged into the parent session and
   * a system prompt section is generated describing the subagent dependencies.
   */
  async prepareSession(
    artifacts: ResolvedArtifacts,
    targetDir: string,
    options?: PrepareSessionOptions
  ): Promise<PreparedSession> {
    const root = options?.root;
    const configFiles: string[] = [];
    const skillPaths: string[] = [];
    const hookPaths: string[] = [];

    // 1. Resolve which artifacts to activate (overrides take precedence over root defaults)
    let mcpServerIds = options?.mcpServerOverrides
      ?? root?.default_mcp_servers
      ?? undefined;
    let skillIds = options?.skillOverrides
      ?? root?.default_skills
      ?? [];

    // 1b. Merge subagent roots' artifacts if applicable.
    // Skip merge per-artifact type when explicit overrides are provided —
    // overrides represent the caller's final selection (e.g. from the TUI)
    // and should not be augmented by implicit merge.
    const subagentRoots = this.resolveSubagentRoots(root, artifacts, options);
    if (subagentRoots.length > 0) {
      const merged = this.mergeSubagentArtifacts(subagentRoots, mcpServerIds, skillIds);
      if (!options?.mcpServerOverrides) {
        mcpServerIds = merged.mcpServerIds;
      }
      if (!options?.skillOverrides) {
        skillIds = merged.skillIds;
      }
    }

    const mcpServers = mcpServerIds?.length
      ? this.filterByIds(artifacts.mcp, mcpServerIds, "MCP server")
      : {};

    const pluginIds = options?.pluginOverrides
      ?? root?.default_plugins
      ?? undefined;
    const plugins = pluginIds?.length
      ? this.filterByIds(artifacts.plugins, pluginIds, "plugin")
      : {};

    // 2. Validate skill IDs
    this.validateIds(artifacts.skills, skillIds, "skill");

    // 3. Write .mcp.json (${VAR} patterns are left as-is for transforms to resolve)
    const mcpConfig = this.translateMcpServers(mcpServers);
    const mcpConfigPath = join(targetDir, ".mcp.json");
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    configFiles.push(mcpConfigPath);

    // 4. Inject skills + references into .claude/skills/
    for (const skillId of skillIds) {
      const skill = artifacts.skills[skillId];

      const skillTargetDir = join(targetDir, ".claude", "skills", skillId);

      // Skip if skill already exists locally (local takes priority)
      if (existsSync(skillTargetDir)) continue;

      // Copy skill directory contents (paths are absolute from resolveArtifacts)
      const skillSourceDir = skill.path;
      if (existsSync(skillSourceDir)) {
        this.copyDirRecursive(skillSourceDir, skillTargetDir);
        skillPaths.push(skillTargetDir);
      }

      // Copy referenced documents
      if (skill.references && skill.references.length > 0) {
        this.copyReferences(skill.references, skillTargetDir, artifacts);
      }
    }

    // 5. Validate and inject path-based hooks into .claude/hooks/
    const hookIds = options?.hookOverrides
      ?? root?.default_hooks
      ?? [];
    if (hookIds.length > 0) {
      this.validateIds(artifacts.hooks, hookIds, "hook");
    }
    for (const hookId of hookIds) {
      const hook = artifacts.hooks[hookId];

      const hookTargetDir = join(targetDir, ".claude", "hooks", hookId);

      // Skip if hook already exists locally (local takes priority)
      if (existsSync(hookTargetDir)) continue;

      // Copy hook directory contents (paths are absolute from resolveArtifacts)
      const hookSourceDir = hook.path;
      if (existsSync(hookSourceDir)) {
        this.copyDirRecursive(hookSourceDir, hookTargetDir);
        hookPaths.push(hookTargetDir);
      }

      // Copy referenced documents
      if (hook.references && hook.references.length > 0) {
        this.copyReferences(hook.references, hookTargetDir, artifacts);
      }
    }

    // 6. Generate ephemeral subagent context for system prompt
    let subagentContext: string | undefined;
    if (subagentRoots.length > 0) {
      subagentContext = this.buildSubagentContext(subagentRoots);
    }

    // 7. Build start command (include --append-system-prompt if subagent context exists)
    // Pass undefined as root — prepareSession already handled all filtering/validation above.
    // Passing root here would cause generateConfig to re-validate with the original (pre-merge)
    // root defaults, which is both redundant and fragile.
    const config = this.generateConfig(artifacts, undefined, targetDir);
    const startCommand = this.buildStartCommand({
      ...config,
      workDir: targetDir,
    });
    if (subagentContext) {
      startCommand.args.push("--append-system-prompt", subagentContext);
    }

    return { configFiles, skillPaths, hookPaths, startCommand, subagentContext };
  }

  /**
   * Resolve subagent roots from the root's default_subagent_roots.
   * Returns empty array if skipSubagentMerge is set or no subagent roots exist.
   */
  private resolveSubagentRoots(
    root: RootEntry | undefined,
    artifacts: ResolvedArtifacts,
    options?: PrepareSessionOptions
  ): RootEntry[] {
    if (options?.skipSubagentMerge) return [];
    if (!root?.default_subagent_roots?.length) return [];

    const resolved: RootEntry[] = [];
    for (const id of root.default_subagent_roots) {
      const subRoot = artifacts.roots[id];
      if (subRoot) {
        resolved.push(subRoot);
      }
    }
    return resolved;
  }

  /**
   * Merge subagent roots' default_mcp_servers and default_skills into the
   * parent's activated sets (union, preserving order with parent first).
   */
  private mergeSubagentArtifacts(
    subagentRoots: RootEntry[],
    parentMcpServerIds: string[] | undefined,
    parentSkillIds: string[]
  ): { mcpServerIds: string[] | undefined; skillIds: string[] } {
    const mcpSet = new Set(parentMcpServerIds ?? []);
    const skillSet = new Set(parentSkillIds);

    for (const sub of subagentRoots) {
      if (sub.default_mcp_servers) {
        for (const id of sub.default_mcp_servers) mcpSet.add(id);
      }
      if (sub.default_skills) {
        for (const id of sub.default_skills) skillSet.add(id);
      }
    }

    return {
      mcpServerIds: parentMcpServerIds !== undefined || mcpSet.size > 0
        ? [...mcpSet]
        : undefined,
      skillIds: [...skillSet],
    };
  }

  /**
   * Build a system prompt section describing the subagent root dependencies.
   * Gives the agent context about what capabilities were merged and from where.
   */
  private buildSubagentContext(subagentRoots: RootEntry[]): string {
    const lines: string[] = [
      "## Subagent Root Dependencies",
      "",
      "This session includes capabilities from the following subagent roots.",
      "Their skills and MCP servers have been merged into your session.",
      "",
    ];

    for (const sub of subagentRoots) {
      lines.push(`### ${sub.display_name || "Subagent"}`);
      lines.push("");
      lines.push(`**Description**: ${sub.description}`);
      if (sub.default_mcp_servers?.length) {
        lines.push(`**MCP Servers**: ${sub.default_mcp_servers.join(", ")}`);
      }
      if (sub.default_skills?.length) {
        lines.push(`**Skills**: ${sub.default_skills.join(", ")}`);
      }
      if (sub.subdirectory) {
        lines.push(`**Subdirectory**: ${sub.subdirectory}`);
      }
      lines.push("");
    }

    return lines.join("\n");
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
        // Claude Code uses "http" for the streamable-http transport
        const claudeType = server.type === "streamable-http" ? "http" : server.type;
        mcpServers[name] = {
          type: claudeType,
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
  translatePlugin(id: string, plugin: PluginEntry): Record<string, unknown> {
    return {
      name: id,
      description: plugin.description,
      ...(plugin.version && { version: plugin.version }),
    };
  }

  /** Throw if any IDs don't exist in the available map. */
  private validateIds<T>(
    all: Record<string, T>,
    ids: string[],
    artifactType: string
  ): void {
    const unknown = ids.filter((id) => !all[id]);
    if (unknown.length > 0) {
      const available = Object.keys(all);
      const availableMsg =
        available.length > 0 ? `Available: ${available.join(", ")}` : "None available";
      throw new Error(
        `Unknown ${artifactType} ID(s): ${unknown.join(", ")}. ${availableMsg}`
      );
    }
  }

  private filterByIds<T>(
    all: Record<string, T>,
    ids: string[],
    artifactType: string
  ): Record<string, T> {
    this.validateIds(all, ids, artifactType);
    const filtered: Record<string, T> = {};
    for (const id of ids) {
      filtered[id] = all[id];
    }
    return filtered;
  }

  /**
   * Copy referenced documents into a references/ subdirectory of the target.
   */
  private copyReferences(
    refIds: string[],
    targetDir: string,
    artifacts: ResolvedArtifacts
  ): void {
    const refsTargetDir = join(targetDir, "references");
    for (const refId of refIds) {
      const ref = artifacts.references[refId];
      if (!ref) continue;
      const refSourcePath = ref.path;
      if (existsSync(refSourcePath)) {
        const refTargetPath = join(
          refsTargetDir,
          ref.path.split("/").pop() || ref.path
        );
        mkdirSync(dirname(refTargetPath), { recursive: true });
        copyFileSync(refSourcePath, refTargetPath);
      }
    }
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
