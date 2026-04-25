import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import {
  resolveArtifacts,
  expandPlugins,
  mergeArtifacts,
  emptyArtifacts,
} from "../src/config.js";
import { createTempAirDir, examplePlugin } from "./helpers.js";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

// expandPlugins is purely a graph operation over whatever keys appear in
// `artifacts.plugins` — it does not require qualified IDs. The unit tests
// below use bare keys for clarity. Integration tests that go through
// resolveArtifacts always see qualified keys.

describe("expandPlugins", () => {
  it("returns plugins unchanged when no plugins field is present", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "simple": {
        description: "A simple plugin",
        skills: ["lint"],
        mcp_servers: ["eslint-server"],
        hooks: ["pre-commit"],
      },
    };

    const result = expandPlugins(artifacts);

    expect(result.plugins["simple"].skills).toEqual(["lint"]);
    expect(result.plugins["simple"].mcp_servers).toEqual(["eslint-server"]);
    expect(result.plugins["simple"].hooks).toEqual(["pre-commit"]);
  });

  it("returns plugins unchanged when plugins array is empty", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "simple": {
        description: "A simple plugin",
        plugins: [],
        skills: ["lint"],
      },
    };

    const result = expandPlugins(artifacts);

    expect(result.plugins["simple"].skills).toEqual(["lint"]);
  });

  it("expands single-level plugin references", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "base": {
        description: "Base plugin",
        skills: ["lint", "format"],
        mcp_servers: ["eslint-server"],
        hooks: ["pre-commit"],
      },
      "extended": {
        description: "Extended plugin",
        plugins: ["base"],
        skills: ["deploy"],
        mcp_servers: ["deploy-server"],
      },
    };

    const result = expandPlugins(artifacts);

    expect(result.plugins["extended"].skills).toEqual([
      "lint",
      "format",
      "deploy",
    ]);
    expect(result.plugins["extended"].mcp_servers).toEqual([
      "eslint-server",
      "deploy-server",
    ]);
    expect(result.plugins["extended"].hooks).toEqual(["pre-commit"]);
    expect(result.plugins["base"].skills).toEqual(["lint", "format"]);
  });

  it("expands recursive plugin references (A includes B includes C)", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "c": {
        description: "Plugin C",
        skills: ["skill-c"],
        hooks: ["hook-c"],
      },
      "b": {
        description: "Plugin B",
        plugins: ["c"],
        skills: ["skill-b"],
        mcp_servers: ["server-b"],
      },
      "a": {
        description: "Plugin A",
        plugins: ["b"],
        skills: ["skill-a"],
      },
    };

    const result = expandPlugins(artifacts);

    expect(result.plugins["a"].skills).toEqual([
      "skill-c",
      "skill-b",
      "skill-a",
    ]);
    expect(result.plugins["a"].mcp_servers).toEqual(["server-b"]);
    expect(result.plugins["a"].hooks).toEqual(["hook-c"]);

    expect(result.plugins["b"].skills).toEqual(["skill-c", "skill-b"]);
    expect(result.plugins["b"].mcp_servers).toEqual(["server-b"]);
    expect(result.plugins["b"].hooks).toEqual(["hook-c"]);

    expect(result.plugins["c"].skills).toEqual(["skill-c"]);
  });

  it("deduplicates primitives referenced via multiple paths", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "shared": {
        description: "Shared plugin",
        skills: ["common-skill"],
        mcp_servers: ["common-server"],
      },
      "child-a": {
        description: "Child A",
        plugins: ["shared"],
        skills: ["skill-a"],
      },
      "child-b": {
        description: "Child B",
        plugins: ["shared"],
        skills: ["skill-b"],
      },
      "parent": {
        description: "Parent plugin",
        plugins: ["child-a", "child-b"],
        skills: ["common-skill"],
      },
    };

    const result = expandPlugins(artifacts);

    expect(result.plugins["parent"].skills).toEqual([
      "skill-a",
      "skill-b",
      "common-skill",
    ]);

    expect(result.plugins["parent"].mcp_servers).toEqual(["common-server"]);
  });

  it("parent direct declarations take precedence (appear after children)", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "child": {
        description: "Child plugin",
        skills: ["shared-skill", "child-only"],
      },
      "parent": {
        description: "Parent plugin",
        plugins: ["child"],
        skills: ["shared-skill", "parent-only"],
      },
    };

    const result = expandPlugins(artifacts);

    const skills = result.plugins["parent"].skills!;
    expect(skills).toEqual(["child-only", "shared-skill", "parent-only"]);
  });

  it("detects direct circular dependency (A → B → A)", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "a": {
        description: "Plugin A",
        plugins: ["b"],
      },
      "b": {
        description: "Plugin B",
        plugins: ["a"],
      },
    };

    expect(() => expandPlugins(artifacts)).toThrow(
      /Circular plugin dependency detected: a → b → a/,
    );
  });

  it("detects self-referencing plugin", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "self": {
        description: "Self-referencing plugin",
        plugins: ["self"],
      },
    };

    expect(() => expandPlugins(artifacts)).toThrow(
      /Circular plugin dependency detected: self → self/,
    );
  });

  it("detects indirect circular dependency (A → B → C → A)", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "a": {
        description: "Plugin A",
        plugins: ["b"],
        skills: ["skill-a"],
      },
      "b": {
        description: "Plugin B",
        plugins: ["c"],
        skills: ["skill-b"],
      },
      "c": {
        description: "Plugin C",
        plugins: ["a"],
        skills: ["skill-c"],
      },
    };

    expect(() => expandPlugins(artifacts)).toThrow(
      /Circular plugin dependency detected: a → b → c → a/,
    );
  });

  it("throws when a referenced plugin does not exist", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "parent": {
        description: "Parent plugin",
        plugins: ["nonexistent"],
      },
    };

    expect(() => expandPlugins(artifacts)).toThrow(
      /Plugin "nonexistent" referenced by "parent" not found/,
    );
  });

  it("does not modify non-plugin artifact types", () => {
    const artifacts = emptyArtifacts();
    artifacts.skills = { "my-skill": { description: "test", path: "/test" } };
    artifacts.plugins = {
      "simple": {
        description: "A plugin",
        skills: ["my-skill"],
      },
    };

    const result = expandPlugins(artifacts);

    expect(result.skills).toEqual(artifacts.skills);
    expect(result.mcp).toEqual(artifacts.mcp);
    expect(result.roots).toEqual(artifacts.roots);
    expect(result.hooks).toEqual(artifacts.hooks);
    expect(result.references).toEqual(artifacts.references);
  });

  it("handles multiple child plugins in declaration order", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "first": {
        description: "First plugin",
        skills: ["skill-1"],
      },
      "second": {
        description: "Second plugin",
        skills: ["skill-2"],
      },
      "combined": {
        description: "Combined plugin",
        plugins: ["first", "second"],
        skills: ["skill-3"],
      },
    };

    const result = expandPlugins(artifacts);

    expect(result.plugins["combined"].skills).toEqual([
      "skill-1",
      "skill-2",
      "skill-3",
    ]);
  });

  it("omits empty primitive arrays after expansion", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "empty-child": {
        description: "Child with no primitives",
      },
      "parent": {
        description: "Parent that includes empty child",
        plugins: ["empty-child"],
      },
    };

    const result = expandPlugins(artifacts);

    expect(result.plugins["parent"].skills).toBeUndefined();
    expect(result.plugins["parent"].mcp_servers).toBeUndefined();
    expect(result.plugins["parent"].hooks).toBeUndefined();
  });

  it("preserves non-primitive plugin fields during expansion", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "child": {
        description: "Child plugin",
        skills: ["child-skill"],
      },
      "parent": {
        description: "Parent plugin",
        version: "2.0.0",
        plugins: ["child"],
        skills: ["parent-skill"],
        author: { name: "Test Author" },
        homepage: "https://example.com",
        license: "MIT",
        keywords: ["test"],
      },
    };

    const result = expandPlugins(artifacts);
    const parent = result.plugins["parent"];

    expect(parent.version).toBe("2.0.0");
    expect(parent.author).toEqual({ name: "Test Author" });
    expect(parent.homepage).toBe("https://example.com");
    expect(parent.license).toBe("MIT");
    expect(parent.keywords).toEqual(["test"]);
    expect(parent.plugins).toEqual(["child"]);
  });
});

