import { Command } from "commander";
import { resolveFullArtifacts, stripScopes } from "@pulsemcp/air-sdk";
import { parseGitProtocolFlag } from "./git-protocol.js";

export function resolveCommand(): Command {
  const cmd = new Command("resolve")
    .description(
      "Resolve the active air.json and print the merged artifact tree as JSON to stdout"
    )
    .option(
      "--config <path>",
      "Path to air.json (defaults to AIR_CONFIG env or ~/.air/air.json)"
    )
    .option(
      "--json",
      "Emit JSON output (default and currently the only supported format; accepted for forward-compat)"
    )
    .option(
      "--no-scope",
      "Emit shortname-keyed output instead of the default qualified-ID (@scope/id) keys. Hard-fails if any shortname is contributed by more than one scope. Use only when committed to a single-scope universe."
    )
    .option(
      "--git-protocol <protocol>",
      "Protocol used by git-based catalog providers: \"ssh\" (default) or \"https\". Overrides the gitProtocol field in air.json."
    )
    .action(
      async (options: {
        config?: string;
        json?: boolean;
        scope?: boolean;
        gitProtocol?: string;
      }) => {
        const gitProtocol = parseGitProtocolFlag(options.gitProtocol);
        try {
          const artifacts = await resolveFullArtifacts({
            config: options.config,
            gitProtocol,
          });
          // Commander's `--no-scope` sets `options.scope` to false.
          const output =
            options.scope === false ? stripScopes(artifacts) : artifacts;
          console.log(JSON.stringify(output, null, 2));
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error(`Error: ${message}`);
          process.exit(1);
        }
      }
    );

  return cmd;
}
