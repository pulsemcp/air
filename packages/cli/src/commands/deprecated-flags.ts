const RENAMED_FLAGS: Record<string, string> = {
  "--skills": "--skill",
  "--mcp-servers": "--mcp-server",
  "--hooks": "--hook",
  "--plugins": "--plugin",
  "--without-skills": "--without-skill",
  "--without-mcp-servers": "--without-mcp-server",
  "--without-hooks": "--without-hook",
  "--without-plugins": "--without-plugin",
};

/**
 * Hard-errors if the user invoked any of the old plural artifact-selection
 * flags (renamed in v0.0.32). Both `air start` and `air prepare` use
 * `.allowUnknownOption(true)` so these would otherwise be silently dropped —
 * see https://github.com/pulsemcp/air/issues/95 for an incident where this
 * caused a session to spin up missing its plugins.
 *
 * `start` forwards everything after `--` to the agent, so the scan stops
 * there to avoid rejecting agent flags that happen to share a name.
 *
 * Exits the process with code 1 on the first deprecated flag encountered.
 */
export function rejectDeprecatedArtifactFlags(argv: readonly string[]): void {
  const dashDashIdx = argv.indexOf("--");
  const scan = dashDashIdx === -1 ? argv : argv.slice(0, dashDashIdx);
  for (const arg of scan) {
    const base = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    const replacement = RENAMED_FLAGS[base];
    if (replacement) {
      console.error(
        `Error: ${base} was renamed to ${replacement} in v0.0.32 and is no longer accepted.\n` +
          `       Pass multiple IDs as \`${replacement} a b\` or by repeating the flag (\`${replacement} a ${replacement} b\`).`
      );
      process.exit(1);
    }
  }
}
