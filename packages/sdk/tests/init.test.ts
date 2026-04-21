import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "path";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { initConfig } from "../src/init.js";
import { getAllSchemaTypes, validateJson } from "@pulsemcp/air-core";

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

const ARTIFACT_TYPES = getAllSchemaTypes().filter((t) => t !== "air");

describe("initConfig", () => {
  it("scaffolds air.json pre-wired to all six local index files", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    const result = initConfig({ path: airJsonPath });

    expect(result.airJsonPath).toBe(airJsonPath);
    expect(result.airDir).toBe(dir);

    const airJson = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(airJson.name).toBe("my-config");
    expect(airJson.$schema).toContain("air.schema.json");

    for (const type of ARTIFACT_TYPES) {
      expect(airJson[type]).toEqual([`./${type}/${type}.json`]);
    }
  });

  it("creates a $schema-referenced index file for every artifact type", () => {
    const dir = makeTempDir();
    initConfig({ path: resolve(dir, "air.json") });

    for (const type of ARTIFACT_TYPES) {
      const indexPath = resolve(dir, `${type}/${type}.json`);
      expect(existsSync(indexPath)).toBe(true);

      const content = JSON.parse(readFileSync(indexPath, "utf-8"));
      expect(content.$schema).toContain(`${type}.schema.json`);

      // Each scaffolded index file must be valid against its own schema.
      const result = validateJson(content, type);
      expect(result.valid).toBe(true);
    }
  });

  it("scaffolded air.json validates against the air schema", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    initConfig({ path: airJsonPath });

    const airJson = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    const result = validateJson(airJson, "air");
    expect(result.valid).toBe(true);
  });

  it("writes a README orienting the user to the layout", () => {
    const dir = makeTempDir();
    initConfig({ path: resolve(dir, "air.json") });

    const readmePath = resolve(dir, "README.md");
    expect(existsSync(readmePath)).toBe(true);
    const content = readFileSync(readmePath, "utf-8");
    expect(content).toContain("AIR configuration");
    expect(content).toContain("air.json");
  });

  it("reports every scaffolded file in the result", () => {
    const dir = makeTempDir();
    const result = initConfig({ path: resolve(dir, "air.json") });

    const kinds = result.scaffolded.map((f) => f.kind);
    expect(kinds).toContain("air");
    expect(kinds).toContain("readme");
    for (const type of ARTIFACT_TYPES) {
      expect(kinds).toContain(type);
    }
    for (const file of result.scaffolded) {
      expect(existsSync(file.path)).toBe(true);
    }
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
