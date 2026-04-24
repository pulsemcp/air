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

  describe("topUp option", () => {
    it("leaves an existing air.json untouched and scaffolds missing pieces", () => {
      const dir = makeTempDir();
      const airJsonPath = resolve(dir, "air.json");
      const originalContent = '{"name":"my-own-config","custom":true}\n';
      writeFileSync(airJsonPath, originalContent);

      const result = initConfig({ path: airJsonPath, topUp: true });

      // Existing air.json is untouched
      expect(readFileSync(airJsonPath, "utf-8")).toBe(originalContent);

      // `air` is NOT in scaffolded since it pre-existed
      const kinds = result.scaffolded.map((f) => f.kind);
      expect(kinds).not.toContain("air");

      // All six indexes + README were created
      for (const type of ARTIFACT_TYPES) {
        expect(kinds).toContain(type);
        expect(existsSync(resolve(dir, `${type}/${type}.json`))).toBe(true);
      }
      expect(kinds).toContain("readme");
      expect(existsSync(resolve(dir, "README.md"))).toBe(true);
    });

    it("only fills in the specific index files that are missing", () => {
      const dir = makeTempDir();
      const airJsonPath = resolve(dir, "air.json");
      writeFileSync(airJsonPath, '{"name":"existing"}\n');

      // Pre-create skills.json and README.md with custom contents
      mkdirSync(resolve(dir, "skills"), { recursive: true });
      const customSkills = '{"my-skill":{"description":"mine","path":"p"}}\n';
      writeFileSync(resolve(dir, "skills/skills.json"), customSkills);
      const customReadme = "# my custom readme\n";
      writeFileSync(resolve(dir, "README.md"), customReadme);

      const result = initConfig({ path: airJsonPath, topUp: true });

      // Custom files remain intact
      expect(readFileSync(resolve(dir, "skills/skills.json"), "utf-8")).toBe(
        customSkills
      );
      expect(readFileSync(resolve(dir, "README.md"), "utf-8")).toBe(
        customReadme
      );

      // Skills and readme were skipped, other indexes were created
      const kinds = result.scaffolded.map((f) => f.kind);
      expect(kinds).not.toContain("skills");
      expect(kinds).not.toContain("readme");
      expect(kinds).not.toContain("air");
      for (const type of ARTIFACT_TYPES) {
        if (type === "skills") continue;
        expect(kinds).toContain(type);
      }
    });

    it("returns an empty scaffolded array when nothing is missing", () => {
      const dir = makeTempDir();
      const airJsonPath = resolve(dir, "air.json");

      // Fresh init creates everything
      initConfig({ path: airJsonPath });

      // Second call in topUp mode should find nothing to do
      const result = initConfig({ path: airJsonPath, topUp: true });
      expect(result.scaffolded).toEqual([]);
    });

    it("creates a fresh scaffold when air.json does not exist (topUp is a no-op)", () => {
      const dir = makeTempDir();
      const airJsonPath = resolve(dir, "air.json");

      const result = initConfig({ path: airJsonPath, topUp: true });

      // Same behavior as a fresh init — all files scaffolded
      expect(result.scaffolded.map((f) => f.kind)).toContain("air");
      expect(existsSync(airJsonPath)).toBe(true);
    });
  });
});
