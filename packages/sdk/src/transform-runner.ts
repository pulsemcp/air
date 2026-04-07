import { readFileSync, writeFileSync } from "fs";
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
}

/**
 * Run transforms sequentially on the written .mcp.json file.
 *
 * Reads the current file, pipes it through each transform in
 * declaration order, and writes the final result back.
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
  } = opts;

  if (transforms.length === 0) return;

  let config: McpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));

  const context: TransformContext = {
    targetDir,
    root,
    artifacts,
    options: extensionOptions,
    mcpConfigPath,
  };

  for (const ext of transforms) {
    if (!ext.transform) continue;
    config = await ext.transform.transform(config, context);
  }

  writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2) + "\n");
}
