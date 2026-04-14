import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  statSync,
} from "fs";
import { join, basename, dirname } from "path";
import type {
  PluginEmitter,
  ResolvedArtifacts,
  PluginEntry,
  McpServerEntry,
  McpOAuthConfig,
  BuildMarketplaceOptions,
  BuiltPlugin,
  BuiltMarketplace,
} from "@pulsemcp/air-core";

/**
 * AIR event names → Claude Co-work hook event names.
 * Co-work supports many more events than AIR currently models;
 * unmapped AIR events are silently skipped.
 */
const AIR_TO_COWORK_EVENT: Record<string, string> = {
  session_start: "SessionStart",
  session_end: "SessionEnd",
  pre_tool_call: "PreToolUse",
  post_tool_call: "PostToolUse",
  notification: "Notification",
};

export class CoworkEmitter implements PluginEmitter {
  name = "cowork";
  displayName = "Claude Co-work";

  async buildMarketplace(
    artifacts: ResolvedArtifacts,
    pluginIds: string[],
    outputDir: string,
    options?: BuildMarketplaceOptions
  ): Promise<BuiltMarketplace> {
    this.validatePluginIds(artifacts, pluginIds);
    mkdirSync(outputDir, { recursive: true });

    const builtPlugins: BuiltPlugin[] = [];

    for (const pluginId of pluginIds) {
      const plugin = artifacts.plugins[pluginId];
      const pluginDir = join(outputDir, pluginId);
      const built = this.buildPlugin(artifacts, pluginId, plugin, pluginDir);
      builtPlugins.push(built);
    }

    const indexPath = join(outputDir, "marketplace.json");
    const index = this.buildMarketplaceIndex(
      artifacts,
      pluginIds,
      builtPlugins,
      options
    );
    writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");

    return { indexPath, plugins: builtPlugins };
  }

