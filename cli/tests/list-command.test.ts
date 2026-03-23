import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "path";
import { execSync } from "child_process";
import {
  createTempAirDir,
  minimalAirJson,
  exampleSkill,
  exampleMcpStdio,
  examplePlugin,
  exampleRoot,
  exampleHook,
  exampleReference,
} from "./helpers.js";

const CLI_PATH = resolve(__dirname, "../src/index.ts");

function runCli(args: string, airConfigPath?: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${CLI_PATH} ${args}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(airConfigPath ? { AIR_CONFIG: airConfigPath } : {}),
      },
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

describe("air list command", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups.length = 0;
  });

  it("fails for invalid artifact type", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson(),
    });
    cleanups.push(cleanup);
    const result = runCli("list invalid", `${dir}/air.json`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown artifact type");
  });

  it("lists skills", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({ skills: ["./skills.json"] }),
      "skills.json": {
        deploy: exampleSkill("deploy"),
        review: exampleSkill("review"),
      },
    });
    cleanups.push(cleanup);

    const result = runCli("list skills", `${dir}/air.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Skills (2)");
    expect(result.stdout).toContain("deploy");
    expect(result.stdout).toContain("review");
  });

  it("lists MCP servers", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({ mcp: ["./mcp.json"] }),
      "mcp.json": {
        github: exampleMcpStdio({ title: "GitHub" }),
        postgres: exampleMcpStdio({ title: "PostgreSQL" }),
      },
    });
    cleanups.push(cleanup);

    const result = runCli("list mcp", `${dir}/air.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("MCP Servers (2)");
    expect(result.stdout).toContain("github");
    expect(result.stdout).toContain("postgres");
  });

  it("lists plugins", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({ plugins: ["./plugins.json"] }),
      "plugins.json": {
        lint: examplePlugin("lint"),
      },
    });
    cleanups.push(cleanup);

    const result = runCli("list plugins", `${dir}/air.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Plugins (1)");
    expect(result.stdout).toContain("lint");
  });

  it("lists roots", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({ roots: ["./roots.json"] }),
      "roots.json": {
        "web-app": exampleRoot("web-app"),
      },
    });
    cleanups.push(cleanup);

    const result = runCli("list roots", `${dir}/air.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Roots (1)");
    expect(result.stdout).toContain("web-app");
  });

  it("lists hooks", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({ hooks: ["./hooks.json"] }),
      "hooks.json": {
        notify: exampleHook("notify"),
      },
    });
    cleanups.push(cleanup);

    const result = runCli("list hooks", `${dir}/air.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hooks (1)");
    expect(result.stdout).toContain("notify");
  });

  it("lists references", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({ references: ["./references.json"] }),
      "references.json": {
        "git-workflow": exampleReference("git-workflow"),
      },
    });
    cleanups.push(cleanup);

    const result = runCli("list references", `${dir}/air.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("References (1)");
    expect(result.stdout).toContain("git-workflow");
  });

  it("shows 'none found' for empty artifact types", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({ skills: ["./skills.json"] }),
      "skills.json": {},
    });
    cleanups.push(cleanup);

    const result = runCli("list skills", `${dir}/air.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No skills found");
  });
});
