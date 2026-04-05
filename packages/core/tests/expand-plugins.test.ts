import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import {
  resolveArtifacts,
  expandPlugins,
  emptyArtifacts,
} from "../src/config.js";
import { createTempAirDir, examplePlugin } from "./helpers.js";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("expandPlugins", () => {
  it("returns plugins unchanged when no plugins field is present", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "simple": {
        id: "simple",
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
        id: "simple",
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
        id: "base",
        description: "Base plugin",
        skills: ["lint", "format"],
        mcp_servers: ["eslint-server"],
        hooks: ["pre-commit"],
      },
      "extended": {
        id: "extended",
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
    // Base plugin remains unchanged
    expect(result.plugins["base"].skills).toEqual(["lint", "format"]);
  });

  it("expands recursive plugin references (A includes B includes C)", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "c": {
        id: "c",
        description: "Plugin C",
        skills: ["skill-c"],
        hooks: ["hook-c"],
      },
      "b": {
        id: "b",
        description: "Plugin B",
        plugins: ["c"],
        skills: ["skill-b"],
        mcp_servers: ["server-b"],
      },
      "a": {
        id: "a",
        description: "Plugin A",
        plugins: ["b"],
        skills: ["skill-a"],
      },
    };

    const result = expandPlugins(artifacts);

    // A should have all primitives from B and C, plus its own
    expect(result.plugins["a"].skills).toEqual([
      "skill-c",
      "skill-b",
      "skill-a",
    ]);
    expect(result.plugins["a"].mcp_servers).toEqual(["server-b"]);
    expect(result.plugins["a"].hooks).toEqual(["hook-c"]);

    // B should have primitives from C plus its own
    expect(result.plugins["b"].skills).toEqual(["skill-c", "skill-b"]);
    expect(result.plugins["b"].mcp_servers).toEqual(["server-b"]);
    expect(result.plugins["b"].hooks).toEqual(["hook-c"]);

    // C is unchanged
    expect(result.plugins["c"].skills).toEqual(["skill-c"]);
  });

  it("deduplicates primitives referenced via multiple paths", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "shared": {
        id: "shared",
        description: "Shared plugin",
        skills: ["common-skill"],
        mcp_servers: ["common-server"],
      },
      "child-a": {
        id: "child-a",
        description: "Child A",
        plugins: ["shared"],
        skills: ["skill-a"],
      },
      "child-b": {
        id: "child-b",
        description: "Child B",
        plugins: ["shared"],
        skills: ["skill-b"],
      },
      "parent": {
        id: "parent",
        description: "Parent plugin",
        plugins: ["child-a", "child-b"],
        skills: ["common-skill"], // Also directly declares common-skill
      },
    };

    const result = expandPlugins(artifacts);

    // common-skill appears only once despite being referenced by shared, child-a, child-b, and parent
    const skills = result.plugins["parent"].skills!;
    expect(skills.filter((s) => s === "common-skill")).toHaveLength(1);
    expect(skills).toContain("common-skill");
    expect(skills).toContain("skill-a");
    expect(skills).toContain("skill-b");

    // common-server from shared appears exactly once
    const servers = result.plugins["parent"].mcp_servers!;
    expect(servers.filter((s) => s === "common-server")).toHaveLength(1);
  });

  it("parent direct declarations take precedence (appear after children)", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "child": {
        id: "child",
        description: "Child plugin",
        skills: ["shared-skill", "child-only"],
      },
      "parent": {
        id: "parent",
        description: "Parent plugin",
        plugins: ["child"],
        skills: ["shared-skill", "parent-only"],
      },
    };

    const result = expandPlugins(artifacts);

    // shared-skill should appear once, and since parent also declares it,
    // it should be deduplicated with parent's version winning (last occurrence kept)
    const skills = result.plugins["parent"].skills!;
    expect(skills).toEqual(["child-only", "shared-skill", "parent-only"]);
  });

  it("detects direct circular dependency (A → B → A)", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "a": {
        id: "a",
        description: "Plugin A",
        plugins: ["b"],
      },
      "b": {
        id: "b",
        description: "Plugin B",
        plugins: ["a"],
      },
    };

    expect(() => expandPlugins(artifacts)).toThrow(
      /Circular plugin dependency detected: a → b → a/
    );
  });

  it("detects self-referencing plugin", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "self": {
        id: "self",
        description: "Self-referencing plugin",
        plugins: ["self"],
      },
    };

    expect(() => expandPlugins(artifacts)).toThrow(
      /Circular plugin dependency detected: self → self/
    );
  });

  it("detects indirect circular dependency (A → B → C → A)", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "a": {
        id: "a",
        description: "Plugin A",
        plugins: ["b"],
        skills: ["skill-a"],
      },
      "b": {
        id: "b",
        description: "Plugin B",
        plugins: ["c"],
        skills: ["skill-b"],
      },
      "c": {
        id: "c",
        description: "Plugin C",
        plugins: ["a"],
        skills: ["skill-c"],
      },
    };

    expect(() => expandPlugins(artifacts)).toThrow(
      /Circular plugin dependency detected: a → b → c → a/
    );
  });

  it("throws when a referenced plugin does not exist", () => {
    const artifacts = emptyArtifacts();
    artifacts.plugins = {
      "parent": {
        id: "parent",
        description: "Parent plugin",
        plugins: ["nonexistent"],
      },
    };

    expect(() => expandPlugins(artifacts)).toThrow(
      /Plugin "nonexistent" referenced by "parent" not found/
    );
  });

  it("does not modify non-plugin artifact types", () => {
    const artifacts = emptyArtifacts();
    artifacts.skills = { "my-skill": { id: "my-skill", description: "test", path: "/test" } };
    artifacts.plugins = {
      "simple": {
        id: "simple",
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
        id: "first",
        description: "First plugin",
        skills: ["skill-1"],
      },
      "second": {
        id: "second",
        description: "Second plugin",
        skills: ["skill-2"],
      },
      "combined": {
        id: "combined",
        description: "Combined plugin",
        plugins: ["first", "second"],
        skills: ["skill-3"],
      },
    };

    const result = expandPlugins(artifacts);

    // Skills from first, then second, then combined's own
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
        id: "empty-child",
        description: "Child with no primitives",
      },
      "parent": {
        id: "parent",
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
        id: "child",
        description: "Child plugin",
        skills: ["child-skill"],
      },
      "parent": {
        id: "parent",
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
  it("expands plugin references during resolution", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        plugins: ["./plugins.json"],
      },
      "plugins.json": {
        "base": {
          id: "base",
          description: "Base plugin",
          skills: ["lint", "format"],
          mcp_servers: ["eslint-server"],
        },
        "full-stack": {
          id: "full-stack",
          description: "Full stack plugin",
          plugins: ["base"],
          skills: ["deploy"],
          mcp_servers: ["deploy-server"],
        },
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.plugins["full-stack"].skills).toEqual([
      "lint",
      "format",
      "deploy",
    ]);
    expect(artifacts.plugins["full-stack"].mcp_servers).toEqual([
      "eslint-server",
      "deploy-server",
    ]);
  });

  it("backwards compatible: plugins without plugins field work identically", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        plugins: ["./plugins.json"],
      },
      "plugins.json": {
        "simple": examplePlugin("simple", {
          skills: ["skill-a"],
          mcp_servers: ["server-a"],
          hooks: ["hook-a"],
        }),
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    expect(artifacts.plugins["simple"].skills).toEqual(["skill-a"]);
    expect(artifacts.plugins["simple"].mcp_servers).toEqual(["server-a"]);
    expect(artifacts.plugins["simple"].hooks).toEqual(["hook-a"]);
    expect(artifacts.plugins["simple"].plugins).toBeUndefined();
  });

  it("rejects circular plugin references during resolution", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        plugins: ["./plugins.json"],
      },
      "plugins.json": {
        "a": {
          id: "a",
          description: "Plugin A",
          plugins: ["b"],
        },
        "b": {
          id: "b",
          description: "Plugin B",
          plugins: ["a"],
        },
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /Circular plugin dependency detected/
    );
  });
});
