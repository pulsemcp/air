import { readFileSync } from "fs";
import type { McpConfig } from "@pulsemcp/air-core";

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Find all unresolved ${VAR} patterns in an MCP config.
 * Recursively walks all string values in the entire config object.
 */
export function findUnresolvedVars(config: McpConfig): string[] {
  const vars = new Set<string>();
  if (config.mcpServers) {
    walkValue(config.mcpServers, vars);
  }
  return [...vars];
}

function walkValue(value: unknown, vars: Set<string>): void {
  if (typeof value === "string") {
    let match;
    ENV_VAR_PATTERN.lastIndex = 0;
    while ((match = ENV_VAR_PATTERN.exec(value)) !== null) {
      vars.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkValue(item, vars);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      walkValue(v, vars);
    }
  }
}

/**
 * Validate that no unresolved ${VAR} patterns remain in the .mcp.json file.
 * This is a final validation step that runs after all transforms complete.
 *
 * @throws Error listing all unresolved variables if any are found.
 */
export function validateNoUnresolvedVars(mcpConfigPath: string): void {
  const config: McpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
  const unresolved = findUnresolvedVars(config);
  if (unresolved.length > 0) {
    throw new Error(
      unresolvedVarsMessage(mcpConfigPath, unresolved)
    );
  }
}

export function unresolvedVarsMessage(
  mcpConfigPath: string,
  unresolved: string[]
): string {
  return (
    `Unresolved variable${unresolved.length === 1 ? "" : "s"} in ${mcpConfigPath}: ${unresolved.map((v) => `\${${v}}`).join(", ")}. ` +
    `Ensure all variables are provided via environment or a secrets transform.`
  );
}
