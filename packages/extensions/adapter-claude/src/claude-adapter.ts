import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  rmSync,
  statSync,
} from "fs";
import { join, dirname, relative } from "path";
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
  LocalArtifacts,
  QualifiedId,
} from "@pulsemcp/air-core";
import {
  buildManifest,
  diffManifest,
  loadManifest,
  writeManifest,
  parseQualifiedId,
  resolveReference,
} from "@pulsemcp/air-core";
import { scanLocalSkills } from "./scan-local-skills.js";

/**
 * A single activated artifact: the qualified ID resolved from input, plus the
 * bare shortname used for filesystem materialization (skill dir, MCP key, etc).
 */
interface Activation {
  qualified: QualifiedId;
  short: string;
}

export class ClaudeAdapter implements AgentAdapter {
  name = "claude";
  displayName = "Claude Code";

  /**
   * Map AIR lifecycle event names to Claude Code settings.json hook event names.
   * Events without a direct Claude Code equivalent (e.g. pre_commit, post_commit)
   * are omitted — the adapter skips unknown events rather than mapping them to
   * lossy alternatives. Users should use pre_tool_call with a matcher instead.
   */
  private static readonly AIR_TO_CLAUDE_EVENT: Record<string, string> = {
    session_start: "SessionStart",
    session_end: "SessionEnd",
    pre_tool_call: "PreToolUse",
    post_tool_call: "PostToolUse",
    notification: "Notification",
  };

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
    const pluginActivations = root?.default_plugins
      ? this.resolveActivations(artifacts.plugins, root.default_plugins, "plugin")
      : [];
    const plugins: Record<string, PluginEntry> = {};
    for (const a of pluginActivations) plugins[a.qualified] = artifacts.plugins[a.qualified];

    // Merge plugin-declared MCP servers and skills into root defaults (additive).
    // All incoming IDs are qualified (post-canonicalization at composition time),
    // so we deduplicate on qualified IDs.
    const mcpQualSet = new Set<string>(root?.default_mcp_servers ?? []);
    const skillQualSet = new Set<string>(root?.default_skills ?? []);
    for (const plugin of Object.values(plugins)) {
      if (plugin.mcp_servers) {
        for (const id of plugin.mcp_servers) mcpQualSet.add(id);
      }
      if (plugin.skills) {
        for (const id of plugin.skills) skillQualSet.add(id);
      }
    }

    const mcpActivations = this.resolveActivations(
      artifacts.mcp,
      [...mcpQualSet],
      "MCP server"
    );
    const skillActivations = this.resolveActivations(
      artifacts.skills,
      [...skillQualSet],
      "skill"
    );

    const mcpServers: Record<string, McpServerEntry> = {};
    for (const a of mcpActivations) mcpServers[a.short] = artifacts.mcp[a.qualified];
    const mcpConfig = this.translateMcpServersByShort(mcpServers);

    const pluginConfigs = pluginActivations.map((a) =>
      this.translatePlugin(a.short, artifacts.plugins[a.qualified])
    );

    const skillPaths = skillActivations.map((a) => artifacts.skills[a.qualified].path);

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
   * Inputs to activation lists (root defaults, overrides, plugin-declared
   * primitives) are accepted as either qualified (`@scope/id`) or short form;
   * ambiguous short forms are rejected. Filesystem materialization uses
   * shortnames — Claude's `.mcp.json`, `.claude/skills/`, `.claude/hooks/`,
   * and the manifest are scope-naive. Two activated qualified IDs that share
   * a shortname hard-fail with a clear "add one to exclude" message.
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

    const prevManifest = loadManifest(targetDir);

    // 1. Resolve which artifacts to activate (overrides take precedence over root defaults)
    let mcpServerIds: string[] | undefined =
      options?.mcpServerOverrides ?? root?.default_mcp_servers ?? undefined;
    let skillIds: string[] = options?.skillOverrides ?? root?.default_skills ?? [];
    let hookIds: string[] = options?.hookOverrides ?? root?.default_hooks ?? [];

    // 1b. Merge subagent roots' artifacts if applicable.
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

    // 1c. Resolve plugins and merge their declared artifacts (additive)
    const pluginIds = options?.pluginOverrides ?? root?.default_plugins ?? undefined;
    const pluginActivations = pluginIds?.length
      ? this.resolveActivations(artifacts.plugins, pluginIds, "plugin")
      : [];
    const plugins: Record<string, PluginEntry> = {};
    for (const a of pluginActivations) plugins[a.qualified] = artifacts.plugins[a.qualified];

