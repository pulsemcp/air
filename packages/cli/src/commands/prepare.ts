import { Command } from "commander";
import { dirname } from "path";
import {
  getAirJsonPath,
  resolveArtifacts,
  type RootEntry,
} from "@pulsemcp/air-core";
import { findAdapter, listAvailableAdapters } from "../adapter-registry.js";

export function prepareCommand(): Command {
  const cmd = new Command("prepare")
    .description(
      "Prepare a target directory for an agent session (write .mcp.json, inject skills) without starting the agent"
    )
    .option(
      "--config <path>",
      "Path to air.json (defaults to AIR_CONFIG env or ~/.air/air.json)"
    )
    .option("--root <name>", "Root to activate (filters artifacts by root defaults)")
    .option(
      "--target <dir>",
      "Target directory to prepare (defaults to cwd)",
      process.cwd()
    )
    .option(
      "--adapter <name>",
      "Agent adapter to use (e.g., claude)",
      "claude"
    )
    .option(
      "--skills <ids>",
      "Comma-separated skill IDs (overrides root defaults)"
    )
    .option(
      "--mcp-servers <ids>",
      "Comma-separated MCP server IDs (overrides root defaults)"
    )
    .action(
      async (options: {
        config?: string;
        root?: string;
        target: string;
        adapter: string;
        skills?: string;
        mcpServers?: string;
      }) => {
        // Find the adapter
        const adapter = await findAdapter(options.adapter);
        if (!adapter) {
          const available = await listAvailableAdapters();
          const availableMsg =
            available.length > 0
              ? `Available: ${available.join(", ")}`
              : "No adapters installed";
          console.error(
            `Error: No adapter found for "${options.adapter}". ${availableMsg}.`
          );
          process.exit(1);
        }

        // Resolve air.json path
        const airJsonPath = options.config || getAirJsonPath();
        if (!airJsonPath) {
          console.error(
            "Error: No air.json found. Specify --config or set AIR_CONFIG env var."
          );
          process.exit(1);
        }

        // Load and resolve all artifacts
        const artifacts = await resolveArtifacts(airJsonPath);
        const baseDir = dirname(airJsonPath);

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

        // Parse overrides
        const skillOverrides = options.skills
          ? options.skills.split(",").map((s) => s.trim())
          : undefined;
        const mcpServerOverrides = options.mcpServers
          ? options.mcpServers.split(",").map((s) => s.trim())
          : undefined;

        // Prepare the session
        const result = await adapter.prepareSession(
          artifacts,
          options.target,
          {
            root,
            baseDir,
            skillOverrides,
            mcpServerOverrides,
          }
        );

        // Output structured JSON to stdout for orchestrator consumption
        console.log(JSON.stringify(result, null, 2));
      }
    );

  return cmd;
}
