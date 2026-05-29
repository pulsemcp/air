import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  rmSync,
  statSync,
} from "fs";
import { join, dirname } from "path";
import type {
  AgentAdapter,
  AgentSessionConfig,
  StartCommand,
  ResolvedArtifacts,
  RootEntry,
  PluginEntry,
  PrepareSessionOptions,
  PreparedSession,
  CleanSessionOptions,
  CleanSessionResult,
  LocalArtifacts,
  QualifiedId,
} from "@pulsemcp/air-core";
import {
  buildManifest,
  deleteManifest,
  diffManifest,
  getManifestPath,
  loadManifest,
  writeManifest,
  parseQualifiedId,
  resolveReference,
} from "@pulsemcp/air-core";
import { scanLocalSkills } from "./scan-local-skills.js";

/**
 * A single activated artifact: the qualified ID resolved from input, plus the
 * bare shortname used for filesystem materialization (the skill directory name).
 */
interface Activation {
  qualified: QualifiedId;
  short: string;
}

/**
 * AIR adapter for the Pi coding agent (`pi`, https://www.npmjs.com/package/@earendil-works/pi-coding-agent).
 *
 * Scope: SKILLS ONLY. Pi does not ship with pre-baked MCP servers, hooks,
 * references, or plugins the way a fuller agent runtime might, so this adapter
 * translates only skills. MCP servers, hooks, and standalone references are
 * intentionally not translated — see `generateConfig` and `prepareSession`.
 *
 * Pi auto-discovers project skills from `<cwd>/.pi/skills/`: any directory
 * containing a `SKILL.md` is treated as a skill root (Pi stops recursing into
 * it, so bundled reference files are safe). This adapter materializes activated
 * skills into `.pi/skills/<name>/` — purely filesystem placement, no config
 * file is written or required for Pi to load them.
 */
export class PiAdapter implements AgentAdapter {
  name = "pi";
  displayName = "Pi";

