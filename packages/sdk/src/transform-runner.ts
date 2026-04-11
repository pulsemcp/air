import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import type {
  McpConfig,
  TransformContext,
  AirExtension,
  ResolvedArtifacts,
  RootEntry,
} from "@pulsemcp/air-core";

export interface RunTransformsOptions {
  /** Extensions that provide transforms, in declaration order */
  transforms: AirExtension[];
  /** All config files written by the adapter (e.g., .mcp.json, settings.json) */
  configFiles: string[];
  /** Target directory being prepared */
  targetDir: string;
  /** Root being activated */
  root?: RootEntry;
  /** Full resolved artifacts */
  artifacts: ResolvedArtifacts;
  /** Parsed CLI option values contributed by extensions */
  extensionOptions: Record<string, unknown>;
  /** Paths to hook directories injected by the adapter (each contains a HOOK.json) */
  hookPaths?: string[];
}

/**
 * Run transforms sequentially on all config files produced by the adapter.
 *
 * For each config file: reads it, pipes the content through each transform in
 * declaration order, then writes the result back. For `.mcp.json` specifically,
 * HOOK.json contents are merged in before transforms and written back separately
 * afterward (hooks are stripped from the persisted `.mcp.json`).
 *
 * No-op if there are no transforms or no config files.
 */
export async function runTransforms(opts: RunTransformsOptions): Promise<void> {
  const {
    transforms,
    configFiles,
    targetDir,
    root,
    artifacts,
    extensionOptions,
    hookPaths,
  } = opts;

  if (transforms.length === 0 || configFiles.length === 0) return;

  const mcpConfigPath = configFiles.find((f) => f.endsWith(".mcp.json"));

  // Collect HOOK.json files once (used only for .mcp.json processing)
  const hookFiles = collectHookFiles(hookPaths);

  for (const configFilePath of configFiles) {
    if (!existsSync(configFilePath)) continue;

    let config: McpConfig = JSON.parse(readFileSync(configFilePath, "utf-8"));

    const isMcpConfig = configFilePath.endsWith(".mcp.json");

    // For .mcp.json, merge HOOK.json contents into config.hooks
    if (isMcpConfig && Object.keys(hookFiles).length > 0) {
      config.hooks = {};
      for (const [id, path] of Object.entries(hookFiles)) {
        try {
          config.hooks[id] = JSON.parse(readFileSync(path, "utf-8"));
        } catch (err) {
          throw new Error(
            `Failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    // Guarantee mcpServers exists so existing transforms that access it
    // without null-guarding don't crash on non-.mcp.json config files.
    // mcpServers was previously required, so this preserves backwards compat.
    const hadMcpServers = "mcpServers" in config;
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    const context: TransformContext = {
      targetDir,
      root,
      artifacts,
      options: extensionOptions,
      configFilePath,
      mcpConfigPath: mcpConfigPath ?? configFilePath,
      hookPaths,
    };

    for (const ext of transforms) {
      if (!ext.transform) continue;
      config = await ext.transform.transform(config, context);
    }

    // Strip the synthetic mcpServers before writing non-.mcp.json files
    if (!isMcpConfig && !hadMcpServers) {
      delete config.mcpServers;
    }

    if (isMcpConfig) {
      // Write back .mcp.json (strip hooks — they live in separate files)
      const { hooks: _hooks, ...mcpOnly } = config;
      writeFileSync(configFilePath, JSON.stringify(mcpOnly, null, 2) + "\n");

      // Write back transformed HOOK.json files
      if (config.hooks) {
        for (const [id, hookConfig] of Object.entries(config.hooks)) {
          const hookJsonPath = hookFiles[id];
          if (hookJsonPath) {
            writeFileSync(
              hookJsonPath,
              JSON.stringify(hookConfig, null, 2) + "\n"
            );
          }
        }
      }
    } else {
      // For all other config files, write back the full transformed content
      writeFileSync(configFilePath, JSON.stringify(config, null, 2) + "\n");
    }
  }
}

/**
 * Build a map of hook ID -> HOOK.json file path from hook directories.
 * Only includes hooks whose HOOK.json actually exists.
 */
function collectHookFiles(
  hookPaths: string[] | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!hookPaths) return result;
  for (const dir of hookPaths) {
    const hookJsonPath = join(dir, "HOOK.json");
    if (existsSync(hookJsonPath)) {
      const id = basename(dir);
      result[id] = hookJsonPath;
    }
  }
  return result;
}
