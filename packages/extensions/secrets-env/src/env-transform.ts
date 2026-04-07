import type { McpConfig, TransformContext } from "@pulsemcp/air-core";

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Transform that resolves ${VAR} patterns from process.env.
 *
 * Recursively walks all string values in the MCP config and replaces
 * ${VAR} patterns with the corresponding environment variable value.
 * Unresolvable patterns (not in process.env) are left as-is.
 */
export async function envTransform(
  config: McpConfig,
  _context: TransformContext
): Promise<McpConfig> {
  return {
    ...config,
    mcpServers: resolveObject(config.mcpServers),
  };
}

function resolveObject(
  obj: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = resolveValue(value) as Record<string, unknown>;
  }
  return result;
}

function resolveValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_VAR_PATTERN, (match, varName) => {
      const envVal = process.env[varName];
      return envVal !== undefined ? envVal : match;
    });
  }
  if (Array.isArray(value)) {
    return value.map(resolveValue);
  }
  if (value !== null && typeof value === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      resolved[k] = resolveValue(v);
    }
    return resolved;
  }
  return value;
}
