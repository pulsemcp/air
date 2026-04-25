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
  McpOAuthConfig,
  BuildMarketplaceOptions,
  BuiltPlugin,
  BuiltMarketplace,
  QualifiedId,
} from "@pulsemcp/air-core";
import { parseQualifiedId, resolveReference } from "@pulsemcp/air-core";

interface PluginActivation {
  qualified: QualifiedId;
  short: string;
}

interface ChildActivation {
  qualified: QualifiedId;
  short: string;
}

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
    const activations = this.resolvePluginActivations(artifacts, pluginIds);
    mkdirSync(outputDir, { recursive: true });

    const builtPlugins: BuiltPlugin[] = [];

    for (const a of activations) {
      const plugin = artifacts.plugins[a.qualified];
      const pluginDir = join(outputDir, a.short);
      const built = this.buildPlugin(artifacts, a.qualified, a.short, plugin, pluginDir);
      builtPlugins.push(built);
    }

    const claudePluginDir = join(outputDir, ".claude-plugin");
    mkdirSync(claudePluginDir, { recursive: true });
    const indexPath = join(claudePluginDir, "marketplace.json");
    const index = this.buildMarketplaceIndex(
      artifacts,
      activations,
      options
    );
    writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");

    return { indexPath, plugins: builtPlugins };
  }

  buildPlugin(
    artifacts: ResolvedArtifacts,
    pluginId: QualifiedId,
    shortId: string,
    plugin: PluginEntry,
    outputDir: string
  ): BuiltPlugin {
    mkdirSync(outputDir, { recursive: true });

    const manifest = this.buildManifest(shortId, plugin);
    const manifestDir = join(outputDir, ".claude-plugin");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "plugin.json"),
      JSON.stringify(manifest, null, 2) + "\n"
    );

    const skillActs = this.shortenChildIds(plugin.skills ?? []);
    const hookActs = this.shortenChildIds(plugin.hooks ?? []);
    const mcpActs = this.shortenChildIds(plugin.mcp_servers ?? []);

    // Emit skills under skills/<short>/
    for (const a of skillActs) {
      const skill = artifacts.skills[a.qualified];
      if (!skill) continue;
      const skillTargetDir = join(outputDir, "skills", a.short);
      if (existsSync(skill.path)) {
        this.copyDirRecursive(skill.path, skillTargetDir);
      }
      if (skill.references?.length) {
        this.copyReferences(skill.references, skillTargetDir, artifacts);
      }
    }

    // Emit hooks
    if (hookActs.length > 0) {
      const hooksConfig = this.buildHooksConfig(artifacts, hookActs);
      if (Object.keys(hooksConfig.hooks).length > 0) {
        const hooksDir = join(outputDir, "hooks");
        mkdirSync(hooksDir, { recursive: true });
        writeFileSync(
          join(hooksDir, "hooks.json"),
          JSON.stringify(hooksConfig, null, 2) + "\n"
        );
        this.copyHookScripts(artifacts, hookActs, outputDir);
      }
    }

    // Emit MCP servers
    if (mcpActs.length > 0) {
      const mcpConfig = this.buildMcpConfig(artifacts, mcpActs);
      if (Object.keys(mcpConfig.mcpServers).length > 0) {
        writeFileSync(
          join(outputDir, ".mcp.json"),
          JSON.stringify(mcpConfig, null, 2) + "\n"
        );
      }
    }

    return {
      id: shortId,
      path: outputDir,
      skillCount: skillActs.filter((a) => artifacts.skills[a.qualified]).length,
      hookCount: hookActs.filter((a) => artifacts.hooks[a.qualified]).length,
      mcpServerCount: mcpActs.filter((a) => artifacts.mcp[a.qualified]).length,
    };
  }

  buildManifest(
    shortId: string,
    plugin: PluginEntry
  ): Record<string, unknown> {
    const manifest: Record<string, unknown> = {
      name: shortId,
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
   * Build inline hooks.json in the Co-work format.
   * Each hook activation contributes one matcher group; commands are rewritten
   * to use ${CLAUDE_PLUGIN_ROOT}/scripts/<short>/ for relative paths.
   */
  buildHooksConfig(
    artifacts: ResolvedArtifacts,
    hookActs: ChildActivation[]
  ): { hooks: Record<string, unknown[]> } {
    const hooks: Record<string, unknown[]> = {};

    for (const a of hookActs) {
      const hook = artifacts.hooks[a.qualified];
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
        a.short,
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

  buildHookCommand(
    shortId: string,
    command: string,
    args?: string[]
  ): string {
    let cmd = command;
    if (cmd.startsWith("./")) {
      cmd = `\${CLAUDE_PLUGIN_ROOT}/scripts/${shortId}/${cmd.slice(2)}`;
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
   * Copy hook scripts into scripts/<short>/ inside the plugin directory.
   */
  copyHookScripts(
    artifacts: ResolvedArtifacts,
    hookActs: ChildActivation[],
    pluginDir: string
  ): void {
    for (const a of hookActs) {
      const hook = artifacts.hooks[a.qualified];
      if (!hook || !existsSync(hook.path)) continue;

      const scriptsDir = join(pluginDir, "scripts", a.short);
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
   * Keys are bare shortnames — Co-work's MCP namespace is scope-naive.
   */
  buildMcpConfig(
    artifacts: ResolvedArtifacts,
    mcpActs: ChildActivation[]
  ): { mcpServers: Record<string, Record<string, unknown>> } {
    const mcpServers: Record<string, Record<string, unknown>> = {};

    for (const a of mcpActs) {
      const server = artifacts.mcp[a.qualified];
      if (!server) continue;

      if (server.type === "stdio") {
        mcpServers[a.short] = {
          command: server.command,
          ...(server.args && { args: server.args }),
          ...(server.env && { env: server.env }),
        };
      } else {
        const coworkType =
          server.type === "streamable-http" ? "http" : server.type;
        mcpServers[a.short] = {
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
    if (oauth.authServerMetadataUrl) {
      result.authServerMetadataUrl = oauth.authServerMetadataUrl;
    }
    if (oauth.clientSecret) {
      result.clientSecret = oauth.clientSecret;
    }
    return result;
  }

  private buildMarketplaceIndex(
    artifacts: ResolvedArtifacts,
    activations: PluginActivation[],
    options?: BuildMarketplaceOptions
  ): Record<string, unknown> {
    const plugins: Record<string, unknown>[] = activations.map((a) => {
      const plugin = artifacts.plugins[a.qualified];
      const entry: Record<string, unknown> = {
        name: a.short,
        source: `./${a.short}`,
        description: plugin.description,
      };
      if (plugin.version) entry.version = plugin.version;
      if (plugin.author) entry.author = plugin.author;
      if (plugin.keywords) entry.keywords = plugin.keywords;
      return entry;
    });

    const index: Record<string, unknown> = {
      name: options?.marketplaceName ?? "air-marketplace",
      owner: options?.marketplaceOwner ?? { name: "AIR" },
      plugins,
    };

    const description =
      options?.marketplaceDescription ??
      "Plugin marketplace generated from AIR configuration";
    index.metadata = { description };

    return index;
  }

  /**
   * Resolve plugin IDs (qualified or short) into qualified-shortname pairs.
   * Throws on unknown / ambiguous IDs and on shortname collisions across the
   * activation set (the marketplace can't host two plugins with the same dir).
   */
  private resolvePluginActivations(
    artifacts: ResolvedArtifacts,
    pluginIds: string[]
  ): PluginActivation[] {
    const acts: PluginActivation[] = [];
    const errors: string[] = [];
    const shortToQualified = new Map<string, string>();

    for (const id of pluginIds) {
      const res = resolveReference(artifacts.plugins, id, undefined);
      if (res.status === "missing") {
        errors.push(`Unknown plugin ID "${id}".`);
        continue;
      }
      if (res.status === "ambiguous") {
        errors.push(
          `Plugin reference "${id}" is ambiguous — candidates: ` +
            `${res.candidates.join(", ")}.`
        );
        continue;
      }
      const { id: short } = parseQualifiedId(res.qualified);
      const prior = shortToQualified.get(short);
      if (prior !== undefined && prior !== res.qualified) {
        errors.push(
          `Plugin shortname collision: "${prior}" and "${res.qualified}" ` +
            `both want directory "${short}".`
        );
        continue;
      }
      if (prior === res.qualified) continue;
      shortToQualified.set(short, res.qualified);
      acts.push({ qualified: res.qualified, short });
    }

    if (errors.length > 0) {
      throw new Error(
        errors.length === 1
          ? errors[0]
          : `Plugin activation errors:\n  - ${errors.join("\n  - ")}`
      );
    }
    return acts;
  }

  /**
   * Convert a list of qualified child IDs (already canonicalized at composition
   * time) into qualified+short pairs for filesystem materialization.
   */
  private shortenChildIds(ids: string[]): ChildActivation[] {
    const acts: ChildActivation[] = [];
    const shortToQualified = new Map<string, string>();
    for (const id of ids) {
      const { id: short } = parseQualifiedId(id);
      const prior = shortToQualified.get(short);
      if (prior !== undefined && prior !== id) {
        throw new Error(
          `Shortname collision in plugin contents: "${prior}" and "${id}" ` +
            `both want target name "${short}". Add one to air.json#exclude.`
        );
      }
      if (prior === id) continue;
      shortToQualified.set(short, id);
      acts.push({ qualified: id, short });
    }
    return acts;
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
