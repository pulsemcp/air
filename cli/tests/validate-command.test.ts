import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "path";
import { execSync } from "child_process";
import {
  createTempAirDir,
  minimalAirJson,
  exampleSkill,
  exampleMcpStdio,
} from "./helpers.js";

const CLI_PATH = resolve(__dirname, "../src/index.ts");

function runCli(args: string, cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${CLI_PATH} ${args}`, {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() || "",
      stderr: err.stderr?.toString() || "",
      exitCode: err.status || 1,
    };
  }
}

describe("air validate command", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups.length = 0;
  });

  it("validates a valid air.json", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson(),
    });
    cleanups.push(cleanup);

    const result = runCli(`validate ${dir}/air.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("valid");
  });

  it("validates a valid mcp.json", () => {
    const { dir, cleanup } = createTempAirDir({
      "mcp.json": { github: exampleMcpStdio() },
    });
    cleanups.push(cleanup);

    const result = runCli(`validate ${dir}/mcp.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("valid");
  });

  it("validates a valid skills.json", () => {
    const { dir, cleanup } = createTempAirDir({
      "skills.json": { "my-skill": exampleSkill("my-skill") },
    });
    cleanups.push(cleanup);

    const result = runCli(`validate ${dir}/skills.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("valid");
  });

  it("fails on invalid air.json", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": { description: "no name field" },
    });
    cleanups.push(cleanup);

    const result = runCli(`validate ${dir}/air.json`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("validation errors");
  });

  it("fails on invalid mcp.json (missing type)", () => {
    const { dir, cleanup } = createTempAirDir({
      "mcp.json": { server: { command: "npx" } },
    });
    cleanups.push(cleanup);

    const result = runCli(`validate ${dir}/mcp.json`);
    expect(result.exitCode).toBe(1);
  });

  it("supports --schema override", () => {
    const { dir, cleanup } = createTempAirDir({
      "config.json": minimalAirJson(),
    });
    cleanups.push(cleanup);

    const result = runCli(`validate ${dir}/config.json --schema air`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("valid");
  });

  it("detects schema from $schema value in JSON content", () => {
    const { dir, cleanup } = createTempAirDir({
      "config.json": { $schema: "./schemas/air.schema.json", name: "test" },
    });
    cleanups.push(cleanup);

    const result = runCli(`validate ${dir}/config.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("valid");
    expect(result.stdout).toContain("air");
  });

  it("detects schema from filename substring", () => {
    const { dir, cleanup } = createTempAirDir({
      "my-custom-skills.json": {
        "my-skill": {
          id: "my-skill",
          description: "A test skill",
          path: "skills/my-skill",
        },
      },
    });
    cleanups.push(cleanup);

    const result = runCli(`validate ${dir}/my-custom-skills.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("skills");
  });

  it("fails on unknown schema type", () => {
    const { dir, cleanup } = createTempAirDir({
      "test.json": {},
    });
    cleanups.push(cleanup);

    const result = runCli(`validate ${dir}/test.json --schema invalid`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown schema type");
  });

  it("fails when schema cannot be detected from filename", () => {
    const { dir, cleanup } = createTempAirDir({
      "unknown.json": {},
    });
    cleanups.push(cleanup);

    const result = runCli(`validate ${dir}/unknown.json`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Could not detect schema type");
  });

  it("fails on non-existent file", () => {
    const result = runCli("validate /nonexistent/file.json --schema air");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Could not read");
  });

  it("fails on invalid JSON", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": "this is not json",
    });
    cleanups.push(cleanup);

    const result = runCli(`validate ${dir}/air.json`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Could not read");
  });

  it("validates all example files from the examples/ directory", () => {
    const examplesDir = resolve(__dirname, "../../examples");
    const files = [
      "air.json",
      "skills/skills.json",
      "references/references.json",
      "mcp/mcp.json",
      "plugins/plugins.json",
      "roots/roots.json",
      "hooks/hooks.json",
    ];

    for (const file of files) {
      const result = runCli(`validate ${examplesDir}/${file}`);
      expect(result.exitCode).toBe(0);
    }
  });
});
