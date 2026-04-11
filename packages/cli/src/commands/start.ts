import { spawn } from "child_process";
import { Command } from "commander";
import {
  startSession,
  prepareSession,
  detectRoot,
  type ResolvedArtifacts,
  type RootEntry,
} from "@pulsemcp/air-sdk";
import { runInteractiveSelector } from "../tui/interactive-selector.js";
import { getMergedDefaults } from "../tui/types.js";

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

        // Dry run
        if (options.dryRun) {
          printDryRun(agent, result.artifacts, root, skipSubagentMerge);
          process.exit(0);
        }

        // Check if agent is available
        if (!result.agentAvailable) {
          console.error(
            `Error: ${result.adapterDisplayName} is not installed or not in PATH.`
          );
          process.exit(1);
        }

        // Interactive TUI or skip
        let selectedSkills: string[] | undefined;
        let selectedMcpServers: string[] | undefined;
        let selectedHooks: string[] | undefined;
        let selectedPlugins: string[] | undefined;

        const isTTY = process.stdout.isTTY && process.stdin.isTTY;

        if (isTTY && !options.skipConfirmation) {
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

          selectedSkills = tuiResult.skills;
          selectedMcpServers = tuiResult.mcpServers;
          selectedHooks = tuiResult.hooks;
          selectedPlugins = tuiResult.plugins;
        }

        // Prepare session (write .mcp.json, inject skills, etc.)
        let prepared;
        try {
          prepared = await prepareSession({
            root: rootId,
            target: process.cwd(),
            adapter: agent,
            skills: selectedSkills,
            mcpServers: selectedMcpServers,
            hooks: selectedHooks,
            plugins: selectedPlugins,
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
  skipSubagentMerge = false
) {
  console.log(`\n=== AIR Session Configuration ===`);
  console.log(`Agent: ${agent}`);

  if (root) {
    console.log(`Root: ${root.display_name || root.description}`);
  }

  // Compute merged defaults from subagent roots (unless merge is disabled)
  const merged = skipSubagentMerge
    ? {
        mcpServerIds: root?.default_mcp_servers ?? [],
        skillIds: root?.default_skills ?? [],
        hookIds: root?.default_hooks ?? [],
        pluginIds: root?.default_plugins ?? [],
      }
    : getMergedDefaults(root, artifacts.roots);

  const mcpIds = merged.mcpServerIds.length > 0 ? merged.mcpServerIds : (root?.default_mcp_servers || Object.keys(artifacts.mcp));
  const skillIds = merged.skillIds.length > 0 ? merged.skillIds : (root?.default_skills || Object.keys(artifacts.skills));
  const pluginIds = merged.pluginIds.length > 0 ? merged.pluginIds : (root?.default_plugins || Object.keys(artifacts.plugins));
  const hookIds = merged.hookIds.length > 0 ? merged.hookIds : (root?.default_hooks || Object.keys(artifacts.hooks));

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
