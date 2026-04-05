import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { validateFile } from "../src/validate.js";

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
    `air-sdk-validate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

describe("validateFile", () => {
  it("validates a valid air.json", () => {
    const dir = createTemp({ "air.json": { name: "test" } });
    const result = validateFile(resolve(dir, "air.json"));
    expect(result.valid).toBe(true);
    expect(result.schemaType).toBe("air");
  });

  it("validates a valid mcp.json", () => {
    const dir = createTemp({
      "mcp.json": {
        server: { type: "stdio", command: "npx", args: ["-y", "test"] },
      },
    });
    const result = validateFile(resolve(dir, "mcp.json"));
    expect(result.valid).toBe(true);
    expect(result.schemaType).toBe("mcp");
  });

  it("returns invalid for bad air.json", () => {
    const dir = createTemp({ "air.json": { description: "no name" } });
    const result = validateFile(resolve(dir, "air.json"));
    expect(result.valid).toBe(false);
    expect(result.validation.errors.length).toBeGreaterThan(0);
  });

  it("supports explicit schema override", () => {
    const dir = createTemp({ "config.json": { name: "test" } });
    const result = validateFile(resolve(dir, "config.json"), {
      schema: "air",
    });
    expect(result.valid).toBe(true);
    expect(result.schemaType).toBe("air");
  });

  it("throws on invalid schema type", () => {
    const dir = createTemp({ "config.json": { name: "test" } });
    expect(() =>
      validateFile(resolve(dir, "config.json"), { schema: "invalid" })
    ).toThrow("Unknown schema type");
  });

  it("throws on undetectable schema", () => {
    const dir = createTemp({ "data.json": { foo: "bar" } });
    expect(() => validateFile(resolve(dir, "data.json"))).toThrow(
      "Could not detect schema type"
    );
  });

  it("throws on unreadable file", () => {
    expect(() => validateFile("/nonexistent/file.json")).toThrow(
      "Could not read or parse"
    );
  });

  it("validates example files from the repo", () => {
    const repoRoot = resolve(__dirname, "../../..");
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
      const result = validateFile(resolve(repoRoot, file));
      expect(result.valid, `${file} should be valid`).toBe(true);
    }
  });
});
