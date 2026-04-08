import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "path";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { initConfig } from "../src/init.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

function makeTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `air-sdk-init-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

describe("initConfig", () => {
  it("creates a minimal air.json", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    const result = initConfig({ path: airJsonPath });

    expect(result.airJsonPath).toBe(airJsonPath);
    expect(result.airDir).toBe(dir);

    // Verify air.json content — minimal, no empty catalog files
    const airJson = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(airJson.name).toBe("my-config");
    expect(airJson.skills).toBeUndefined();
    expect(airJson.mcp).toBeUndefined();

    // Should not create empty catalog index files
    expect(existsSync(resolve(dir, "skills/skills.json"))).toBe(false);
    expect(existsSync(resolve(dir, "mcp/mcp.json"))).toBe(false);
  });

  it("throws if air.json already exists", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    writeFileSync(airJsonPath, "{}");

    expect(() => initConfig({ path: airJsonPath })).toThrow("already exists");
  });

  it("creates parent directories as needed", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "nested/deep/air.json");
    const result = initConfig({ path: airJsonPath });

    expect(existsSync(airJsonPath)).toBe(true);
    expect(result.airDir).toBe(resolve(dir, "nested/deep"));
  });
});
