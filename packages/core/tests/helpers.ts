import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

/**
 * Create a temporary directory with AIR config files for testing.
 * Returns the directory path and a cleanup function.
 */
export function createTempAirDir(
  files: Record<string, unknown>
): { dir: string; cleanup: () => void } {
  const dir = resolve(
    tmpdir(),
    `air-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(dir, filename);
    const fileDir = resolve(filePath, "..");
    mkdirSync(fileDir, { recursive: true });
    if (typeof content === "string") {
      writeFileSync(filePath, content);
    } else {
      writeFileSync(filePath, JSON.stringify(content, null, 2));
    }
  }

  return {
    dir,
    cleanup: () => {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

export function exampleSkill(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    title: `${id} Skill`,
    description: `Description for ${id}`,
    path: `skills/${id}`,
    ...overrides,
  };
}

export function exampleMcpStdio(
  overrides: Record<string, unknown> = {}
) {
  return {
    title: "Test Server",
    description: "A test MCP server",
    type: "stdio",
    command: "npx",
    args: ["-y", "test-server@1.0.0"],
    env: { API_KEY: "${API_KEY}" },
    ...overrides,
  };
}

export function exampleMcpHttp(
  overrides: Record<string, unknown> = {}
) {
  return {
    title: "Test Remote Server",
    description: "A test remote MCP server",
    type: "streamable-http",
    url: "https://mcp.example.com/mcp",
    headers: { Authorization: "Bearer ${TOKEN}" },
    ...overrides,
  };
}

/**
 * A thin plugins.json index entry pointing at a `.plugin/plugin.json` manifest
 * in a sibling `<id>/` directory. Inline plugin bodies (body fields with no
 * `path`) were removed in https://github.com/pulsemcp/air/issues/157, so a
 * fixture that goes through `resolveArtifacts` needs this entry *and* the
 * manifest {@link examplePluginManifest} builds. Body fields passed as
 * overrides here are inline overrides of that manifest, which stay supported.
 */
export function examplePlugin(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    description: `Description for ${id}`,
    path: `./${id}`,
    ...overrides,
  };
}

/**
 * The manifest half of {@link examplePlugin} — write it to
 * `<index-dir>/<id>/.plugin/plugin.json` in the same `createTempAirDir` map.
 */
export function examplePluginManifest(
  id: string,
  body: Record<string, unknown> = {}
) {
  return {
    name: id,
    title: `${id} Plugin`,
    ...body,
  };
}

export function exampleRoot(
  name: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    display_name: `${name} Root`,
    description: `Description for ${name}`,
    url: `https://github.com/test/${name}.git`,
    default_branch: "main",
    user_invocable: true,
    ...overrides,
  };
}

export function exampleHook(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    title: `${id} Hook`,
    description: `Description for ${id}`,
    path: `hooks/${id}`,
    ...overrides,
  };
}

export function exampleReference(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    title: `${id} Reference`,
    description: `Description for ${id}`,
    path: `references/${id}.md`,
    ...overrides,
  };
}