    const mcpSet = new Set<string>(mcpServerIds ?? []);
    const skillSet = new Set<string>(skillIds);
    const hookSet = new Set<string>(hookIds);
    for (const plugin of Object.values(plugins)) {
      if (plugin.mcp_servers) for (const id of plugin.mcp_servers) mcpSet.add(id);
      if (plugin.skills) for (const id of plugin.skills) skillSet.add(id);
      if (plugin.hooks) for (const id of plugin.hooks) hookSet.add(id);
    }
    if (mcpSet.size > 0 || mcpServerIds !== undefined) mcpServerIds = [...mcpSet];
    skillIds = [...skillSet];
    hookIds = [...hookSet];

    // 2. Resolve activations: qualified ID + shortname per artifact.
    //    Throws on unknown IDs, ambiguous shortnames, and shortname collisions.
    const skillActs = this.resolveActivations(artifacts.skills, skillIds, "skill");
    const mcpActs = mcpServerIds
      ? this.resolveActivations(artifacts.mcp, mcpServerIds, "MCP server")
      : [];
    const hookActs = this.resolveActivations(artifacts.hooks, hookIds, "hook");

    const skillShortIds = skillActs.map((a) => a.short);
    const hookShortIds = hookActs.map((a) => a.short);
    const mcpShortIds = mcpActs.map((a) => a.short);

    // 3. Reconcile against prior manifest using shortnames — those are the keys
    //    used for filesystem materialization and stored in the manifest.
    const diff = diffManifest(prevManifest, {
      skills: skillShortIds,
      hooks: hookShortIds,
      mcpServers: mcpShortIds,
    });

    for (const staleSkillId of diff.staleSkills) {
      const staleDir = join(targetDir, ".claude", "skills", staleSkillId);
      if (existsSync(staleDir)) {
        rmSync(staleDir, { recursive: true, force: true });
      }
    }

    for (const staleHookId of diff.staleHooks) {
      const staleDir = join(targetDir, ".claude", "hooks", staleHookId);
      if (existsSync(staleDir)) {
        rmSync(staleDir, { recursive: true, force: true });
      }
    }

    // 4. Write .mcp.json (${VAR} patterns are left as-is for transforms to resolve).
    const mcpConfigPath = join(targetDir, ".mcp.json");
    const translatedServers: Record<string, McpServerEntry> = {};
    for (const a of mcpActs) translatedServers[a.short] = artifacts.mcp[a.qualified];
    const mcpConfig = this.mergeMcpConfig(
      mcpConfigPath,
      this.translateMcpServersByShort(translatedServers),
      diff.staleMcpServers
    );
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    configFiles.push(mcpConfigPath);

    // 5. Inject skills + references into .claude/skills/<short>/
    for (const a of skillActs) {
      const skill = artifacts.skills[a.qualified];

      const skillTargetDir = join(targetDir, ".claude", "skills", a.short);

      if (existsSync(skillTargetDir)) continue;

      const skillSourceDir = skill.path;
      if (existsSync(skillSourceDir)) {
        this.copyDirRecursive(skillSourceDir, skillTargetDir);
        skillPaths.push(skillTargetDir);
      }

      if (skill.references && skill.references.length > 0) {
        this.copyReferences(skill.references, skillTargetDir, artifacts);
      }
    }

    // 6. Validate and inject path-based hooks into .claude/hooks/<short>/.
    const prevHookIds = new Set(prevManifest?.hooks ?? []);
    const registeredHookShortIds: string[] = [];
    for (const a of hookActs) {
      const hook = artifacts.hooks[a.qualified];

      const hookTargetDir = join(targetDir, ".claude", "hooks", a.short);
      const alreadyExists = existsSync(hookTargetDir);

      if (alreadyExists && !prevHookIds.has(a.short)) {
        continue;
      }

      if (!alreadyExists) {
        const hookSourceDir = hook.path;
        if (!existsSync(hookSourceDir)) continue;
        this.copyDirRecursive(hookSourceDir, hookTargetDir);
        if (hook.references && hook.references.length > 0) {
          this.copyReferences(hook.references, hookTargetDir, artifacts);
        }
      }

      hookPaths.push(hookTargetDir);
      registeredHookShortIds.push(a.short);
    }

    // 7. Register AIR-owned hooks in .claude/settings.json.
    const managedHookIds = new Set<string>([
      ...diff.staleHooks,
      ...registeredHookShortIds,
    ]);
    const settingsPath = this.reconcileSettingsHooks(
      targetDir,
      hookPaths,
      managedHookIds
    );
    if (settingsPath) {
      configFiles.push(settingsPath);
    }

    // 8. Persist the updated manifest (shortnames — keyed by filesystem dir).
    writeManifest(
      buildManifest(targetDir, {
        skills: skillShortIds,
        hooks: registeredHookShortIds,
        mcpServers: mcpShortIds,
      })
    );

    // 9. Generate ephemeral subagent context for system prompt
    let subagentContext: string | undefined;
    if (subagentRoots.length > 0) {
      subagentContext = this.buildSubagentContext(subagentRoots);
    }

