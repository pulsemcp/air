import type { McpConfig, TransformContext } from "@pulsemcp/air-core";

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g;

/**
 * Transform that resolves ${VAR} and ${VAR:-default} patterns from process.env.
 *
 * Recursively walks all string values in MCP server configs and hook configs,
 * replacing ${VAR} patterns with the corresponding environment variable value.
 * Supports bash-style defaults: ${VAR:-fallback} uses fallback when VAR is unset.
 * For plain ${VAR}, unresolvable patterns are left as-is.
 */
export async function envTransform(
  config: McpConfig,
  _context: TransformContext
): Promise<McpConfig> {
  return {
    ...config,
    mcpServers: resolveObject(config.mcpServers),
    ...(config.hooks && { hooks: resolveObject(config.hooks) }),
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
    return value.replace(ENV_VAR_PATTERN, (match, varName, defaultValue) => {
      const envVal = process.env[varName];
      if (envVal !== undefined) return envVal;
      if (defaultValue !== undefined) return defaultValue;
      return match;
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
