import { readFileSync } from "fs";
import type { McpConfig, TransformContext } from "@pulsemcp/air-core";

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Transform that resolves ${VAR} patterns from a JSON secrets file.
 *
 * The file path is provided via the --secrets-file CLI option (passed
 * through context.options["secrets-file"]). If the option is not set,
 * this transform is a no-op.
 *
 * The secrets file must be a JSON object of key-value string pairs:
 * { "MY_SECRET": "value", "ANOTHER": "value2" }
 */
export async function fileTransform(
  config: McpConfig,
  context: TransformContext
): Promise<McpConfig> {
  const secretsFilePath = context.options["secrets-file"] as string | undefined;
  if (!secretsFilePath) return config;

  const secrets: Record<string, string> = JSON.parse(
    readFileSync(secretsFilePath, "utf-8")
  );

  return {
    mcpServers: resolveObject(config.mcpServers, secrets),
  };
}

function resolveObject(
  obj: Record<string, Record<string, unknown>>,
  secrets: Record<string, string>
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = resolveValue(value, secrets) as Record<string, unknown>;
  }
  return result;
}

function resolveValue(
  value: unknown,
  secrets: Record<string, string>
): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_VAR_PATTERN, (match, varName) => {
      const secretVal = secrets[varName];
      return secretVal !== undefined ? secretVal : match;
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveValue(v, secrets));
  }
  if (value !== null && typeof value === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      resolved[k] = resolveValue(v, secrets);
    }
    return resolved;
  }
  return value;
}
