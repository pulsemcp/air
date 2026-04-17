import { spawn } from "child_process";
import { Command } from "commander";
import {
  startSession,
  prepareSession,
  detectRoot,
  computeMergedDefaults,
  resolveCategoryOverride,
  type ResolvedArtifacts,
  type RootEntry,
} from "@pulsemcp/air-sdk";
import { runInteractiveSelector } from "../tui/interactive-selector.js";

export function startCommand(): Command {
  const cmd = new Command("start")
    .description("Start an agent session with AIR configs loaded")
    .argument("<agent>", "Agent to start (e.g., claude)")
    .option("--root <name>", "Root to start the session in")
    .option("--dry-run", "Show what would be activated without starting")
    .option(
      "--skip-confirmation",
      "Don't prompt for confirmation before starting"
    )
    .option(
      "--skill <id...>",
      "Skill ID to ADD on top of root defaults (repeatable: --skill a --skill b, or variadic: --skill a b). Skips interactive TUI."
    )
    .option(
      "--mcp-server <id...>",
      "MCP server ID to ADD on top of root defaults (repeatable or variadic). Skips interactive TUI."
    )
    .option(
      "--hook <id...>",
      "Hook ID to ADD on top of root defaults (repeatable or variadic). Skips interactive TUI."
    )
    .option(
      "--plugin <id...>",
      "Plugin ID to ADD on top of root defaults (repeatable or variadic). Skips interactive TUI."
    )
    .option(
      "--without-skill <id...>",
      "Skill ID to remove from root defaults (repeatable or variadic)"
    )
    .option(
      "--without-mcp-server <id...>",
      "MCP server ID to remove from root defaults (repeatable or variadic)"
    )
    .option(
      "--without-hook <id...>",
      "Hook ID to remove from root defaults (repeatable or variadic)"
    )
    .option(
      "--without-plugin <id...>",
      "Plugin ID to remove from root defaults (repeatable or variadic)"
    )
    .option(
      "--without-defaults",
      "Ignore all root defaults — start from an empty selection (only artifacts added via --skill / --mcp-server / --hook / --plugin will be activated)"
    )
    .option(
      "--no-subagent-merge",
      "Skip merging subagent roots' artifacts into the parent session (for orchestrators that manage composition externally)"
    )
    .allowUnknownOption(true)
    .action(
      async (
        agent: string,
        options: {
          root?: string;
          dryRun?: boolean;
          skipConfirmation?: boolean;
          skill?: string[];
          mcpServer?: string[];
          hook?: string[];
          plugin?: string[];
          withoutSkill?: string[];
          withoutMcpServer?: string[];
          withoutHook?: string[];
          withoutPlugin?: string[];
          withoutDefaults?: boolean;
          subagentMerge: boolean;
        },
      ) => {
        const dashDashIdx = process.argv.indexOf("--");
        const passthroughArgs =
          dashDashIdx !== -1 ? process.argv.slice(dashDashIdx + 1) : [];

        let result;
        try {
          result = await startSession(agent, {
            root: options.root,
            checkAvailability: !options.dryRun,
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown error";
          console.error(`Error: ${message}`);
          process.exit(1);
        }

        // Print staleness warnings to stderr
        if (result.warnings) {
          for (const warning of result.warnings) {
            console.error(`Warning: ${warning}`);
          }
        }

        // Resolve root: use explicit option, fall back to auto-detection
        let root = result.root;
        let rootId = options.root;
        let rootAutoDetected = false;
        if (!options.root) {
          const detected = detectRoot(result.artifacts.roots, process.cwd());
          if (detected) {
            root = detected;
            rootAutoDetected = true;
            rootId = Object.entries(result.artifacts.roots).find(
              ([, v]) => v === detected
            )?.[0];
          }
        }

        const skipSubagentMerge = !options.subagentMerge;

        // Variadic commander options: `undefined` means the flag was not passed;
        // otherwise we get an array of IDs (supports `--skill a --skill b`,
        // `--skill a b`, or a mix).
        const addSkills = options.skill;
        const addMcpServers = options.mcpServer;
        const addHooks = options.hook;
        const addPlugins = options.plugin;
        const removeSkills = options.withoutSkill;
        const removeMcpServers = options.withoutMcpServer;
        const removeHooks = options.withoutHook;
        const removePlugins = options.withoutPlugin;
        const withoutDefaults = options.withoutDefaults ?? false;

        const hasArtifactFlags =
          addSkills !== undefined ||
          addMcpServers !== undefined ||
          addHooks !== undefined ||
          addPlugins !== undefined ||
          removeSkills !== undefined ||
          removeMcpServers !== undefined ||
          removeHooks !== undefined ||
          removePlugins !== undefined ||
          withoutDefaults;

        // Resolve final per-category overrides using the SDK helper
        const merged = computeMergedDefaults(root, result.artifacts, skipSubagentMerge);
        const selectedSkills = resolveCategoryOverride(
          undefined,
          merged.skillIds,
          addSkills,
          removeSkills,
          withoutDefaults
        );
        const selectedMcpServers = resolveCategoryOverride(
          undefined,
          merged.mcpServerIds,
          addMcpServers,
          removeMcpServers,
          withoutDefaults
        );
        const selectedHooks = resolveCategoryOverride(
          undefined,
          merged.hookIds,
          addHooks,
          removeHooks,
          withoutDefaults
        );
        const selectedPlugins = resolveCategoryOverride(
          undefined,
          merged.pluginIds,
          addPlugins,
          removePlugins,
          withoutDefaults
        );

        // Dry run
        if (options.dryRun) {
          printDryRun(agent, result.artifacts, root, skipSubagentMerge, {
            skills: selectedSkills,
            mcpServers: selectedMcpServers,
            hooks: selectedHooks,
            plugins: selectedPlugins,
          });
          process.exit(0);
        }

        // Check if agent is available
        if (!result.agentAvailable) {
          console.error(
            `Error: ${result.adapterDisplayName} is not installed or not in PATH.`
          );
          process.exit(1);
        }

        const isTTY = process.stdout.isTTY && process.stdin.isTTY;

        let tuiSkills = selectedSkills;
        let tuiMcpServers = selectedMcpServers;
        let tuiHooks = selectedHooks;
        let tuiPlugins = selectedPlugins;

        if (isTTY && !options.skipConfirmation && !hasArtifactFlags) {
          const tuiResult = await runInteractiveSelector(
            result.artifacts,
            root,
            rootId,
            rootAutoDetected,
            skipSubagentMerge
          );

          if (!tuiResult) {
            process.exit(0);
          }

          tuiSkills = tuiResult.skills;
          tuiMcpServers = tuiResult.mcpServers;
          tuiHooks = tuiResult.hooks;
          tuiPlugins = tuiResult.plugins;
        }

        // Prepare session (write .mcp.json, inject skills, etc.)
        let prepared;
        try {
          prepared = await prepareSession({
            root: rootId,
            target: process.cwd(),
            adapter: agent,
            skills: tuiSkills,
            mcpServers: tuiMcpServers,
            hooks: tuiHooks,
            plugins: tuiPlugins,
            skipSubagentMerge,
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown error";
          console.error(`Error preparing session: ${message}`);
          process.exit(1);
        }

        // Spawn the agent
        const startCmd = prepared.session.startCommand;
        const args = [...startCmd.args, ...passthroughArgs];
        const env = { ...process.env, ...startCmd.env };
        const cwd = startCmd.cwd || process.cwd();

        const child = spawn(startCmd.command, args, {
          stdio: "inherit",
          env,
          cwd,
        });

        child.on("error", (err) => {
          console.error(`Failed to start ${agent}: ${err.message}`);
          process.exit(1);
        });

        child.on("exit", (code) => {
          process.exit(code ?? 0);
        });
      }
    );

  return cmd;
}

function printDryRun(
  agent: string,
  artifacts: ResolvedArtifacts,
  root?: RootEntry,
  skipSubagentMerge = false,
  overrides: {
    skills?: string[];
    mcpServers?: string[];
    hooks?: string[];
    plugins?: string[];
  } = {}
) {
  console.log(`\n=== AIR Session Configuration ===`);
  console.log(`Agent: ${agent}`);

  if (root) {
    console.log(`Root: ${root.display_name || root.description}`);
  }

  const merged = computeMergedDefaults(root, artifacts, skipSubagentMerge);

  // CLI overrides take precedence over merged defaults for each category
  const mcpIds = overrides.mcpServers ?? (merged.mcpServerIds.length > 0 ? merged.mcpServerIds : (root?.default_mcp_servers || Object.keys(artifacts.mcp)));
  const skillIds = overrides.skills ?? (merged.skillIds.length > 0 ? merged.skillIds : (root?.default_skills || Object.keys(artifacts.skills)));
  const pluginIds = overrides.plugins ?? (merged.pluginIds.length > 0 ? merged.pluginIds : (root?.default_plugins || Object.keys(artifacts.plugins)));
  const hookIds = overrides.hooks ?? (merged.hookIds.length > 0 ? merged.hookIds : (root?.default_hooks || Object.keys(artifacts.hooks)));

  console.log(`\nMCP Servers (${mcpIds.length}):`);
  for (const id of mcpIds) {
    const server = artifacts.mcp[id];
    if (server) {
      console.log(
        `  \u2022 ${id} \u2014 ${server.description || server.title || "(no description)"}`
      );
    } else {
      console.log(`  \u2022 ${id} \u2014 (not found)`);
    }
  }

  console.log(`\nSkills (${skillIds.length}):`);
  for (const id of skillIds) {
    const skill = artifacts.skills[id];
    if (skill) {
      console.log(`  \u2022 ${id} \u2014 ${skill.description}`);
    } else {
      console.log(`  \u2022 ${id} \u2014 (not found)`);
    }
  }

  if (pluginIds.length > 0) {
    console.log(`\nPlugins (${pluginIds.length}):`);
    for (const id of pluginIds) {
      const plugin = artifacts.plugins[id];
      if (plugin) {
        console.log(`  \u2022 ${id} \u2014 ${plugin.description}`);
      } else {
        console.log(`  \u2022 ${id} \u2014 (not found)`);
      }
    }
  }

  if (hookIds.length > 0) {
    console.log(`\nHooks (${hookIds.length}):`);
    for (const id of hookIds) {
      const hook = artifacts.hooks[id];
      if (hook) {
        console.log(`  \u2022 ${id} \u2014 ${hook.description}`);
      } else {
        console.log(`  \u2022 ${id} \u2014 (not found)`);
      }
    }
  }
}