  buildPlugin(
    artifacts: ResolvedArtifacts,
    pluginId: string,
    plugin: PluginEntry,
    outputDir: string
  ): BuiltPlugin {
    mkdirSync(outputDir, { recursive: true });

    const manifest = this.buildManifest(pluginId, plugin);
    const manifestDir = join(outputDir, ".claude-plugin");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "plugin.json"),
      JSON.stringify(manifest, null, 2) + "\n"
    );

    const skillIds = plugin.skills ?? [];
    const hookIds = plugin.hooks ?? [];
    const mcpServerIds = plugin.mcp_servers ?? [];

    // Emit skills
    for (const skillId of skillIds) {
      const skill = artifacts.skills[skillId];
      if (!skill) continue;
      const skillTargetDir = join(outputDir, "skills", skillId);
      if (existsSync(skill.path)) {
        this.copyDirRecursive(skill.path, skillTargetDir);
      }
      if (skill.references?.length) {
        this.copyReferences(skill.references, skillTargetDir, artifacts);
      }
    }

    // Emit hooks
    if (hookIds.length > 0) {
      const hooksConfig = this.buildHooksConfig(artifacts, hookIds, outputDir);
      if (Object.keys(hooksConfig.hooks).length > 0) {
        const hooksDir = join(outputDir, "hooks");
        mkdirSync(hooksDir, { recursive: true });
        writeFileSync(
          join(hooksDir, "hooks.json"),
          JSON.stringify(hooksConfig, null, 2) + "\n"
        );
        this.copyHookScripts(artifacts, hookIds, outputDir);
      }
    }

    // Emit MCP servers
    if (mcpServerIds.length > 0) {
      const mcpConfig = this.buildMcpConfig(artifacts, mcpServerIds);
      if (Object.keys(mcpConfig.mcpServers).length > 0) {
        writeFileSync(
          join(outputDir, ".mcp.json"),
          JSON.stringify(mcpConfig, null, 2) + "\n"
        );
      }
    }

    return {
      id: pluginId,
      path: outputDir,
      skillCount: skillIds.filter((id) => artifacts.skills[id]).length,
      hookCount: hookIds.filter((id) => artifacts.hooks[id]).length,
      mcpServerCount: mcpServerIds.filter((id) => artifacts.mcp[id]).length,
    };
  }

  buildManifest(
    pluginId: string,
    plugin: PluginEntry
  ): Record<string, unknown> {
    const manifest: Record<string, unknown> = {
      name: pluginId,
      description: plugin.description,
    };
    if (plugin.version) manifest.version = plugin.version;
    if (plugin.author) manifest.author = plugin.author;
    if (plugin.homepage) manifest.homepage = plugin.homepage;
    if (plugin.repository) manifest.repository = plugin.repository;
    if (plugin.license) manifest.license = plugin.license;
    if (plugin.keywords) manifest.keywords = plugin.keywords;
    return manifest;
  }

  /**
   * Build inline hooks.json in the Co-work format:
   * { hooks: { EventName: [{ matcher, hooks: [{ type, command }] }] } }
   *
   * Each AIR HOOK.json is read, its event mapped, and its command rewritten
   * to use ${CLAUDE_PLUGIN_ROOT} for script paths.
   */
  buildHooksConfig(
    artifacts: ResolvedArtifacts,
    hookIds: string[],
    pluginDir: string
  ): { hooks: Record<string, unknown[]> } {
    const hooks: Record<string, unknown[]> = {};

    for (const hookId of hookIds) {
      const hook = artifacts.hooks[hookId];
      if (!hook) continue;

      const hookJsonPath = join(hook.path, "HOOK.json");
      if (!existsSync(hookJsonPath)) continue;

      let hookJson: Record<string, unknown>;
      try {
        hookJson = JSON.parse(readFileSync(hookJsonPath, "utf-8"));
      } catch {
        continue;
      }

      const coworkEvent = AIR_TO_COWORK_EVENT[hookJson.event as string];
      if (!coworkEvent || !hookJson.command) continue;

      const command = this.buildHookCommand(
        hookId,
        hookJson.command as string,
        hookJson.args as string[] | undefined
      );

      const hookEntry: Record<string, unknown> = {
        type: "command",
        command,
      };
      if (hookJson.timeout_seconds != null) {
        hookEntry.timeout = hookJson.timeout_seconds;
      }

      const matcherGroup: Record<string, unknown> = {
        matcher: hookJson.matcher ?? "",
        hooks: [hookEntry],
      };

      if (!hooks[coworkEvent]) {
        hooks[coworkEvent] = [];
      }
      hooks[coworkEvent].push(matcherGroup);
    }

    return { hooks };
  }

  /**
   * Build a hook command using ${CLAUDE_PLUGIN_ROOT} for relative paths.
   * Hook scripts are copied to scripts/{hookId}/ in the plugin directory,
   * so relative paths point there.
   */
  buildHookCommand(
    hookId: string,
    command: string,
    args?: string[]
  ): string {
    let cmd = command;
    if (cmd.startsWith("./")) {
      cmd = `\${CLAUDE_PLUGIN_ROOT}/scripts/${hookId}/${cmd.slice(2)}`;
    }
    if (args?.length) {
      const escaped = args.map((a) =>
        /[\s;&|`$"'\\]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a
      );
      cmd += " " + escaped.join(" ");
    }
    return cmd;
  }

  /**
   * Copy hook scripts into scripts/{hookId}/ inside the plugin directory.
   * Only copies executable files and scripts (not HOOK.json itself).
   */
  copyHookScripts(
    artifacts: ResolvedArtifacts,
    hookIds: string[],
    pluginDir: string
  ): void {
    for (const hookId of hookIds) {
      const hook = artifacts.hooks[hookId];
      if (!hook || !existsSync(hook.path)) continue;

      const scriptsDir = join(pluginDir, "scripts", hookId);
      const entries = readdirSync(hook.path);

      for (const entry of entries) {
        if (entry === "HOOK.json") continue;
        const srcPath = join(hook.path, entry);
        if (statSync(srcPath).isDirectory()) {
          this.copyDirRecursive(srcPath, join(scriptsDir, entry));
        } else {
          mkdirSync(scriptsDir, { recursive: true });
          copyFileSync(srcPath, join(scriptsDir, entry));
        }
      }
    }
  }

  /**
   * Translate AIR MCP server entries to Co-work .mcp.json format.
   * Same translation as Claude Code — Co-work uses the same MCP config format.
   */
  buildMcpConfig(
    artifacts: ResolvedArtifacts,
    mcpServerIds: string[]
  ): { mcpServers: Record<string, Record<string, unknown>> } {
    const mcpServers: Record<string, Record<string, unknown>> = {};

    for (const id of mcpServerIds) {
      const server = artifacts.mcp[id];
      if (!server) continue;

      if (server.type === "stdio") {
        mcpServers[id] = {
          command: server.command,
          ...(server.args && { args: server.args }),
          ...(server.env && { env: server.env }),
        };
      } else {
        const coworkType =
          server.type === "streamable-http" ? "http" : server.type;
        mcpServers[id] = {
          type: coworkType,
          url: server.url,
          ...(server.headers && { headers: server.headers }),
          ...(server.oauth && { oauth: this.translateOAuth(server.oauth) }),
        };
      }
    }

    return { mcpServers };
  }

  private translateOAuth(oauth: McpOAuthConfig): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (oauth.clientId) result.clientId = oauth.clientId;
    if (oauth.redirectUri) {
      try {
        const url = new URL(oauth.redirectUri);
        if (url.port) result.callbackPort = parseInt(url.port, 10);
      } catch {
        // Skip if redirectUri isn't parseable
      }
    }
    if (oauth.scopes) result.scopes = oauth.scopes;
    return result;
  }

  private buildMarketplaceIndex(
    artifacts: ResolvedArtifacts,
    pluginIds: string[],
    builtPlugins: BuiltPlugin[],
    options?: BuildMarketplaceOptions
  ): Record<string, unknown> {
    const plugins: Record<string, unknown>[] = pluginIds.map((id) => {
      const plugin = artifacts.plugins[id];
      const entry: Record<string, unknown> = {
        name: id,
        source: `./${id}`,
        description: plugin.description,
      };
      if (plugin.version) entry.version = plugin.version;
      if (plugin.title) entry.title = plugin.title;
      if (plugin.author) entry.author = plugin.author;
      if (plugin.keywords) entry.keywords = plugin.keywords;
      return entry;
    });

    return {
      name: options?.marketplaceName ?? "air-marketplace",
      description:
        options?.marketplaceDescription ??
        "Plugin marketplace generated from AIR configuration",
      plugins,
    };
  }

  private validatePluginIds(
    artifacts: ResolvedArtifacts,
    pluginIds: string[]
  ): void {
    const unknown = pluginIds.filter((id) => !artifacts.plugins[id]);
    if (unknown.length > 0) {
      const available = Object.keys(artifacts.plugins);
      const availableMsg =
        available.length > 0
          ? `Available: ${available.join(", ")}`
          : "None available";
      throw new Error(
        `Unknown plugin ID(s): ${unknown.join(", ")}. ${availableMsg}`
      );
    }
  }

  private copyReferences(
    refIds: string[],
    targetDir: string,
    artifacts: ResolvedArtifacts
  ): void {
    const refsTargetDir = join(targetDir, "references");
    for (const refId of refIds) {
      const ref = artifacts.references[refId];
      if (!ref) continue;
      if (existsSync(ref.path)) {
        const refTargetPath = join(refsTargetDir, basename(ref.path));
        mkdirSync(dirname(refTargetPath), { recursive: true });
        copyFileSync(ref.path, refTargetPath);
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
