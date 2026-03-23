import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

const CLI_PATH = resolve(__dirname, "../src/index.ts");

function runCliWithHome(args: string, home: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${CLI_PATH} ${args}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: home },
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

describe("air init", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups.length = 0;
  });

  function makeTempHome(): string {
    const dir = resolve(
      tmpdir(),
      `air-init-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    mkdirSync(dir, { recursive: true });
    cleanups.push(() => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    });
    return dir;
  }

  it("creates all expected files at ~/.air/", () => {
    const home = makeTempHome();
    const result = runCliWithHome("init", home);

    expect(result.exitCode).toBe(0);
    const airDir = resolve(home, ".air");
    expect(existsSync(resolve(airDir, "air.json"))).toBe(true);
    expect(existsSync(resolve(airDir, "skills/skills.json"))).toBe(true);
    expect(existsSync(resolve(airDir, "references/references.json"))).toBe(true);
    expect(existsSync(resolve(airDir, "mcp/mcp.json"))).toBe(true);
    expect(existsSync(resolve(airDir, "plugins/plugins.json"))).toBe(true);
    expect(existsSync(resolve(airDir, "roots/roots.json"))).toBe(true);
    expect(existsSync(resolve(airDir, "hooks/hooks.json"))).toBe(true);
  });

  it("creates valid air.json with arrays", () => {
    const home = makeTempHome();
    runCliWithHome("init", home);

    const content = JSON.parse(
      readFileSync(resolve(home, ".air", "air.json"), "utf-8")
    );
    expect(content.name).toBeDefined();
    expect(typeof content.name).toBe("string");
    expect(content.skills).toEqual(["./skills/skills.json"]);
    expect(content.mcp).toEqual(["./mcp/mcp.json"]);
  });

  it("creates valid empty index files", () => {
    const home = makeTempHome();
    runCliWithHome("init", home);

    const airDir = resolve(home, ".air");
    const files = [
      "skills/skills.json",
      "references/references.json",
      "mcp/mcp.json",
      "plugins/plugins.json",
      "roots/roots.json",
      "hooks/hooks.json",
    ];

    for (const file of files) {
      const content = JSON.parse(
        readFileSync(resolve(airDir, file), "utf-8")
      );
      expect(content).toEqual({});
    }
  });

  it("fails when air.json already exists", () => {
    const home = makeTempHome();
    runCliWithHome("init", home);
    const result = runCliWithHome("init", home);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already exists");
  });

  it("prints file list on success", () => {
    const home = makeTempHome();
    const result = runCliWithHome("init", home);

    expect(result.stdout).toContain("air.json");
    expect(result.stdout).toContain("skills/skills.json");
    expect(result.stdout).toContain("mcp/mcp.json");
  });
});
