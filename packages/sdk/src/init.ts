import { writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { getDefaultAirJsonPath } from "@pulsemcp/air-core";

export interface InitConfigOptions {
  /** Override the default air.json path (~/.air/air.json). */
  path?: string;
}

export interface InitConfigResult {
  /** Absolute path to the created air.json. */
  airJsonPath: string;
  /** Absolute path to the AIR config directory. */
  airDir: string;
}

/**
 * Initialize a new AIR configuration directory.
 *
 * Creates a minimal air.json at the specified path (defaults to ~/.air/).
 *
 * @throws Error if air.json already exists at the target path.
 */
export function initConfig(options?: InitConfigOptions): InitConfigResult {
  const airJsonPath = options?.path ?? getDefaultAirJsonPath();
  const airDir = dirname(airJsonPath);

  if (existsSync(airJsonPath)) {
    throw new Error(`${airJsonPath} already exists.`);
  }

  mkdirSync(airDir, { recursive: true });

  const airJson = {
    name: "my-config",
  };

  writeFileSync(airJsonPath, JSON.stringify(airJson, null, 2) + "\n");

  return { airJsonPath, airDir };
}
