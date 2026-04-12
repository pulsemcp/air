import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import {
  getSchemasDir,
  getSchemaPath,
  loadSchema,
  detectSchemaType,
  detectSchemaFromValue,
  getAllSchemaTypes,
  isValidSchemaType,
} from "../src/schemas.js";

describe("getSchemasDir", () => {
  it("returns a directory that exists", () => {
    expect(existsSync(getSchemasDir())).toBe(true);
  });
});

describe("getSchemaPath / loadSchema", () => {
  it.each(getAllSchemaTypes())("loads %s schema", (type) => {
    const path = getSchemaPath(type);
    expect(existsSync(path)).toBe(true);

    const schema = loadSchema(type);
    expect(schema).toHaveProperty("$schema");
    expect(schema).toHaveProperty("title");
  });
});

describe("detectSchemaType", () => {
  it("detects from word-boundary keyword matching", () => {
    expect(detectSchemaType("air.json")).toBe("air");
    expect(detectSchemaType("skills.json")).toBe("skills");
    expect(detectSchemaType("mcp.json")).toBe("mcp");
    expect(detectSchemaType("roots.json")).toBe("roots");
    expect(detectSchemaType("hooks.json")).toBe("hooks");
    expect(detectSchemaType("plugins.json")).toBe("plugins");
    expect(detectSchemaType("references.json")).toBe("references");
  });

  it("handles paths with directories", () => {
    expect(detectSchemaType("org/skills/skills.json")).toBe("skills");
    expect(detectSchemaType("/path/to/mcp.json")).toBe("mcp");
  });

  it("returns null for unrecognized filenames", () => {
    expect(detectSchemaType("unknown.json")).toBeNull();
    expect(detectSchemaType("config.yaml")).toBeNull();
  });

  it("returns null for *.schema.json files (JSON Schema definitions)", () => {
    expect(detectSchemaType("mcp.schema.json")).toBeNull();
    expect(detectSchemaType("skills.schema.json")).toBeNull();
    expect(detectSchemaType("hooks.schema.json")).toBeNull();
    expect(detectSchemaType("roots.schema.json")).toBeNull();
    expect(detectSchemaType("plugins.schema.json")).toBeNull();
    expect(detectSchemaType("references.schema.json")).toBeNull();
    expect(detectSchemaType("air.schema.json")).toBeNull();
    expect(detectSchemaType("schemas/mcp.schema.json")).toBeNull();
    expect(detectSchemaType("path/to/skills.schema.json")).toBeNull();
  });

  it("still matches prefixed/suffixed catalog filenames", () => {
    expect(detectSchemaType("team-mcp.json")).toBe("mcp");
    expect(detectSchemaType("mcp.local.json")).toBe("mcp");
    expect(detectSchemaType("mcp-servers.json")).toBe("mcp");
    expect(detectSchemaType("my-skills.json")).toBe("skills");
    expect(detectSchemaType("skills-frontend.json")).toBe("skills");
    expect(detectSchemaType("team_hooks.json")).toBe("hooks");
    expect(detectSchemaType("dev.air.json")).toBe("air");
  });

  it("rejects words that contain a keyword as a substring", () => {
    expect(detectSchemaType("repair.json")).toBeNull();
    expect(detectSchemaType("affair.json")).toBeNull();
    expect(detectSchemaType("flair.json")).toBeNull();
    expect(detectSchemaType("webhooks.json")).toBeNull();
    expect(detectSchemaType("upskills.json")).toBeNull();
    expect(detectSchemaType("grassroots.json")).toBeNull();
    expect(detectSchemaType("mcpserver.json")).toBeNull();
    expect(detectSchemaType("airtable.json")).toBeNull();
  });
});

describe("detectSchemaFromValue", () => {
  it("detects from $schema URL", () => {
    expect(
      detectSchemaFromValue(
        "https://raw.githubusercontent.com/pulsemcp/air/main/schemas/skills.schema.json"
      )
    ).toBe("skills");
  });

  it("detects from relative path", () => {
    expect(detectSchemaFromValue("../schemas/mcp.schema.json")).toBe("mcp");
  });

  it("returns null for unknown schemas", () => {
    expect(detectSchemaFromValue("https://example.com/unknown.json")).toBeNull();
  });
});

describe("isValidSchemaType", () => {
  it("returns true for valid types", () => {
    expect(isValidSchemaType("air")).toBe(true);
    expect(isValidSchemaType("skills")).toBe(true);
    expect(isValidSchemaType("mcp")).toBe(true);
  });

  it("returns false for invalid types", () => {
    expect(isValidSchemaType("invalid")).toBe(false);
    expect(isValidSchemaType("")).toBe(false);
  });
});
