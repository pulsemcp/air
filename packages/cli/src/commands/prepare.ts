import { Command } from "commander";
import { prepareSession } from "@pulsemcp/air-sdk";

export function prepareCommand(): Command {
  const cmd = new Command("prepare")
    .description(
      "Prepare a target directory for an agent session (write .mcp.json, inject skills) without starting the agent"
    )
    .option(
      "--config <path>",
      "Path to air.json (defaults to AIR_CONFIG env or ~/.air/air.json)"
    )
    .option("--root <name>", "Root to activate (auto-detected from cwd when omitted)")
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
    .option(
      "--no-subagent-merge",
      "Skip merging subagent roots' artifacts into the parent session (for orchestrators that manage composition externally)"
    )
    .action(
      async (options: {
        config?: string;
        root?: string;
        target: string;
        adapter: string;
        skills?: string;
        mcpServers?: string;
        subagentMerge: boolean;
      }) => {
        try {
          const result = await prepareSession({
            config: options.config,
            root: options.root,
            target: options.target,
            adapter: options.adapter,
            skills: options.skills
              ? options.skills.split(",").map((s) => s.trim())
              : undefined,
            mcpServers: options.mcpServers
              ? options.mcpServers.split(",").map((s) => s.trim())
              : undefined,
            skipSubagentMerge: !options.subagentMerge,
          });

          if (result.rootAutoDetected && result.root) {
            console.error(`Auto-detected root: ${result.root.name}`);
          }

          // Output structured JSON to stdout for orchestrator consumption
          console.log(JSON.stringify(result.session, null, 2));
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown error";
          console.error(`Error: ${message}`);
          process.exit(1);
        }
      }
    );

  return cmd;
}