  async isAvailable(): Promise<boolean> {
    try {
      execSync("which pi", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Translate resolved AIR artifacts into a Pi session config.
   *
   * Skills only: plugin-declared skills are merged into the root's default
   * skills (additive), since AIR plugins are composition sugar. A plugin's
   * MCP servers and hooks are intentionally ignored — Pi is skills-only.
   */
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

    // Merge plugin-declared skills into root defaults (additive). All incoming
    // IDs are qualified (post-canonicalization at composition time), so we
    // deduplicate on qualified IDs.
    const skillQualSet = new Set<string>(root?.default_skills ?? []);
    for (const plugin of Object.values(plugins)) {
      if (plugin.skills) {
        for (const id of plugin.skills) skillQualSet.add(id);
      }
    }

    const skillActivations = this.resolveActivations(
      artifacts.skills,
      [...skillQualSet],
      "skill"
    );
    const skillPaths = skillActivations.map((a) => artifacts.skills[a.qualified].path);

    return {
      agent: "pi",
      skillPaths,
      env: {},
    };
  }

  buildStartCommand(config: AgentSessionConfig): StartCommand {
    // Pi auto-discovers `.pi/skills/` relative to its working directory.
    // Pointing the working directory at the prepared directory loads the
    // injected skills; no extra flags are required.
    return {
      command: "pi",
      args: [],
      env: config.env,
      cwd: config.workDir,
    };
  }

  /**
   * Prepare a working directory for a Pi session.
   *
   * Injects activated skills + their references into `.pi/skills/<name>/`,
   * reconciling against the per-target manifest so re-runs and `air clean`
   * are idempotent. No config file is written: Pi auto-discovers `.pi/skills/`
   * by walking the filesystem, so there is nothing for AIR's JSON transform
   * pipeline to post-process — `configFiles` is returned empty.
   *
   * Inputs to the skill activation list (root defaults, overrides, subagent
   * roots, plugin-declared skills) are accepted as either qualified (`@scope/id`)
   * or short form; ambiguous short forms are rejected. Filesystem
   * materialization uses shortnames — `.pi/skills/` and the manifest are
   * scope-naive. Two activated qualified IDs that share a shortname hard-fail
   * with a clear "add one to exclude" message.
   *
   * MCP servers, hooks, and standalone references are intentionally NOT
   * translated: Pi is skills-only. The manifest records skills only
   * (`hooks: []`, `mcpServers: []`).
   */
  async prepareSession(
    artifacts: ResolvedArtifacts,
    targetDir: string,
    options?: PrepareSessionOptions
  ): Promise<PreparedSession> {
    const root = options?.root;
    const skillPaths: string[] = [];

    const prevManifest = loadManifest(targetDir);

    // 1. Resolve which skills to activate (overrides take precedence over root defaults).
    let skillIds: string[] = options?.skillOverrides ?? root?.default_skills ?? [];

    // 1b. Merge subagent roots' skills if applicable.
    const subagentRoots = this.resolveSubagentRoots(root, artifacts, options);
    if (subagentRoots.length > 0 && !options?.skillOverrides) {
      skillIds = this.mergeSubagentSkills(subagentRoots, skillIds);
    }

    // 1c. Resolve plugins and merge their declared skills (additive). A plugin's
    //     MCP servers and hooks are intentionally ignored — Pi is skills-only.
    const pluginIds = options?.pluginOverrides ?? root?.default_plugins ?? undefined;
    const pluginActivations = pluginIds?.length
      ? this.resolveActivations(artifacts.plugins, pluginIds, "plugin")
      : [];
    const skillSet = new Set<string>(skillIds);
    for (const a of pluginActivations) {
      const plugin = artifacts.plugins[a.qualified];
      if (plugin.skills) for (const id of plugin.skills) skillSet.add(id);
    }
    skillIds = [...skillSet];

    // 2. Resolve activations: qualified ID + shortname per skill.
    //    Throws on unknown IDs, ambiguous shortnames, and shortname collisions.
    const skillActs = this.resolveActivations(artifacts.skills, skillIds, "skill");
    const skillShortIds = skillActs.map((a) => a.short);

    // 3. Reconcile against prior manifest using shortnames — those are the keys
    //    used for filesystem materialization and stored in the manifest.
    const diff = diffManifest(prevManifest, {
      skills: skillShortIds,
      hooks: [],
      mcpServers: [],
    });

    for (const staleSkillId of diff.staleSkills) {
      const staleDir = join(targetDir, ".pi", "skills", staleSkillId);
      if (existsSync(staleDir)) {
        rmSync(staleDir, { recursive: true, force: true });
      }
    }

    // 4. Inject skills + references into .pi/skills/<short>/.
    const materializedSkillShortIds: string[] = [];
    for (const a of skillActs) {
      const skill = artifacts.skills[a.qualified];

      const skillTargetDir = join(targetDir, ".pi", "skills", a.short);

      if (existsSync(skillTargetDir)) {
        materializedSkillShortIds.push(a.short);
        continue;
      }

      const skillSourceDir = skill.path;
      if (!existsSync(skillSourceDir)) {
        console.warn(this.missingSourceDirMessage("skill", a.qualified, skillSourceDir));
        continue;
      }
      this.copyDirRecursive(skillSourceDir, skillTargetDir);
      skillPaths.push(skillTargetDir);
      materializedSkillShortIds.push(a.short);

      if (skill.references && skill.references.length > 0) {
        this.copyReferences(skill.references, skillTargetDir, artifacts);
      }
    }

    // 5. Persist the updated manifest (shortnames — keyed by filesystem dir).
    //    Only record skills that were actually materialized so the manifest
    //    does not claim ownership of artifacts AIR skipped (e.g. a missing
    //    source dir). Hooks and MCP servers are always empty for Pi.
    writeManifest(
      buildManifest(targetDir, {
        adapter: this.name,
        skills: materializedSkillShortIds,
        hooks: [],
        mcpServers: [],
      })
    );

    // 6. Generate ephemeral subagent context for the session. Pi loads skills
    //    from the filesystem and has no AIR-driven system-prompt flag wired by
    //    this adapter, so subagent context is surfaced to the caller via
    //    `subagentContext` rather than the start command.
    let subagentContext: string | undefined;
    if (subagentRoots.length > 0) {
      subagentContext = this.buildSubagentContext(subagentRoots);
    }

    // 7. Build start command (working directory = prepared directory).
    //    `root` is passed as `undefined` here on purpose: skill activation
    //    (root defaults + overrides + subagent + plugin skills) was already
    //    resolved and materialized above, so we only need `generateConfig` for
    //    the agent name + env that `buildStartCommand` consumes. Passing `root`
    //    would redundantly re-resolve skill paths from defaults alone, ignoring
    //    the overrides applied in this call.
    const config = this.generateConfig(artifacts, undefined, targetDir);
    const startCommand = this.buildStartCommand({
      ...config,
      workDir: targetDir,
    });

    return {
      // Empty by design — Pi discovers `.pi/skills/` from the filesystem, so
      // there is no JSON config file for AIR's transform pipeline to process.
      configFiles: [],
      skillPaths,
      // Pi is skills-only: no hooks are ever materialized.
      hookPaths: [],
      startCommand,
      subagentContext,
    };
  }

  /**
   * Enumerate skills checked into `<targetDir>/.pi/skills/`. Pi loads these
   * directly from the filesystem regardless of AIR's involvement, so they're
   * always active and must not be overwritten or removed. The TUI uses this
   * list to surface them as read-only entries.
   */
  async listLocalArtifacts(targetDir: string): Promise<LocalArtifacts> {
    return { skills: scanLocalSkills(targetDir) };
  }

  /**
   * Remove every skill AIR has previously written into `targetDir`.
   *
   * Reads the per-target manifest and deletes each tracked skill directory
   * under `.pi/skills/`. Pi is skills-only, so there are no hooks, MCP servers,
   * or settings files to prune. When skills are cleaned (the only category that
   * can hold entries), the manifest itself is deleted; a partial clean
   * (`keepSkills`) updates the manifest with the kept entries instead.
   *
   * Items in the manifest that no longer exist on disk are silently skipped —
   * the manifest can drift if a user removed files manually between runs.
   */
  async cleanSession(
    targetDir: string,
    options?: CleanSessionOptions
  ): Promise<CleanSessionResult> {
    const dryRun = options?.dryRun ?? false;
    const cleanSkills = !(options?.keepSkills ?? false);
    const cleanHooks = !(options?.keepHooks ?? false);
    const cleanMcpServers = !(options?.keepMcpServers ?? false);
    // Pi only ever tracks skills, but honor the same "full clean" predicate as
    // other adapters so a caller that keeps any category preserves the manifest.
    const fullClean = cleanSkills && cleanHooks && cleanMcpServers;

    const manifestPath = getManifestPath(targetDir);
    const manifestFileExists = existsSync(manifestPath);
    const manifest = loadManifest(targetDir);
    if (!manifest) {
      let corruptManifestRemoved = false;
      if (manifestFileExists && fullClean && !dryRun) {
        corruptManifestRemoved = deleteManifest(targetDir);
      }
      return {
        removedSkills: [],
        removedHooks: [],
        removedMcpServers: [],
        mcpConfigPath: null,
        settingsPath: null,
        manifestPath,
        manifestExisted: manifestFileExists,
        manifestRemoved: corruptManifestRemoved,
      };
    }

    const removedSkills: string[] = [];
    if (cleanSkills) {
      for (const id of manifest.skills) {
        const dir = join(targetDir, ".pi", "skills", id);
        if (!existsSync(dir)) continue;
        if (!dryRun) rmSync(dir, { recursive: true, force: true });
        removedSkills.push(id);
      }
    }

    let manifestRemoved = false;
    if (fullClean) {
      if (!dryRun) {
        manifestRemoved = deleteManifest(targetDir);
      } else {
        manifestRemoved = manifestFileExists;
      }
    } else if (!dryRun) {
      writeManifest(
        buildManifest(targetDir, {
          adapter: manifest.adapter ?? this.name,
          skills: cleanSkills ? [] : manifest.skills,
          hooks: [],
          mcpServers: [],
        })
      );
    }

    return {
      removedSkills,
      // Pi is skills-only: hooks and MCP servers are never materialized.
      removedHooks: [],
      removedMcpServers: [],
      mcpConfigPath: null,
      settingsPath: null,
      manifestPath,
      manifestExisted: true,
      manifestRemoved,
    };
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
   * Merge subagent roots' default_skills into the parent's activated skills
   * (union, preserving order with parent first). MCP servers are not merged —
   * Pi is skills-only.
   */
  private mergeSubagentSkills(
    subagentRoots: RootEntry[],
    parentSkillIds: string[]
  ): string[] {
    const skillSet = new Set(parentSkillIds);
    for (const sub of subagentRoots) {
      if (sub.default_skills) {
        for (const id of sub.default_skills) skillSet.add(id);
      }
    }
    return [...skillSet];
  }

  /**
   * Build a system prompt section describing the subagent root dependencies.
   * Skills-scoped: MCP servers are not surfaced because Pi is skills-only.
   */
  private buildSubagentContext(subagentRoots: RootEntry[]): string {
    const lines: string[] = [
      "## Subagent Root Dependencies",
      "",
      "This session includes capabilities from the following subagent roots.",
      "Their skills have been merged into your session.",
      "",
    ];

    for (const sub of subagentRoots) {
      lines.push(`### ${sub.display_name || "Subagent"}`);
      lines.push("");
      lines.push(`**Description**: ${sub.description}`);
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
   * Resolve a list of activation IDs (each qualified or short) into qualified
   * IDs paired with shortnames suitable for filesystem materialization.
   *
   * Throws on:
   *   - unknown IDs (after attempting both qualified and short-form lookup)
   *   - ambiguous short references (multiple scopes contribute the shortname)
   *   - shortname collisions in the activation set itself (two qualified IDs
   *     with the same shortname can't share a single materialization dir)
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

  /**
   * Build the warning emitted when a registered skill's `path` does not exist
   * on disk at materialization time. The qualified ID encodes the declaring
   * catalog's scope, so a reviewer can trace the offending entry back to its
   * index file. Materialization is skipped for this skill and the rest of the
   * session proceeds.
   */
  private missingSourceDirMessage(
    artifactType: "skill",
    qualified: string,
    resolvedPath: string
  ): string {
    return (
      `warning: ${artifactType} "${qualified}" declares path "${resolvedPath}" but that directory does not exist — skipping. ` +
      `The catalog that contributed "${qualified}" registered a path AIR cannot materialize. ` +
      `Fix the \`path\` field in the catalog's index file (or exclude the artifact in air.json) to restore the ${artifactType}.`
    );
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
   * Copy referenced documents into a references/ subdirectory of the skill.
   * `refIds` are qualified IDs (post-canonicalization). Pi treats the skill
   * directory as a self-contained root, so bundled references travel with it.
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
