import { dirname, resolve } from "path";
import { Command } from "commander";
import {
  prepareSession,
  loadAirConfig,
  getAirJsonPath,
  loadExtensions,
} from "@pulsemcp/air-sdk";

/**
 * Extract the flag name from a Commander flag string.
 * E.g., "--secrets-file <path>" → "secrets-file"
 */
function extractFlagName(flag: string): string {
  const match = flag.match(/--([a-zA-Z0-9-]+)/);
  return match ? match[1] : flag;
}

/**
 * Parse an extension-contributed flag value from process.argv.
 * Supports both `--flag value` and `--flag=value` syntax.
 * Returns undefined if the flag is not present.
 */
function parseArgvFlag(flagName: string): string | undefined {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    // --flag=value syntax
    if (args[i].startsWith(`--${flagName}=`)) {
      return args[i].slice(`--${flagName}=`.length);
    }
    // --flag value syntax
    if (args[i] === `--${flagName}` && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return undefined;
}

function parseIdList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function prepareCommand(): Command {
  const cmd = new Command("prepare")
    .description(
      "Prepare a target directory for an agent session (write .mcp.json, inject skills) without starting the agent"
    )
    .argument("<adapter>", "Agent adapter to use (e.g., claude)")
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
      "--skills <ids>",
      "Comma-separated skill IDs to ADD on top of root defaults"
    )
    .option(
      "--mcp-servers <ids>",
      "Comma-separated MCP server IDs to ADD on top of root defaults"
    )
    .option(
      "--hooks <ids>",
      "Comma-separated hook IDs to ADD on top of root defaults"
    )
    .option(
      "--plugins <ids>",
      "Comma-separated plugin IDs to ADD on top of root defaults"
    )
    .option(
      "--without-skills <ids>",
      "Comma-separated skill IDs to remove from root defaults"
    )
    .option(
      "--without-mcp-servers <ids>",
      "Comma-separated MCP server IDs to remove from root defaults"
    )
    .option(
      "--without-hooks <ids>",
      "Comma-separated hook IDs to remove from root defaults"
    )
    .option(
      "--without-plugins <ids>",
      "Comma-separated plugin IDs to remove from root defaults"
    )
    .option(
      "--without-defaults",
      "Ignore all root defaults — start from an empty selection (only artifacts added via --skills / --mcp-servers / --hooks / --plugins will be activated)"
    )
    .option(
      "--no-subagent-merge",
      "Skip merging subagent roots' artifacts into the parent session (for orchestrators that manage composition externally)"
    )
    .option(
      "--skip-validation",
      "Skip final validation for unresolved ${VAR} patterns (for orchestrators that resolve variables themselves)"
    )
    .allowUnknownOption(true)
    .action(
      async (adapter: string, options: {
        config?: string;
        root?: string;
        target: string;
        skills?: string;
        mcpServers?: string;
        hooks?: string;
        plugins?: string;
        withoutSkills?: string;
        withoutMcpServers?: string;
        withoutHooks?: string;
        withoutPlugins?: string;
        withoutDefaults?: boolean;
        subagentMerge: boolean;
        skipValidation?: boolean;
      }) => {
        try {
          // Load extensions once — pass to SDK to avoid double loading
          const airJsonPath = options.config || getAirJsonPath();
          const extensionOptions: Record<string, unknown> = {};
          let loadedExtensions;

          if (airJsonPath) {
            const airConfig = loadAirConfig(airJsonPath);
            if (airConfig.extensions?.length) {
              const airJsonDir = dirname(resolve(airJsonPath));
              loadedExtensions = await loadExtensions(
                airConfig.extensions,
                airJsonDir
              );

              // Parse extension-contributed CLI options from process.argv
              for (const ext of loadedExtensions.all) {
                if (!ext.prepareOptions) continue;
                for (const opt of ext.prepareOptions) {
                  const flagName = extractFlagName(opt.flag);
                  const value = parseArgvFlag(flagName);
                  if (value !== undefined) {
                    extensionOptions[flagName] = value;
                  } else if (opt.defaultValue !== undefined) {
                    extensionOptions[flagName] = opt.defaultValue;
                  }
                }
              }
            }
          }

          const result = await prepareSession({
            config: options.config,
            root: options.root,
            target: options.target,
            adapter,
            addSkills: parseIdList(options.skills),
            addMcpServers: parseIdList(options.mcpServers),
            addHooks: parseIdList(options.hooks),
            addPlugins: parseIdList(options.plugins),
            removeSkills: parseIdList(options.withoutSkills),
            removeMcpServers: parseIdList(options.withoutMcpServers),
            removeHooks: parseIdList(options.withoutHooks),
            removePlugins: parseIdList(options.withoutPlugins),
            withoutDefaults: options.withoutDefaults,
            skipSubagentMerge: !options.subagentMerge,
            skipValidation: options.skipValidation,
            extensionOptions,
            extensions: loadedExtensions,
          });

          if (result.rootAutoDetected && result.root) {
            console.error(`Auto-detected root: ${result.root.display_name || result.root.description}`);
          }

          // Print staleness warnings to stderr
          if (result.warnings) {
            for (const warning of result.warnings) {
              console.error(`Warning: ${warning}`);
            }
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
