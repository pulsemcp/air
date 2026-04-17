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
      "--skill <id...>",
      "Skill ID to ADD on top of root defaults (repeatable: --skill a --skill b, or variadic: --skill a b)"
    )
    .option(
      "--mcp-server <id...>",
      "MCP server ID to ADD on top of root defaults (repeatable or variadic)"
    )
    .option(
      "--hook <id...>",
      "Hook ID to ADD on top of root defaults (repeatable or variadic)"
    )
    .option(
      "--plugin <id...>",
      "Plugin ID to ADD on top of root defaults (repeatable or variadic)"
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
            addSkills: options.skill,
            addMcpServers: options.mcpServer,
            addHooks: options.hook,
            addPlugins: options.plugin,
            removeSkills: options.withoutSkill,
            removeMcpServers: options.withoutMcpServer,
            removeHooks: options.withoutHook,
            removePlugins: options.withoutPlugin,
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
