import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import {
  getSchemaPath,
  loadSchema,
  detectSchemaType,
  detectSchemaFromValue,
  getAllSchemaTypes,
  isValidSchemaType,
  getSchemasDir,
  type SchemaType,
} from "../src/lib/schemas.js";

describe("Schema Loading", () => {
  const allTypes: SchemaType[] = [
    "air",
    "skills",
    "references",
    "mcp",
    "plugins",
    "roots",
    "hooks",
  ];

  describe("getSchemasDir", () => {
    it("returns a directory that exists", () => {
      const dir = getSchemasDir();
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("getAllSchemaTypes", () => {
    it("returns all 7 schema types", () => {
      const types = getAllSchemaTypes();
      expect(types).toHaveLength(7);
      for (const type of allTypes) {
        expect(types).toContain(type);
      }
    });
  });

  describe("isValidSchemaType", () => {
    it("returns true for valid types", () => {
      for (const type of allTypes) {
        expect(isValidSchemaType(type)).toBe(true);
      }
    });

    it("returns false for invalid types", () => {
      expect(isValidSchemaType("invalid")).toBe(false);
      expect(isValidSchemaType("")).toBe(false);
      expect(isValidSchemaType("AIR")).toBe(false);
    });
  });

  describe("getSchemaPath", () => {
    for (const type of allTypes) {
      it(`returns existing path for ${type}`, () => {
        const path = getSchemaPath(type);
        expect(existsSync(path)).toBe(true);
      });
    }
  });

  describe("loadSchema", () => {
    for (const type of allTypes) {
      it(`loads valid JSON for ${type}`, () => {
        const schema = loadSchema(type);
        expect(schema).toBeDefined();
        expect(typeof schema).toBe("object");
      });

      it(`${type} schema has required JSON Schema fields`, () => {
        const schema = loadSchema(type) as Record<string, unknown>;
        expect(schema.$schema).toBe(
          "http://json-schema.org/draft-07/schema#"
        );
        expect(schema.title).toBeDefined();
        expect(typeof schema.title).toBe("string");
        expect(schema.description).toBeDefined();
        expect(typeof schema.description).toBe("string");
        expect(schema.type).toBe("object");
      });
    }
  });

  describe("detectSchemaType (substring matching)", () => {
    it("detects air.json", () => {
      expect(detectSchemaType("air.json")).toBe("air");
    });

    it("detects skills.json", () => {
      expect(detectSchemaType("skills.json")).toBe("skills");
    });

    it("detects references.json", () => {
      expect(detectSchemaType("references.json")).toBe("references");
    });

    it("detects mcp.json", () => {
      expect(detectSchemaType("mcp.json")).toBe("mcp");
    });

    it("detects plugins.json", () => {
      expect(detectSchemaType("plugins.json")).toBe("plugins");
    });

    it("detects roots.json", () => {
      expect(detectSchemaType("roots.json")).toBe("roots");
    });

    it("detects hooks.json", () => {
      expect(detectSchemaType("hooks.json")).toBe("hooks");
    });

    it("detects from full path", () => {
      expect(detectSchemaType("/some/path/to/mcp.json")).toBe("mcp");
      expect(detectSchemaType("./configs/skills.json")).toBe("skills");
    });

    it("detects from nested paths (skills/skills.json)", () => {
      expect(detectSchemaType("skills/skills.json")).toBe("skills");
      expect(detectSchemaType("mcp/mcp.json")).toBe("mcp");
      expect(detectSchemaType("hooks/hooks.json")).toBe("hooks");
    });

    it("detects from custom filenames containing the type", () => {
      expect(detectSchemaType("my-team-skills.json")).toBe("skills");
      expect(detectSchemaType("prod-mcp-servers.json")).toBe("mcp");
    });

    it("returns null for filenames with no type match", () => {
      expect(detectSchemaType("config.json")).toBeNull();
      expect(detectSchemaType("package.json")).toBeNull();
      expect(detectSchemaType("data.json")).toBeNull();
    });
  });

  describe("detectSchemaFromValue", () => {
    it("detects from full URL $schema values", () => {
      expect(
        detectSchemaFromValue(
          "https://raw.githubusercontent.com/pulsemcp/air/main/schemas/air.schema.json"
        )
      ).toBe("air");
      expect(
        detectSchemaFromValue(
          "https://raw.githubusercontent.com/pulsemcp/air/main/schemas/skills.schema.json"
        )
      ).toBe("skills");
    });

    it("detects from relative $schema values", () => {
      expect(detectSchemaFromValue("./schemas/mcp.schema.json")).toBe("mcp");
      expect(detectSchemaFromValue("../schemas/hooks.schema.json")).toBe("hooks");
    });

    it("returns null for non-matching $schema values", () => {
      expect(detectSchemaFromValue("https://example.com/schema.json")).toBeNull();
      expect(detectSchemaFromValue("unknown")).toBeNull();
    });
  });
});

describe("Schema Structure", () => {
  describe("air.schema.json", () => {
    it("requires name field", () => {
      const schema = loadSchema("air") as Record<string, unknown>;
      expect(schema.required).toContain("name");
    });

    it("defines all artifact path properties", () => {
      const schema = loadSchema("air") as Record<string, unknown>;
      const properties = schema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty("skills");
      expect(properties).toHaveProperty("references");
      expect(properties).toHaveProperty("mcp");
      expect(properties).toHaveProperty("plugins");
      expect(properties).toHaveProperty("roots");
      expect(properties).toHaveProperty("hooks");
    });

    it("does not allow additional properties", () => {
      const schema = loadSchema("air") as Record<string, unknown>;
      expect(schema.additionalProperties).toBe(false);
    });
  });

  describe("skills.schema.json", () => {
    it("defines Skill in $defs", () => {
      const schema = loadSchema("skills") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      expect(defs).toHaveProperty("Skill");
    });

    it("Skill requires id, description, path", () => {
      const schema = loadSchema("skills") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      const skill = defs.Skill as Record<string, unknown>;
      expect(skill.required).toContain("id");
      expect(skill.required).toContain("description");
      expect(skill.required).toContain("path");
    });

    it("Skill has references array property", () => {
      const schema = loadSchema("skills") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      const skill = defs.Skill as Record<string, unknown>;
      const props = skill.properties as Record<string, unknown>;
      const refs = props.references as Record<string, unknown>;
      expect(refs.type).toBe("array");
    });
  });

  describe("mcp.schema.json", () => {
    it("defines ServerConfiguration in $defs", () => {
      const schema = loadSchema("mcp") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      expect(defs).toHaveProperty("ServerConfiguration");
    });

    it("ServerConfiguration requires type", () => {
      const schema = loadSchema("mcp") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      const server = defs.ServerConfiguration as Record<string, unknown>;
      expect(server.required).toContain("type");
    });

    it("type enum includes stdio, sse, streamable-http", () => {
      const schema = loadSchema("mcp") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      const server = defs.ServerConfiguration as Record<string, unknown>;
      const props = server.properties as Record<string, unknown>;
      const typeField = props.type as Record<string, unknown>;
      expect(typeField.enum).toContain("stdio");
      expect(typeField.enum).toContain("sse");
      expect(typeField.enum).toContain("streamable-http");
    });
  });

  describe("plugins.schema.json", () => {
    it("defines Plugin in $defs", () => {
      const schema = loadSchema("plugins") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      expect(defs).toHaveProperty("Plugin");
    });

    it("Plugin requires id, description, type, command", () => {
      const schema = loadSchema("plugins") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      const plugin = defs.Plugin as Record<string, unknown>;
      expect(plugin.required).toContain("id");
      expect(plugin.required).toContain("description");
      expect(plugin.required).toContain("type");
      expect(plugin.required).toContain("command");
    });
  });

  describe("roots.schema.json", () => {
    it("defines Root in $defs", () => {
      const schema = loadSchema("roots") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      expect(defs).toHaveProperty("Root");
    });

    it("Root requires name and description", () => {
      const schema = loadSchema("roots") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      const root = defs.Root as Record<string, unknown>;
      expect(root.required).toContain("name");
      expect(root.required).toContain("description");
    });

    it("Root has default_mcp_servers, default_skills arrays", () => {
      const schema = loadSchema("roots") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      const root = defs.Root as Record<string, unknown>;
      const props = root.properties as Record<string, unknown>;
      const mcpServers = props.default_mcp_servers as Record<
        string,
        unknown
      >;
      const skills = props.default_skills as Record<string, unknown>;
      expect(mcpServers.type).toBe("array");
      expect(skills.type).toBe("array");
    });
  });

  describe("hooks.schema.json", () => {
    it("defines Hook in $defs", () => {
      const schema = loadSchema("hooks") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      expect(defs).toHaveProperty("Hook");
    });

    it("Hook requires id, description, event, command", () => {
      const schema = loadSchema("hooks") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      const hook = defs.Hook as Record<string, unknown>;
      expect(hook.required).toContain("id");
      expect(hook.required).toContain("description");
      expect(hook.required).toContain("event");
      expect(hook.required).toContain("command");
    });

    it("event enum includes all lifecycle events", () => {
      const schema = loadSchema("hooks") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      const hook = defs.Hook as Record<string, unknown>;
      const props = hook.properties as Record<string, unknown>;
      const event = props.event as Record<string, unknown>;
      const events = event.enum as string[];
      expect(events).toContain("session_start");
      expect(events).toContain("session_end");
      expect(events).toContain("pre_tool_call");
      expect(events).toContain("post_tool_call");
      expect(events).toContain("pre_commit");
      expect(events).toContain("post_commit");
      expect(events).toContain("notification");
    });
  });

  describe("references.schema.json", () => {
    it("defines Reference in $defs", () => {
      const schema = loadSchema("references") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      expect(defs).toHaveProperty("Reference");
    });

    it("Reference requires id, description, file", () => {
      const schema = loadSchema("references") as Record<string, unknown>;
      const defs = schema.$defs as Record<string, unknown>;
      const ref = defs.Reference as Record<string, unknown>;
      expect(ref.required).toContain("id");
      expect(ref.required).toContain("description");
      expect(ref.required).toContain("file");
    });
  });
});
