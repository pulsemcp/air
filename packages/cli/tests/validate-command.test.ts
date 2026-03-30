import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";

const CLI = resolve(__dirname, "../src/index.ts");
const run = (args: string, cwd?: string) =>
  execSync(`npx tsx ${CLI} ${args}`, {
    encoding: "utf-8",
    cwd: cwd || resolve(__dirname, "../../.."),
    stdio: ["pipe", "pipe", "pipe"],
  });

const tryRun = (args: string, cwd?: string) => {
  try {
    return { stdout: run(args, cwd), exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", exitCode: err.status };
  }
};

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function createTemp(files: Record<string, unknown>): string {
  tempDir = resolve(
    tmpdir(),
    `air-cli-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(tempDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(tempDir, name);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(
      path,
      typeof content === "string" ? content : JSON.stringify(content, null, 2)
    );
  }
  return tempDir;
}

describe("validate command", () => {
  it("validates a valid air.json", () => {
    const dir = createTemp({ "air.json": { name: "test" } });
    const result = tryRun(`validate ${resolve(dir, "air.json")}`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("is valid");
  });

  it("validates a valid mcp.json", () => {
    const dir = createTemp({
      "mcp.json": {
        server: { type: "stdio", command: "npx", args: ["-y", "test"] },
      },
    });
    const result = tryRun(`validate ${resolve(dir, "mcp.json")}`);
    expect(result.exitCode).toBe(0);
  });

  it("rejects invalid air.json", () => {
    const dir = createTemp({ "air.json": { description: "no name" } });
    const result = tryRun(`validate ${resolve(dir, "air.json")}`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("validation errors");
  });

  it("supports --schema override", () => {
    const dir = createTemp({
      "config.json": { name: "test" },
    });
    const result = tryRun(
      `validate ${resolve(dir, "config.json")} --schema air`
    );
    expect(result.exitCode).toBe(0);
  });

  it("validates example files from the repo", () => {
    const examples = [
      "examples/air.json",
      "examples/skills/skills.json",
      "examples/mcp/mcp.json",
      "examples/roots/roots.json",
      "examples/references/references.json",
      "examples/plugins/plugins.json",
      "examples/hooks/hooks.json",
    ];

    for (const file of examples) {
      const result = tryRun(`validate ${file}`);
      expect(result.exitCode, `${file} should be valid`).toBe(0);
    }
  });
});
