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
 * Warns if the user invoked any of the old plural artifact-selection flags
 * (renamed in v0.0.32). Both `air start` and `air prepare` use
 * `.allowUnknownOption(true)` so these would otherwise be silently dropped.
 *
 * `start` forwards everything after `--` to the agent, so the scan stops there
 * to avoid warning on agent flags that happen to share a name.
 */
export function warnOnDeprecatedArtifactFlags(argv: readonly string[]): void {
  const dashDashIdx = argv.indexOf("--");
  const scan = dashDashIdx === -1 ? argv : argv.slice(0, dashDashIdx);
  const seen = new Set<string>();
  for (const arg of scan) {
    const base = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    const replacement = RENAMED_FLAGS[base];
    if (replacement && !seen.has(base)) {
      seen.add(base);
      console.error(
        `Warning: ${base} was renamed to ${replacement} in v0.0.32. ` +
          `Pass multiple IDs as \`${replacement} a b\` or by repeating the flag. ` +
          `The old flag is being ignored.`
      );
    }
  }
}
