import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { resolveArtifacts } from "../src/config.js";
import { createTempAirDir, exampleSkill, exampleMcpStdio } from "./helpers.js";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

// A plugin entry may externalize its body into a `.plugin/plugin.json` manifest
// referenced by `path`. The index entry then stays a lightweight registry
// (description + path + default_in_roots), while bundled artifact references and
// distribution metadata live with the plugin. These tests exercise that
// hydration: merge precedence, scope qualification, and error surfaces.

describe("plugin manifest hydration", () => {
  it("hydrates a thin index entry from its .plugin/plugin.json body", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
        plugins: ["./plugins.json"],
      },
      "skills.json": {
        lint: exampleSkill("lint"),
        format: exampleSkill("format"),
      },
      "mcp.json": { "eslint-server": exampleMcpStdio() },
      "plugins.json": {
        "dev-tools": {
          description: "Developer tooling",
          path: "./plugins/dev-tools",
        },
      },
      "plugins/dev-tools/.plugin/plugin.json": {
        name: "dev-tools",
        title: "Dev Tools",
        version: "2.1.0",
        skills: ["lint", "format"],
        mcp_servers: ["eslint-server"],
        author: { name: "Jane Dev" },
        license: "MIT",
        keywords: ["lint", "format"],
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    const plugin = artifacts.plugins["@local/dev-tools"];

    expect(plugin.description).toBe("Developer tooling");
    expect(plugin.title).toBe("Dev Tools");
    expect(plugin.version).toBe("2.1.0");
    expect(plugin.author).toEqual({ name: "Jane Dev" });
    expect(plugin.license).toBe("MIT");
    expect(plugin.keywords).toEqual(["lint", "format"]);
    // Manifest reference arrays are qualified under the catalog's scope.
    expect(plugin.skills).toEqual(["@local/lint", "@local/format"]);
    expect(plugin.mcp_servers).toEqual(["@local/eslint-server"]);
  });

  it("lets inline index fields take precedence over the manifest", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        plugins: ["./plugins.json"],
      },
      "skills.json": {
        lint: exampleSkill("lint"),
        deploy: exampleSkill("deploy"),
      },
      "plugins.json": {
        "dev-tools": {
          description: "Overridden description",
          version: "9.9.9",
          skills: ["deploy"],
          path: "./plugins/dev-tools",
        },
      },
      "plugins/dev-tools/.plugin/plugin.json": {
        description: "Manifest description (ignored)",
        version: "2.1.0",
        skills: ["lint"],
        license: "MIT",
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    const plugin = artifacts.plugins["@local/dev-tools"];

    // Inline wins for fields declared on the entry...
    expect(plugin.description).toBe("Overridden description");
    expect(plugin.version).toBe("9.9.9");
    expect(plugin.skills).toEqual(["@local/deploy"]);
    // ...manifest still fills the gaps the entry leaves open.
    expect(plugin.license).toBe("MIT");
  });

  it("keeps default_in_roots on the thin index entry", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        roots: ["./roots.json"],
        plugins: ["./plugins.json"],
      },
      "skills.json": { lint: exampleSkill("lint") },
      "roots.json": {
        web: {
          display_name: "Web",
          description: "Web root",
          url: "https://github.com/test/web.git",
          default_branch: "main",
          user_invocable: true,
        },
      },
      "plugins.json": {
        "dev-tools": {
          description: "Developer tooling",
          path: "./plugins/dev-tools",
          default_in_roots: ["web"],
        },
      },
      "plugins/dev-tools/.plugin/plugin.json": {
        skills: ["lint"],
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));

    // Membership folds into the root's computed default_plugins, exactly as it
    // would for a fully-inline plugin entry.
    expect(artifacts.roots["@local/web"].default_plugins).toContain(
      "@local/dev-tools",
    );
    // The transient field is stripped from the resolved plugin entry.
    expect(artifacts.plugins["@local/dev-tools"].default_in_roots).toBeUndefined();
  });

  it("resolves manifest path relative to the index file directory", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./catalog/skills.json"],
        plugins: ["./catalog/plugins.json"],
      },
      "catalog/skills.json": { lint: exampleSkill("lint") },
      "catalog/plugins.json": {
        "dev-tools": {
          description: "Developer tooling",
          path: "./plugins/dev-tools",
        },
      },
      "catalog/plugins/dev-tools/.plugin/plugin.json": {
        skills: ["lint"],
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.plugins["@local/dev-tools"].skills).toEqual([
      "@local/lint",
    ]);
  });

  it("throws a clear error when the manifest is missing", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": { name: "test", plugins: ["./plugins.json"] },
      "plugins.json": {
        "dev-tools": {
          description: "Developer tooling",
          path: "./plugins/dev-tools",
        },
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /Plugin "dev-tools".*no manifest was found.*\.plugin\/plugin\.json/s,
    );
  });

  it("throws when the manifest is not valid JSON", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": { name: "test", plugins: ["./plugins.json"] },
      "plugins.json": {
        "dev-tools": {
          description: "Developer tooling",
          path: "./plugins/dev-tools",
        },
      },
      "plugins/dev-tools/.plugin/plugin.json": "{ not valid json",
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /Plugin "dev-tools".*unparseable manifest/s,
    );
  });

  it("throws when a manifest reference field is not an array of strings", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": { name: "test", plugins: ["./plugins.json"] },
      "plugins.json": {
        "dev-tools": {
          description: "Developer tooling",
          path: "./plugins/dev-tools",
        },
      },
      "plugins/dev-tools/.plugin/plugin.json": {
        skills: "lint",
      },
    });
    cleanup = c;

    await expect(resolveArtifacts(join(dir, "air.json"))).rejects.toThrow(
      /Plugin "dev-tools" field "skills" must be an array of strings/,
    );
  });

  it("leaves fully-inline plugin entries (no path) untouched", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        plugins: ["./plugins.json"],
      },
      "skills.json": { lint: exampleSkill("lint") },
      "plugins.json": {
        "dev-tools": {
          description: "Developer tooling",
          skills: ["lint"],
        },
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    expect(artifacts.plugins["@local/dev-tools"].skills).toEqual([
      "@local/lint",
    ]);
  });

  it("expands plugin-to-plugin references sourced from a manifest", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        plugins: ["./plugins.json"],
      },
      "skills.json": {
        lint: exampleSkill("lint"),
        deploy: exampleSkill("deploy"),
      },
      "plugins.json": {
        base: {
          description: "Base plugin",
          skills: ["lint"],
        },
        extended: {
          description: "Extended plugin",
          path: "./plugins/extended",
        },
      },
      "plugins/extended/.plugin/plugin.json": {
        plugins: ["base"],
        skills: ["deploy"],
      },
    });
    cleanup = c;

    const artifacts = await resolveArtifacts(join(dir, "air.json"));
    // Manifest-sourced plugin reference is expanded just like an inline one.
    expect(artifacts.plugins["@local/extended"].skills).toEqual([
      "@local/lint",
      "@local/deploy",
    ]);
  });
});