    // 10. Build start command
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
   * Enumerate skills checked into `<targetDir>/.claude/skills/`. These are
   * loaded by Claude Code directly from the filesystem regardless of AIR's
   * involvement, so they're always active and must not be overwritten or
   * removed. The TUI uses this list to surface them as read-only entries.
   */
  async listLocalArtifacts(targetDir: string): Promise<LocalArtifacts> {
    return { skills: scanLocalSkills(targetDir) };
  }

  /**
   * Resolve subagent roots from the root's default_subagent_roots.
   * IDs are already qualified after composition-time canonicalization.
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
      const res = resolveReference(artifacts.roots, id, undefined);
      if (res.status === "ok") {
        resolved.push(artifacts.roots[res.qualified]);
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
      mcpServerIds:
        parentMcpServerIds !== undefined || mcpSet.size > 0 ? [...mcpSet] : undefined,
      skillIds: [...skillSet],
    };
  }

  /**
   * Build a system prompt section describing the subagent root dependencies.
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

  /**
   * Translate a shortname-keyed MCP server map into Claude's `.mcp.json` shape.
   * Callers convert qualified IDs to shortnames before invoking this — Claude's
   * config is scope-naive.
   */
  translateMcpServersByShort(
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
    if (oauth.authServerMetadataUrl) {
      result.authServerMetadataUrl = oauth.authServerMetadataUrl;
    }
    if (oauth.clientSecret) {
      result.clientSecret = oauth.clientSecret;
    }
    return result;
  }

  /**
   * Translate an AIR plugin to Claude Code plugin format.
   * `name` is the plugin's bare shortname — Claude's plugin namespace is
   * scope-naive.
   */
  translatePlugin(shortId: string, plugin: PluginEntry): Record<string, unknown> {
    return {
      name: shortId,
      description: plugin.description,
      ...(plugin.version && { version: plugin.version }),
    };
  }

  /**
   * Resolve a list of activation IDs (each qualified or short) into qualified
   * IDs paired with shortnames suitable for filesystem materialization.
   *
   * Throws on:
   *   - unknown IDs (after attempting both qualified and short-form lookup)
   *   - ambiguous short references (multiple scopes contribute the shortname)
   *   - shortname collisions in the activation set itself (two qualified IDs
   *     with the same shortname can't share a single .claude/skills/<dir>)
   */
  private resolveActivations<T>(
    pool: Record<string, T>,
    ids: string[],
    artifactType: string
  ): Activation[] {
    const acts: Activation[] = [];
    const errors: string[] = [];
    const shortToQualified = new Map<string, string>();

    for (const id of ids) {
      const res = resolveReference(pool, id, undefined);
      if (res.status === "missing") {
        errors.push(
          `Unknown ${artifactType} ID "${id}". Available: ${this.formatPoolKeys(pool)}.`
        );
        continue;
      }
      if (res.status === "ambiguous") {
        errors.push(
          `${artifactType} reference "${id}" is ambiguous — candidates: ` +
            `${res.candidates.join(", ")}. Use the qualified form to disambiguate.`
        );
        continue;
      }
      const qualified = res.qualified;
      const { id: short } = parseQualifiedId(qualified);
      const prior = shortToQualified.get(short);
      if (prior !== undefined && prior !== qualified) {
        errors.push(
          `${artifactType} shortname collision: both "${prior}" and "${qualified}" ` +
            `are activated and would write to the same target name "${short}". ` +
            `Add one to air.json#exclude or activate only one of them.`
        );
        continue;
      }
      if (prior === qualified) continue; // dedup
      shortToQualified.set(short, qualified);
      acts.push({ qualified, short });
    }

    if (errors.length > 0) {
      throw new Error(
        errors.length === 1 ? errors[0] : `Activation errors:\n  - ${errors.join("\n  - ")}`
      );
    }
    return acts;
  }

  private formatPoolKeys<T>(pool: Record<string, T>): string {
    const keys = Object.keys(pool);
    if (keys.length === 0) return "(none)";
    if (keys.length > 8) {
      return `${keys.slice(0, 8).join(", ")}, … (${keys.length} total)`;
    }
    return keys.join(", ");
  }

