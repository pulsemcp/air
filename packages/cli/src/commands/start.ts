import { Command } from "commander";
import {
  getAirJsonPath,
  resolveArtifacts,
  emptyArtifacts,
  type ResolvedArtifacts,
  type RootEntry,
} from "@pulsemcp/air-core";
import { findAdapter, listAvailableAdapters } from "../adapter-registry.js";

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
        // Try to find the adapter
        const adapter = await findAdapter(agent);
        if (!adapter) {
          const available = await listAvailableAdapters();
          const availableMsg =
            available.length > 0
              ? `Available: ${available.join(", ")}`
              : "No adapters installed";
          console.error(
            `Error: No adapter found for "${agent}". ${availableMsg}.\n` +
              `Install an adapter: npm install @pulsemcp/air-adapter-${agent}`
          );
          process.exit(1);
        }

        // Load air.json
        const airJsonPath = getAirJsonPath();
        const artifacts = airJsonPath
          ? await resolveArtifacts(airJsonPath)
          : emptyArtifacts();

        // Resolve root if specified
        let root: RootEntry | undefined;
        if (options.root) {
          root = artifacts.roots[options.root];
          if (!root) {
            console.error(
              `Error: Root "${options.root}" not found. Available roots: ${Object.keys(artifacts.roots).join(", ") || "(none)"}`
            );
            process.exit(1);
          }
        }

        // Generate config
        const sessionConfig = adapter.generateConfig(artifacts, root);

        // Dry run
        if (options.dryRun) {
          printDryRun(agent, artifacts, root);
          process.exit(0);
        }

        // Check if agent is available
        const available = await adapter.isAvailable();
        if (!available) {
          console.error(
            `Error: ${adapter.displayName} is not installed or not in PATH.`
          );
          process.exit(1);
        }

        printDryRun(agent, artifacts, root);

        const startCmd = adapter.buildStartCommand(sessionConfig);

        console.log(`\nStarting ${adapter.displayName}...`);
        console.log(
          `Command: ${startCmd.command} ${startCmd.args.join(" ")}`
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
