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
  /** Path to the .mcp.json file to transform */
  mcpConfigPath: string;
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
 * Run transforms sequentially on the written .mcp.json and HOOK.json files.
 *
 * Reads the current .mcp.json, collects HOOK.json contents from hook
 * directories, pipes the combined config through each transform in
 * declaration order, then writes the results back.
 * No-op if there are no transforms.
 */
export async function runTransforms(opts: RunTransformsOptions): Promise<void> {
  const {
    transforms,
    mcpConfigPath,
    targetDir,
    root,
    artifacts,
    extensionOptions,
    hookPaths,
  } = opts;

  if (transforms.length === 0) return;

  let config: McpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));

  // Collect HOOK.json contents into config.hooks keyed by hook ID
  const hookFiles = collectHookFiles(hookPaths);
  if (Object.keys(hookFiles).length > 0) {
    config.hooks = {};
    for (const [id, path] of Object.entries(hookFiles)) {
      config.hooks[id] = JSON.parse(readFileSync(path, "utf-8"));
    }
  }

  const context: TransformContext = {
    targetDir,
    root,
    artifacts,
    options: extensionOptions,
    mcpConfigPath,
    hookPaths,
  };

  for (const ext of transforms) {
    if (!ext.transform) continue;
    config = await ext.transform.transform(config, context);
  }

  // Write back .mcp.json (strip hooks — they live in separate files)
  const { hooks: _hooks, ...mcpOnly } = config;
  writeFileSync(mcpConfigPath, JSON.stringify(mcpOnly, null, 2) + "\n");

  // Write back transformed HOOK.json files
  if (config.hooks) {
    for (const [id, hookConfig] of Object.entries(config.hooks)) {
      const hookJsonPath = hookFiles[id];
      if (hookJsonPath) {
        writeFileSync(hookJsonPath, JSON.stringify(hookConfig, null, 2) + "\n");
      }
    }
  }
}

/**
 * Build a map of hook ID → HOOK.json file path from hook directories.
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
