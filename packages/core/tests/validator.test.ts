import { describe, it, expect } from "vitest";
import { validateJson } from "../src/validator.js";
import {
  exampleSkill,
  exampleMcpStdio,
  exampleMcpHttp,
  exampleRoot,
  exampleReference,
  examplePlugin,
  exampleHook,
} from "./helpers.js";

describe("validateJson", () => {
  describe("air.json", () => {
    it("validates a minimal air.json", () => {
      const result = validateJson({ name: "test" }, "air");
      expect(result.valid).toBe(true);
    });

    it("rejects air.json without name", () => {
      const result = validateJson({ description: "no name" }, "air");
      expect(result.valid).toBe(false);
    });

    it("validates air.json with all artifact arrays", () => {
      const result = validateJson(
        {
          name: "full",
          skills: ["./skills.json"],
          mcp: ["./mcp.json"],
          roots: ["./roots.json"],
          references: ["./refs.json"],
          plugins: ["./plugins.json"],
          hooks: ["./hooks.json"],
        },
        "air"
      );
      expect(result.valid).toBe(true);
    });

    it("accepts the per-type exclude object shape with exact and wildcard entries", () => {
      const result = validateJson(
        {
          name: "with-exclude",
          exclude: {
            skills: [
              "@customer/agentic-engineering/github",
              "@vendor/legacy/*",
              "@vendor/*/github",
              "@*/agentic-engineering/*",
            ],
            mcp: ["@some-scope/some-repo/github"],
            hooks: ["@other-scope/some-repo/legacy-hook"],
          },
        },
        "air"
      );
      expect(result.valid).toBe(true);
    });

    it("rejects the legacy flat-array exclude shape", () => {
      const result = validateJson(
        { name: "legacy", exclude: ["@local/lint"] },
        "air"
      );
      expect(result.valid).toBe(false);
    });

    it("rejects an exclude object with an unknown artifact-type key", () => {
      const result = validateJson(
        {
          name: "bad-key",
          exclude: { not_a_real_type: ["@local/lint"] },
        },
        "air"
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("skills.json", () => {
    it("validates a valid skill", () => {
      const result = validateJson(
        { "my-skill": exampleSkill("my-skill") },
        "skills"
      );
      expect(result.valid).toBe(true);
    });

    it("rejects skill without required fields", () => {
      const result = validateJson(
        { "bad-skill": { id: "bad-skill" } },
        "skills"
      );
      expect(result.valid).toBe(false);
    });

    it("validates skill with references", () => {
      const result = validateJson(
        {
          "my-skill": exampleSkill("my-skill", {
            references: ["git-workflow"],
          }),
        },
        "skills"
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("mcp.json", () => {
    it("validates a stdio server", () => {
      const result = validateJson(
        { "my-server": exampleMcpStdio() },
        "mcp"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a streamable-http server", () => {
      const result = validateJson(
        { "my-server": exampleMcpHttp() },
        "mcp"
      );
      expect(result.valid).toBe(true);
    });

    it("rejects server without type", () => {
      const result = validateJson(
        { "bad": { command: "npx" } },
        "mcp"
      );
      expect(result.valid).toBe(false);
    });

    it("validates a server with oauth.authServerMetadataUrl and oauth.clientSecret", () => {
      const result = validateJson(
        {
          "bigquery": exampleMcpHttp({
            url: "https://bigquery.googleapis.com/mcp",
            oauth: {
              clientId: "my-client",
              clientSecret: "${BQ_CLIENT_SECRET}",
              scopes: ["https://www.googleapis.com/auth/bigquery.readonly"],
              redirectUri: "http://localhost:8888/callback",
              authServerMetadataUrl:
                "https://accounts.google.com/.well-known/openid-configuration",
            },
          }),
        },
        "mcp"
      );
      expect(result.valid).toBe(true);
    });

    it("rejects oauth.authServerMetadataUrl that is not a URI", () => {
      const result = validateJson(
        {
          "bad": exampleMcpHttp({
            oauth: {
              authServerMetadataUrl: "not a uri with spaces",
            },
          }),
        },
        "mcp"
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("roots.json", () => {
    it("validates a valid root", () => {
      const result = validateJson(
        { "my-root": exampleRoot("my-root") },
        "roots"
      );
      expect(result.valid).toBe(true);
    });

    it("validates root with additional custom fields", () => {
      const result = validateJson(
        {
          "my-root": exampleRoot("my-root", {
            custom_field: "custom-value",
          }),
        },
        "roots"
      );
      expect(result.valid).toBe(true);
    });

    it("validates root with default_subagent_roots", () => {
      const result = validateJson(
        {
          "my-root": exampleRoot("my-root", {
            default_subagent_roots: ["sub-configs", "sub-research"],
          }),
        },
        "roots"
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("references.json", () => {
    it("validates a valid reference", () => {
      const result = validateJson(
        { "my-ref": exampleReference("my-ref") },
        "references"
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("plugins.json", () => {
    it("validates a valid plugin", () => {
      const result = validateJson(
        { "my-plugin": examplePlugin("my-plugin") },
        "plugins"
      );
      expect(result.valid).toBe(true);
    });

    it("validates a plugin with artifact references", () => {
      const result = validateJson(
        {
          "my-plugin": examplePlugin("my-plugin", {
            skills: ["lint-fix"],
            mcp_servers: ["eslint-server"],
            hooks: ["lint-pre-commit"],
          }),
        },
        "plugins"
      );
      expect(result.valid).toBe(true);
    });

    it("rejects plugin without required fields", () => {
      const result = validateJson(
        { "bad-plugin": { id: "bad-plugin" } },
        "plugins"
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("hooks.json", () => {
    it("validates a valid hook", () => {
      const result = validateJson(
        { "my-hook": exampleHook("my-hook") },
        "hooks"
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("additional properties", () => {
    it("accepts additional properties on air.json", () => {
      const result = validateJson(
        { name: "test", custom_field: "value" },
        "air"
      );
      expect(result.valid).toBe(true);
    });

    it("accepts additional properties on skills", () => {
      const result = validateJson(
        {
          "my-skill": exampleSkill("my-skill", {
            custom_field: "value",
          }),
        },
        "skills"
      );
      expect(result.valid).toBe(true);
    });

    it("accepts additional properties on references", () => {
      const result = validateJson(
        {
          "my-ref": exampleReference("my-ref", {
            custom_field: "value",
          }),
        },
        "references"
      );
      expect(result.valid).toBe(true);
    });

    it("accepts additional properties on hooks", () => {
      const result = validateJson(
        {
          "my-hook": exampleHook("my-hook", {
            custom_field: "value",
          }),
        },
        "hooks"
      );
      expect(result.valid).toBe(true);
    });

    it("accepts additional properties on plugins", () => {
      const result = validateJson(
        {
          "my-plugin": examplePlugin("my-plugin", {
            custom_field: "value",
          }),
        },
        "plugins"
      );
      expect(result.valid).toBe(true);
    });

    it("accepts additional properties on mcp servers", () => {
      const result = validateJson(
        {
          "my-server": exampleMcpStdio({
            custom_field: "value",
          }),
        },
        "mcp"
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("example files", () => {
    it("validates all example files from the repo", async () => {
      const { readFileSync } = await import("fs");
      const { resolve } = await import("path");

      const examplesDir = resolve(__dirname, "../../../examples");

      const files: [string, "air" | "skills" | "references" | "mcp" | "plugins" | "roots" | "hooks"][] = [
        ["air.json", "air"],
        ["skills/skills.json", "skills"],
        ["references/references.json", "references"],
        ["mcp/mcp.json", "mcp"],
        ["plugins/plugins.json", "plugins"],
        ["roots/roots.json", "roots"],
        ["hooks/hooks.json", "hooks"],
      ];

      for (const [file, schemaType] of files) {
        const content = readFileSync(resolve(examplesDir, file), "utf-8");
        const data = JSON.parse(content);
        const result = validateJson(data, schemaType);
        expect(result.valid, `${file} should be valid`).toBe(true);
      }
    });
  });
});
