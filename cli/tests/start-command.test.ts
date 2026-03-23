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

describe("air start command", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups.length = 0;
  });

  it("fails for unknown agent", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson(),
    });
    cleanups.push(cleanup);
    const result = runCli("start unknown", `${dir}/air.json`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown agent");
  });

  it("fails for coming-soon agents", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson(),
    });
    cleanups.push(cleanup);
    for (const agent of ["opencode", "cursor", "pi"]) {
      const result = runCli(`start ${agent}`, `${dir}/air.json`);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not yet supported");
    }
  });

  it("dry run shows session configuration", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        mcp: ["./mcp.json"],
        skills: ["./skills.json"],
      }),
      "mcp.json": {
        github: exampleMcpStdio({ title: "GitHub" }),
      },
      "skills.json": {
        deploy: exampleSkill("deploy"),
      },
    });
    cleanups.push(cleanup);

    const result = runCli(`start claude --dry-run`, `${dir}/air.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("AIR Session Configuration");
    expect(result.stdout).toContain("claude");
  });

  it("dry run with root shows root info", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({
        mcp: ["./mcp.json"],
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      }),
      "mcp.json": {
        github: exampleMcpStdio({ title: "GitHub", description: "GitHub access" }),
        postgres: exampleMcpStdio({ title: "PostgreSQL", description: "DB access" }),
      },
      "skills.json": {
        deploy: exampleSkill("deploy"),
        review: exampleSkill("review"),
      },
      "roots.json": {
        "web-app": exampleRoot("web-app", {
          default_mcp_servers: ["github"],
          default_skills: ["deploy"],
        }),
      },
    });
    cleanups.push(cleanup);

    const result = runCli(`start claude --root web-app --dry-run`, `${dir}/air.json`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("web-app");
    expect(result.stdout).toContain("github");
    expect(result.stdout).toContain("deploy");
  });

  it("fails when specified root does not exist", () => {
    const { dir, cleanup } = createTempAirDir({
      "air.json": minimalAirJson({ roots: ["./roots.json"] }),
      "roots.json": {},
    });
    cleanups.push(cleanup);

    const result = runCli(`start claude --root nonexistent --dry-run`, `${dir}/air.json`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not found");
  });
});