  /**
   * Copy referenced documents into a references/ subdirectory of the target.
   * `refIds` are qualified IDs (post-canonicalization).
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

  /**
   * Reconcile `.claude/settings.json` with the current hook selection.
   *
   * Removes any hook entries previously written by AIR (identified via the
   * `_airHookId` marker on each entry) whose ID is in `managedHookIds`,
   * leaving user-authored entries untouched. Then registers the hooks in
   * `newHookPaths` for each mapped event, tagging each new entry with its
   * shortname so future runs can identify it.
   */
  private reconcileSettingsHooks(
    targetDir: string,
    newHookPaths: string[],
    managedHookIds: Set<string>
  ): string | null {
    const settingsPath = join(targetDir, ".claude", "settings.json");
    const settingsExists = existsSync(settingsPath);

    if (!settingsExists && newHookPaths.length === 0) {
      return null;
    }

    let settings: Record<string, unknown> = {};
    if (settingsExists) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      } catch {
        settings = {};
      }
    }

    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

    for (const event of Object.keys(hooks)) {
      const matcherGroups = hooks[event];
      if (!Array.isArray(matcherGroups)) continue;
      const prunedGroups: unknown[] = [];
      for (const group of matcherGroups) {
        if (!group || typeof group !== "object") {
          prunedGroups.push(group);
          continue;
        }
        const g = group as Record<string, unknown>;
        const inner = Array.isArray(g.hooks) ? (g.hooks as unknown[]) : [];
        const keptInner = inner.filter(
          (h) => !this.isManagedHookEntry(h, managedHookIds)
        );
        if (keptInner.length === 0) continue;
        prunedGroups.push({ ...g, hooks: keptInner });
      }
      if (prunedGroups.length === 0) {
        delete hooks[event];
      } else {
        hooks[event] = prunedGroups;
      }
    }

    for (const hookPath of newHookPaths) {
      const hookJsonPath = join(hookPath, "HOOK.json");
      if (!existsSync(hookJsonPath)) continue;

      let hookJson: Record<string, unknown>;
      try {
        hookJson = JSON.parse(readFileSync(hookJsonPath, "utf-8"));
      } catch {
        continue;
      }
      const claudeEvent = ClaudeAdapter.AIR_TO_CLAUDE_EVENT[hookJson.event as string];
      if (!claudeEvent || !hookJson.command) continue;

      const hookRelDir = relative(targetDir, hookPath);
      const command = this.buildHookCommand(
        hookRelDir,
        hookJson.command as string,
        hookJson.args as string[] | undefined
      );

      const hookId = hookPath.split(/[\\/]/).filter(Boolean).pop() || "";

      const hookEntry: Record<string, unknown> = {
        type: "command",
        command,
        _airHookId: hookId,
      };
      if (hookJson.timeout_seconds != null) {
        hookEntry.timeout = hookJson.timeout_seconds;
      }

      const matcherGroup: Record<string, unknown> = {
        matcher: hookJson.matcher ?? "",
        hooks: [hookEntry],
      };

      if (!hooks[claudeEvent]) {
        hooks[claudeEvent] = [];
      }
      (hooks[claudeEvent] as unknown[]).push(matcherGroup);
    }

    if (newHookPaths.length > 0 || Object.keys(hooks).length > 0) {
      settings.hooks = hooks;
    } else {
      delete settings.hooks;
    }

    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return settingsPath;
  }

  private isManagedHookEntry(entry: unknown, managedHookIds: Set<string>): boolean {
    if (!entry || typeof entry !== "object") return false;
    const id = (entry as Record<string, unknown>)._airHookId;
    if (typeof id !== "string") return false;
    return managedHookIds.has(id);
  }

  /**
   * Merge translated MCP server config with an existing `.mcp.json`,
   * preserving user-authored keys. Keys listed in `staleIds` are deleted
   * (they were written by a prior AIR run and are no longer selected),
   * and keys from `translated.mcpServers` are set/replaced for the current
   * selection. Other top-level fields in the existing file pass through.
   */
  private mergeMcpConfig(
    mcpConfigPath: string,
    translated: Record<string, unknown>,
    staleIds: string[]
  ): Record<string, unknown> {
    const translatedServers =
      (translated.mcpServers as Record<string, unknown>) ?? {};

    let existing: Record<string, unknown> = {};
    if (existsSync(mcpConfigPath)) {
      try {
        existing = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
      } catch {
        existing = {};
      }
    }

    const existingServers =
      (existing.mcpServers as Record<string, unknown>) ?? {};

    const mergedServers: Record<string, unknown> = { ...existingServers };
    for (const id of staleIds) {
      delete mergedServers[id];
    }
    for (const [id, config] of Object.entries(translatedServers)) {
      mergedServers[id] = config;
    }

    return {
      ...existing,
      mcpServers: mergedServers,
    };
  }

  /**
   * Build a shell command string from HOOK.json's command and args fields.
   * Resolves relative paths (starting with ./) to be relative to the project root
   * via the hook's installed directory path. Args containing shell metacharacters
   * are single-quoted for safety.
   */
  private buildHookCommand(hookRelDir: string, command: string, args?: string[]): string {
    let cmd = command;
    if (cmd.startsWith("./")) {
      cmd = join(hookRelDir, cmd.slice(2));
    }
    if (args && args.length > 0) {
      const escaped = args.map((a) =>
        /[\s;&|`$"'\\]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a
      );
      cmd += " " + escaped.join(" ");
    }
    return cmd;
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
