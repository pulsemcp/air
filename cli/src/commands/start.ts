import { Command } from "commander";
import {
  getAirJsonPath,
  resolveArtifacts,
  emptyArtifacts,
  type ResolvedArtifacts,
  type RootEntry,
} from "../lib/config.js";
import { ClaudeAdapter } from "../lib/agents/claude.js";
import {
  isAgentKnown,
  isAgentSupported,
  COMING_SOON_AGENTS,
  type AgentType,
} from "../lib/agents/types.js";

export function startCommand(): Command {
  const cmd = new Command("start")
    .description("Start an agent session with AIR configs loaded")
    .argument("<agent>", "Agent to start (claude, opencode, cursor, pi)")
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
        // Check if agent is known
        if (!isAgentKnown(agent)) {
          console.error(
            `Error: Unknown agent "${agent}". Supported: claude. Coming soon: ${COMING_SOON_AGENTS.join(", ")}`
          );
          process.exit(1);
        }

        // Check if agent is supported
        if (!isAgentSupported(agent)) {
          console.error(
            `Error: "${agent}" is not yet supported. Coming soon! Currently supported: claude`
          );
          process.exit(1);
        }

        // Load air.json from ~/.air/air.json (or AIR_CONFIG override)
        const airJsonPath = getAirJsonPath();
        const artifacts = airJsonPath
          ? resolveArtifacts(airJsonPath)
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

        // Get the adapter
        const adapter = getAdapter(agent as AgentType);

        // Generate config
        const sessionConfig = adapter.generateConfig(
          artifacts,
          root
        );

        // Dry run — just show what would be activated
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

        // Print summary
        printDryRun(agent, artifacts, root);

        // Build start command
        const startCmd = adapter.buildStartCommand(sessionConfig);

        console.log(
          `\nStarting ${adapter.displayName}...`
        );
        console.log(`Command: ${startCmd.command} ${startCmd.args.join(" ")}`);

        if (!options.skipConfirmation && !options.dryRun) {
          // In a real implementation, we'd prompt here
          // For now, just proceed
        }
      }
    );

  return cmd;
}

function getAdapter(agent: AgentType) {
  switch (agent) {
    case "claude":
      return new ClaudeAdapter();
    default:
      throw new Error(`No adapter for agent: ${agent}`);
  }
}

function printDryRun(
  agent: string,
  artifacts: ResolvedArtifacts,
  root?: RootEntry
) {
  console.log(`\n=== AIR Session Configuration ===`);
  console.log(`Agent: ${agent}`);

  if (root) {
    console.log(`Root: ${root.name} — ${root.description}`);
  }

  const mcpIds = root?.default_mcp_servers || Object.keys(artifacts.mcp);
  const skillIds = root?.default_skills || Object.keys(artifacts.skills);
  const pluginIds = root?.default_plugins || Object.keys(artifacts.plugins);
  const hookIds = root?.default_hooks || Object.keys(artifacts.hooks);

  console.log(`\nMCP Servers (${mcpIds.length}):`);
  for (const id of mcpIds) {
    const server = artifacts.mcp[id];
    if (server) {
      console.log(`  • ${id} — ${server.description || server.title || "(no description)"}`);
    } else {
      console.log(`  • ${id} — (not found)`);
    }
  }

  console.log(`\nSkills (${skillIds.length}):`);
  for (const id of skillIds) {
    const skill = artifacts.skills[id];
    if (skill) {
      console.log(`  • ${id} — ${skill.description}`);
    } else {
      console.log(`  • ${id} — (not found)`);
    }
  }

  if (pluginIds.length > 0) {
    console.log(`\nPlugins (${pluginIds.length}):`);
    for (const id of pluginIds) {
      const plugin = artifacts.plugins[id];
      if (plugin) {
        console.log(`  • ${id} — ${plugin.description}`);
      } else {
        console.log(`  • ${id} — (not found)`);
      }
    }
  }

  if (hookIds.length > 0) {
    console.log(`\nHooks (${hookIds.length}):`);
    for (const id of hookIds) {
      const hook = artifacts.hooks[id];
      if (hook) {
        console.log(`  • ${id} — ${hook.description}`);
      } else {
        console.log(`  • ${id} — (not found)`);
      }
    }
  }
}
