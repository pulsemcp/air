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
    id,
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

export function examplePlugin(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    title: `${id} Plugin`,
    description: `Description for ${id}`,
    type: "command",
    command: "npx",
    args: ["test-plugin"],
    ...overrides,
  };
}

export function exampleRoot(
  name: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    name,
    display_name: `${name} Root`,
    description: `Description for ${name}`,
    url: `https://github.com/test/${name}.git`,
    default_branch: "main",
    default_mcp_servers: [],
    default_skills: [],
    user_invocable: true,
    ...overrides,
  };
}

export function exampleHook(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    title: `${id} Hook`,
    description: `Description for ${id}`,
    event: "session_start",
    command: "echo",
    args: ["hook fired"],
    ...overrides,
  };
}

export function exampleReference(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    title: `${id} Reference`,
    description: `Description for ${id}`,
    file: `references/${id}.md`,
    ...overrides,
  };
}
