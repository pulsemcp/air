import { Command } from "commander";
import {
  startSession,
  type ResolvedArtifacts,
  type RootEntry,
} from "@pulsemcp/air-sdk";

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
    .action(
      async (
        agent: string,
        options: {
          root?: string;
          dryRun?: boolean;
          skipConfirmation?: boolean;
        }
      ) => {
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

        // Dry run
        if (options.dryRun) {
          printDryRun(agent, result.artifacts, result.root);
          process.exit(0);
        }

        // Check if agent is available
        if (!result.agentAvailable) {
          console.error(
            `Error: ${result.adapterDisplayName} is not installed or not in PATH.`
          );
          process.exit(1);
        }

        printDryRun(agent, result.artifacts, result.root);

        console.log(`\nStarting ${result.adapterDisplayName}...`);
        console.log(
          `Command: ${result.startCommand.command} ${result.startCommand.args.join(" ")}`
        );
      }
    );

  return cmd;
}

function printDryRun(
  agent: string,
  artifacts: ResolvedArtifacts,
  root?: RootEntry
) {
  console.log(`\n=== AIR Session Configuration ===`);
  console.log(`Agent: ${agent}`);

  if (root) {
    console.log(`Root: ${root.name} \u2014 ${root.description}`);
  }

  const mcpIds = root?.default_mcp_servers || Object.keys(artifacts.mcp);
  const skillIds = root?.default_skills || Object.keys(artifacts.skills);
  const pluginIds = root?.default_plugins || Object.keys(artifacts.plugins);
  const hookIds = root?.default_hooks || Object.keys(artifacts.hooks);

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
