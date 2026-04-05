import { writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
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
  /** List of files in the config directory (relative to airDir). */
  files: string[];
}

/**
 * Initialize a new AIR configuration directory.
 *
 * Creates air.json and empty artifact index files at the specified
 * path (defaults to ~/.air/).
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
    description: "",
    skills: ["./skills/skills.json"],
    references: ["./references/references.json"],
    mcp: ["./mcp/mcp.json"],
    plugins: ["./plugins/plugins.json"],
    roots: ["./roots/roots.json"],
    hooks: ["./hooks/hooks.json"],
  };

  const emptyIndex = () => "{}\n";

  writeFileSync(airJsonPath, JSON.stringify(airJson, null, 2) + "\n");

  const indexFiles: [string, string][] = [
    ["skills/skills.json", emptyIndex()],
    ["references/references.json", emptyIndex()],
    ["mcp/mcp.json", emptyIndex()],
    ["plugins/plugins.json", emptyIndex()],
    ["roots/roots.json", emptyIndex()],
    ["hooks/hooks.json", emptyIndex()],
  ];

  const files = ["air.json"];

  for (const [filename, content] of indexFiles) {
    const filePath = resolve(airDir, filename);
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content);
    }
    files.push(filename);
  }

  return { airJsonPath, airDir, files };
}
