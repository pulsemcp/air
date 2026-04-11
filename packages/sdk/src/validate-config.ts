import { existsSync, readFileSync } from "fs";
import { join, basename } from "path";
import type { McpConfig } from "@pulsemcp/air-core";

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Find all unresolved ${VAR} patterns in a transform config.
 * Recursively walks all string values in MCP servers and hooks.
 */
export function findUnresolvedVars(config: McpConfig): string[] {
  const vars = new Set<string>();
  if (config.mcpServers) {
    walkValue(config.mcpServers, vars);
  }
  if (config.hooks) {
    walkValue(config.hooks, vars);
  }
  return [...vars];
}

/**
 * Find unresolved ${VAR} patterns in HOOK.json files at the given paths.
 * Reads each HOOK.json, walks all string values, and returns unique var names.
 */
export function findUnresolvedHookVars(hookPaths: string[]): string[] {
  const vars = new Set<string>();
  for (const dir of hookPaths) {
    const hookJsonPath = join(dir, "HOOK.json");
    if (!existsSync(hookJsonPath)) continue;
    try {
      const hookConfig = JSON.parse(readFileSync(hookJsonPath, "utf-8"));
      walkValue(hookConfig, vars);
    } catch {
      // Skip unparseable HOOK.json files
    }
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
 * This only checks the MCP config file; use findUnresolvedHookVars() to
 * also check HOOK.json files, or rely on prepareSession() which checks both.
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
  configPath: string,
  unresolved: string[]
): string {
  return (
    `Unresolved variable${unresolved.length === 1 ? "" : "s"} in ${configPath}: ${unresolved.map((v) => `\${${v}}`).join(", ")}. ` +
    `Ensure all variables are provided via environment or a secrets transform.`
  );
}
