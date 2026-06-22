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

  // A broken manifest must not abort resolution: during the inline→manifest
  // migration window (issue #157) a half-migrated or malformed plugin should
  // degrade to a warning and drop only that plugin, never fail `prepare` for
  // sessions that don't even use it.
  it("warns and drops a plugin (does not throw) when its manifest is missing", async () => {
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

    const warnings: string[] = [];
    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts.plugins["@local/dev-tools"]).toBeUndefined();
    expect(
      warnings.find((w) =>
        /Plugin "dev-tools".*dropped.*no manifest was found/s.test(w),
      ),
    ).toBeDefined();
  });

  it("warns and drops a plugin (does not throw) when its manifest is not valid JSON", async () => {
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

    const warnings: string[] = [];
    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts.plugins["@local/dev-tools"]).toBeUndefined();
    expect(
      warnings.find((w) =>
        /Plugin "dev-tools".*dropped.*unparseable manifest/s.test(w),
      ),
    ).toBeDefined();
  });

  it("warns and drops a plugin (does not throw) when a manifest reference field is not an array of strings", async () => {
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

    const warnings: string[] = [];
    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts.plugins["@local/dev-tools"]).toBeUndefined();
    expect(
      warnings.find((w) =>
        /dropped.*Plugin "dev-tools" field "skills" must be an array of strings/s.test(
          w,
        ),
      ),
    ).toBeDefined();
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

  it("warns when a plugin declares its body inline instead of via path", async () => {
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
          version: "1.0.0",
          skills: ["lint"],
        },
      },
    });
    cleanup = c;

    const warnings: string[] = [];
    // Resolution must SUCCEED during the deprecation window — the inline body
    // is still honored, only warned about. (Regression guard for issue #157:
    // a deprecated-but-supported format must never abort `prepare`.)
    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    const deprecation = warnings.find((w) =>
      /Plugin "dev-tools".*deprecated as of v0\.13\.0/s.test(w),
    );
    expect(deprecation).toBeDefined();
    // The warning names the offending inline fields and points at the issue.
    expect(deprecation).toMatch(/version/);
    expect(deprecation).toMatch(/skills/);
    expect(deprecation).toMatch(/issues\/157/);
    // The inline plugin is still resolved (warned, not dropped) and its inline
    // body is honored.
    expect(artifacts.plugins["@local/dev-tools"]).toBeDefined();
    expect(artifacts.plugins["@local/dev-tools"].skills).toEqual([
      "@local/lint",
    ]);
  });

  it("does not warn when a manifest-backed plugin overrides fields inline", async () => {
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
          description: "Developer tooling",
          // Inline override on top of a manifest is the sanctioned new feature,
          // not the deprecated inline-only form — it must stay quiet.
          version: "9.9.9",
          path: "./plugins/dev-tools",
        },
      },
      "plugins/dev-tools/.plugin/plugin.json": {
        version: "1.0.0",
        skills: ["lint"],
      },
    });
    cleanup = c;

    const warnings: string[] = [];
    await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    expect(
      warnings.find((w) => /deprecated as of v0\.13\.0/.test(w)),
    ).toBeUndefined();
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

  it("isolates a broken plugin manifest — sibling plugins in the same index still resolve", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        plugins: ["./plugins.json"],
      },
      "skills.json": { lint: exampleSkill("lint") },
      "plugins.json": {
        // Broken: declares a manifest path, but no manifest file exists.
        broken: {
          description: "Half-migrated plugin",
          path: "./plugins/broken",
        },
        // Healthy sibling in the same index file.
        good: {
          description: "Healthy plugin",
          path: "./plugins/good",
        },
      },
      "plugins/good/.plugin/plugin.json": {
        skills: ["lint"],
      },
    });
    cleanup = c;

    const warnings: string[] = [];
    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    // The broken plugin is dropped with a warning; the healthy one survives.
    expect(artifacts.plugins["@local/broken"]).toBeUndefined();
    expect(artifacts.plugins["@local/good"]).toBeDefined();
    expect(artifacts.plugins["@local/good"].skills).toEqual(["@local/lint"]);
    expect(
      warnings.find((w) => /Plugin "broken".*dropped/s.test(w)),
    ).toBeDefined();
  });

  it("isolates a malformed catalog index — other indexes still resolve a multi-source prepare", async () => {
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        // Two plugin sources: one is malformed JSON, the other is healthy.
        plugins: ["./broken/plugins.json", "./good/plugins.json"],
      },
      "skills.json": { lint: exampleSkill("lint") },
      "broken/plugins.json": "{ not valid json at all",
      "good/plugins.json": {
        "dev-tools": {
          description: "Developer tooling",
          skills: ["lint"],
        },
      },
    });
    cleanup = c;

    const warnings: string[] = [];
    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    // The malformed index is skipped with a warning; the healthy catalog's
    // plugin still resolves. One catalog's parse problem does not abort the
    // whole prepare.
    expect(artifacts.plugins["@local/dev-tools"]).toBeDefined();
    expect(artifacts.plugins["@local/dev-tools"].skills).toEqual([
      "@local/lint",
    ]);
    expect(
      warnings.find((w) =>
        /Skipping plugins index ".*broken\/plugins\.json"/s.test(w),
      ),
    ).toBeDefined();
  });
});
