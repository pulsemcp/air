/**
 * Parse and validate the `--git-protocol` CLI flag value. Prints an error
 * and exits on invalid input so command handlers can call it during
 * argument parsing without repeating the check.
 */
export function parseGitProtocolFlag(
  raw: string | undefined
): "ssh" | "https" | undefined {
  if (raw === undefined) return undefined;
  if (raw === "ssh" || raw === "https") return raw;
  console.error(
    `Error: invalid --git-protocol value "${raw}". ` +
      `Expected "ssh" or "https".`
  );
  process.exit(1);
}