describe("resolveArtifacts with plugin composition", () => {
  it("expands plugin references during resolution (qualified IDs)", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        plugins: ["./plugins.json"],
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
      },
      "plugins.json": {
        "base": {
          description: "Base plugin",
          skills: ["lint", "format"],
          mcp_servers: ["eslint-server"],
        },
        "full-stack": {
          description: "Full stack plugin",
          plugins: ["base"],
          skills: ["deploy"],
          mcp_servers: ["deploy-server"],
        },
      },
      "skills.json": {
        lint: { description: "Lint" },
        format: { description: "Format" },
        deploy: { description: "Deploy" },
      },
      "mcp.json": {
        "eslint-server": { type: "stdio", command: "eslint" },
        "deploy-server": { type: "stdio", command: "deploy" },
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.plugins["@local/full-stack"].skills).toEqual([
      "@local/lint",
      "@local/format",
      "@local/deploy",
    ]);
    expect(artifacts.plugins["@local/full-stack"].mcp_servers).toEqual([
      "@local/eslint-server",
      "@local/deploy-server",
    ]);
  });

  it("simple plugins without nested plugins field still get canonicalized references", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        plugins: ["./plugins.json"],
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
        hooks: ["./hooks.json"],
      },
      "plugins.json": {
        "simple": examplePlugin("simple", {
          skills: ["skill-a"],
          mcp_servers: ["server-a"],
          hooks: ["hook-a"],
        }),
      },
      "skills.json": { "skill-a": { description: "A" } },
      "mcp.json": { "server-a": { type: "stdio", command: "x" } },
      "hooks.json": { "hook-a": { description: "Hook A" } },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.plugins["@local/simple"].skills).toEqual([
      "@local/skill-a",
    ]);
    expect(artifacts.plugins["@local/simple"].mcp_servers).toEqual([
      "@local/server-a",
    ]);
    expect(artifacts.plugins["@local/simple"].hooks).toEqual([
      "@local/hook-a",
    ]);
    expect(artifacts.plugins["@local/simple"].plugins).toBeUndefined();
  });

  it("rejects circular plugin references during resolution", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        plugins: ["./plugins.json"],
      },
      "plugins.json": {
        "a": {
          description: "Plugin A",
          plugins: ["b"],
        },
        "b": {
          description: "Plugin B",
          plugins: ["a"],
        },
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /Circular plugin dependency detected/,
    );
  });

  it("expands cross-file plugin references (composite references plugin from another file)", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        plugins: ["./base-plugins.json", "./composite-plugins.json"],
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
      },
      "base-plugins.json": {
        "code-quality": {
          description: "Code quality tools",
          skills: ["lint", "format"],
          mcp_servers: ["eslint-server"],
        },
      },
      "composite-plugins.json": {
        "full-stack": {
          description: "Full stack plugin",
          plugins: ["code-quality"],
          skills: ["deploy"],
        },
      },
      "skills.json": {
        lint: { description: "Lint" },
        format: { description: "Format" },
        deploy: { description: "Deploy" },
      },
      "mcp.json": {
        "eslint-server": { type: "stdio", command: "eslint" },
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.plugins["@local/full-stack"].skills).toEqual([
      "@local/lint",
      "@local/format",
      "@local/deploy",
    ]);
    expect(artifacts.plugins["@local/full-stack"].mcp_servers).toEqual([
      "@local/eslint-server",
    ]);
  });
});

describe("mergeArtifacts with plugin composition", () => {
  it("re-expands composite plugins after merging", () => {
    const base = emptyArtifacts();
    base.plugins = {
      "@local/code-quality": {
        description: "Code quality tools",
        skills: ["@local/lint"],
      },
    };

    const overlay = emptyArtifacts();
    overlay.plugins = {
      "@local/full-stack": {
        description: "Full stack plugin",
        plugins: ["@local/code-quality"],
        skills: ["@local/deploy"],
      },
    };

    const result = mergeArtifacts(base, overlay);

    expect(result.plugins["@local/full-stack"].skills).toEqual([
      "@local/lint",
      "@local/deploy",
    ]);
    expect(result.plugins["@local/code-quality"].skills).toEqual([
      "@local/lint",
    ]);
  });
});
