import { describe, it, expect } from "vitest";
import { validateJson } from "../src/lib/validator.js";
import {
  exampleSkill,
  exampleMcpStdio,
  exampleMcpHttp,
  examplePlugin,
  exampleRoot,
  exampleHook,
  exampleReference,
} from "./helpers.js";

describe("Validator", () => {
  describe("air.json validation", () => {
    it("validates minimal air.json (name only)", () => {
      const result = validateJson({ name: "test" }, "air");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("validates full air.json with arrays", () => {
      const result = validateJson(
        {
          name: "acme-engineering",
          description: "Acme Corp engineering configs",
          skills: ["./skills/skills.json"],
          references: ["./references/references.json"],
          mcp: ["./org-mcp.json", "./mcp/mcp.json"],
          plugins: ["./plugins/plugins.json"],
          roots: ["./roots/roots.json"],
          hooks: ["./hooks/hooks.json"],
        },
        "air"
      );
      expect(result.valid).toBe(true);
    });

    it("rejects air.json with string paths (must be arrays)", () => {
      const result = validateJson(
        {
          name: "test",
          skills: "./skills.json",
        },
        "air"
      );
      expect(result.valid).toBe(false);
    });

    it("rejects air.json without name", () => {
      const result = validateJson({ description: "no name" }, "air");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects air.json with invalid name pattern", () => {
      const result = validateJson(
        { name: "invalid name with spaces" },
        "air"
      );
      expect(result.valid).toBe(false);
    });

    it("rejects air.json with additional properties", () => {
      const result = validateJson(
        { name: "test", unknownField: true },
        "air"
      );
      expect(result.valid).toBe(false);
    });

    it("allows $schema field", () => {
      const result = validateJson(
        { $schema: "./schemas/air.schema.json", name: "test" },
        "air"
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("skills.json validation", () => {
    it("validates empty skills.json", () => {
      const result = validateJson({}, "skills");
      expect(result.valid).toBe(true);
    });

    it("validates skills.json with $schema only", () => {
      const result = validateJson(
        { $schema: "./schemas/skills.schema.json" },
        "skills"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a skill with required fields only", () => {
      const result = validateJson(
        {
          "my-skill": {
            id: "my-skill",
            description: "A test skill",
            path: "skills/my-skill",
          },
        },
        "skills"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a skill with all fields", () => {
      const result = validateJson(
        { "deploy-staging": exampleSkill("deploy-staging") },
        "skills"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a skill with references", () => {
      const result = validateJson(
        {
          "my-skill": exampleSkill("my-skill", {
            references: ["git-workflow", "code-standards"],
          }),
        },
        "skills"
      );
      expect(result.valid).toBe(true);
    });

    it("rejects skill without id", () => {
      const result = validateJson(
        {
          "my-skill": { description: "no id", path: "skills/my-skill" },
        },
        "skills"
      );
      expect(result.valid).toBe(false);
    });

    it("rejects skill without description", () => {
      const result = validateJson(
        { "my-skill": { id: "my-skill", path: "skills/my-skill" } },
        "skills"
      );
      expect(result.valid).toBe(false);
    });

    it("rejects skill without path", () => {
      const result = validateJson(
        { "my-skill": { id: "my-skill", description: "no path" } },
        "skills"
      );
      expect(result.valid).toBe(false);
    });

    it("validates multiple skills", () => {
      const result = validateJson(
        {
          "skill-a": exampleSkill("skill-a"),
          "skill-b": exampleSkill("skill-b"),
          "skill-c": exampleSkill("skill-c"),
        },
        "skills"
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("references.json validation", () => {
    it("validates empty references.json", () => {
      const result = validateJson({}, "references");
      expect(result.valid).toBe(true);
    });

    it("validates a reference with required fields", () => {
      const result = validateJson(
        {
          "git-workflow": {
            id: "git-workflow",
            description: "Git conventions",
            file: "references/GIT_WORKFLOW.md",
          },
        },
        "references"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a reference with all fields", () => {
      const result = validateJson(
        { "git-workflow": exampleReference("git-workflow") },
        "references"
      );
      expect(result.valid).toBe(true);
    });

    it("rejects reference without file", () => {
      const result = validateJson(
        {
          "no-file": { id: "no-file", description: "missing file" },
        },
        "references"
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("mcp.json validation", () => {
    it("validates empty mcp.json", () => {
      const result = validateJson({}, "mcp");
      expect(result.valid).toBe(true);
    });

    it("validates stdio server", () => {
      const result = validateJson(
        { "test-server": exampleMcpStdio() },
        "mcp"
      );
      expect(result.valid).toBe(true);
    });

    it("validates streamable-http server", () => {
      const result = validateJson(
        { "test-server": exampleMcpHttp() },
        "mcp"
      );
      expect(result.valid).toBe(true);
    });

    it("validates sse server", () => {
      const result = validateJson(
        {
          "test-server": {
            type: "sse",
            url: "https://mcp.example.com/sse",
          },
        },
        "mcp"
      );
      expect(result.valid).toBe(true);
    });

    it("validates stdio server with minimal fields", () => {
      const result = validateJson(
        { "test-server": { type: "stdio", command: "npx" } },
        "mcp"
      );
      expect(result.valid).toBe(true);
    });

    it("rejects server without type", () => {
      const result = validateJson(
        { "test-server": { command: "npx" } },
        "mcp"
      );
      expect(result.valid).toBe(false);
    });

    it("rejects stdio server without command", () => {
      const result = validateJson(
        { "test-server": { type: "stdio" } },
        "mcp"
      );
      expect(result.valid).toBe(false);
    });

    it("rejects remote server without url", () => {
      const result = validateJson(
        { "test-server": { type: "streamable-http" } },
        "mcp"
      );
      expect(result.valid).toBe(false);
    });

    it("validates multiple servers of different types", () => {
      const result = validateJson(
        {
          local: exampleMcpStdio(),
          remote: exampleMcpHttp(),
          sse: { type: "sse", url: "https://mcp.example.com/sse" },
        },
        "mcp"
      );
      expect(result.valid).toBe(true);
    });

    it("validates server with env variable interpolation syntax", () => {
      const result = validateJson(
        {
          "test-server": {
            type: "stdio",
            command: "npx",
            args: ["-y", "test@1.0.0"],
            env: {
              API_KEY: "${MY_API_KEY}",
              DB_URL:
                "postgresql://${PG_USER}:${PG_PASS}@localhost:5432/db",
            },
          },
        },
        "mcp"
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("plugins.json validation", () => {
    it("validates empty plugins.json", () => {
      const result = validateJson({}, "plugins");
      expect(result.valid).toBe(true);
    });

    it("validates a plugin with required fields", () => {
      const result = validateJson(
        {
          "my-plugin": {
            id: "my-plugin",
            description: "A plugin",
            type: "command",
            command: "npx",
          },
        },
        "plugins"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a plugin with all fields", () => {
      const result = validateJson(
        { "my-plugin": examplePlugin("my-plugin") },
        "plugins"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a plugin with timeout", () => {
      const result = validateJson(
        {
          "my-plugin": examplePlugin("my-plugin", {
            timeout_seconds: 120,
          }),
        },
        "plugins"
      );
      expect(result.valid).toBe(true);
    });

    it("rejects plugin without type", () => {
      const result = validateJson(
        {
          "my-plugin": {
            id: "my-plugin",
            description: "no type",
            command: "npx",
          },
        },
        "plugins"
      );
      expect(result.valid).toBe(false);
    });

    it("rejects plugin without command", () => {
      const result = validateJson(
        {
          "my-plugin": {
            id: "my-plugin",
            description: "no command",
            type: "command",
          },
        },
        "plugins"
      );
      expect(result.valid).toBe(false);
    });

    it("rejects plugin with invalid type", () => {
      const result = validateJson(
        {
          "my-plugin": {
            id: "my-plugin",
            description: "bad type",
            type: "invalid",
            command: "npx",
          },
        },
        "plugins"
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("roots.json validation", () => {
    it("validates empty roots.json", () => {
      const result = validateJson({}, "roots");
      expect(result.valid).toBe(true);
    });

    it("validates a root with required fields only", () => {
      const result = validateJson(
        {
          "my-root": {
            name: "my-root",
            description: "A test root",
          },
        },
        "roots"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a root with all fields", () => {
      const result = validateJson(
        { "web-app": exampleRoot("web-app") },
        "roots"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a root with default artifacts", () => {
      const result = validateJson(
        {
          "my-root": exampleRoot("my-root", {
            default_mcp_servers: ["github", "postgres"],
            default_skills: ["deploy", "review"],
            default_plugins: ["lint"],
            default_hooks: ["notify"],
          }),
        },
        "roots"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a root with subdirectory (monorepo)", () => {
      const result = validateJson(
        {
          "api-service": exampleRoot("api-service", {
            subdirectory: "services/api",
          }),
        },
        "roots"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a root with stop condition", () => {
      const result = validateJson(
        {
          "my-root": exampleRoot("my-root", {
            default_stop_condition: "open-reviewed-green-pr",
          }),
        },
        "roots"
      );
      expect(result.valid).toBe(true);
    });

    it("rejects root without name", () => {
      const result = validateJson(
        { "my-root": { description: "no name" } },
        "roots"
      );
      expect(result.valid).toBe(false);
    });

    it("rejects root without description", () => {
      const result = validateJson(
        { "my-root": { name: "my-root" } },
        "roots"
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("hooks.json validation", () => {
    it("validates empty hooks.json", () => {
      const result = validateJson({}, "hooks");
      expect(result.valid).toBe(true);
    });

    it("validates a hook with required fields", () => {
      const result = validateJson(
        {
          "my-hook": {
            id: "my-hook",
            description: "A hook",
            event: "session_start",
            command: "echo",
          },
        },
        "hooks"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a hook with all fields", () => {
      const result = validateJson(
        { "my-hook": exampleHook("my-hook") },
        "hooks"
      );
      expect(result.valid).toBe(true);
    });

    it("validates hooks for all event types", () => {
      const events = [
        "session_start",
        "session_end",
        "pre_tool_call",
        "post_tool_call",
        "pre_commit",
        "post_commit",
        "notification",
      ];
      for (const event of events) {
        const result = validateJson(
          {
            [`hook-${event}`]: exampleHook(`hook-${event}`, { event }),
          },
          "hooks"
        );
        expect(result.valid).toBe(true);
      }
    });

    it("validates a hook with matcher", () => {
      const result = validateJson(
        {
          "my-hook": exampleHook("my-hook", {
            event: "pre_tool_call",
            matcher: "deploy.*production",
          }),
        },
        "hooks"
      );
      expect(result.valid).toBe(true);
    });

    it("rejects hook without event", () => {
      const result = validateJson(
        {
          "my-hook": {
            id: "my-hook",
            description: "no event",
            command: "echo",
          },
        },
        "hooks"
      );
      expect(result.valid).toBe(false);
    });

    it("rejects hook with invalid event", () => {
      const result = validateJson(
        {
          "my-hook": {
            id: "my-hook",
            description: "bad event",
            event: "invalid_event",
            command: "echo",
          },
        },
        "hooks"
      );
      expect(result.valid).toBe(false);
    });
  });
});

describe("Example Files Validation", () => {
  const { readFileSync } = require("fs");
  const { resolve } = require("path");

  const examplesDir = resolve(__dirname, "../../examples");

  const exampleFiles: [string, string][] = [
    ["air.json", "air"],
    ["skills/skills.json", "skills"],
    ["references/references.json", "references"],
    ["mcp/mcp.json", "mcp"],
    ["plugins/plugins.json", "plugins"],
    ["roots/roots.json", "roots"],
    ["hooks/hooks.json", "hooks"],
  ];

  for (const [filename, schemaType] of exampleFiles) {
    it(`examples/${filename} passes validation`, () => {
      const filePath = resolve(examplesDir, filename);
      const content = readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      const result = validateJson(data, schemaType as any);
      expect(result.valid).toBe(true);
    });
  }
});
