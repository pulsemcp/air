import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { resolveArtifacts, CatalogConfigError } from "../src/config.js";
import type { CatalogProvider } from "../src/types.js";
import { createTempAirDir, exampleSkill, exampleMcpStdio } from "./helpers.js";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

// A plugin entry externalizes its body into a `.plugin/plugin.json` manifest
// referenced by `path`. The index entry stays a lightweight registry
// (description + path + default_in_roots), while bundled artifact references and
// distribution metadata live with the plugin. These tests exercise that
// hydration: merge precedence, scope qualification, and error surfaces —
// including the inline-only body (body fields with no `path`) that was
// deprecated in v0.13.0 and removed in
// https://github.com/pulsemcp/air/issues/157.

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

    // Membership folds into the root's computed default_plugins, from the thin
    // index entry — it is never read out of the manifest.
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

  // A broken manifest must not abort resolution: a half-migrated or malformed
  // plugin (path set before the manifest lands, or a manifest that won't parse)
  // degrades to a warning and drops only that plugin, never failing `prepare`
  // for sessions that don't even use it.
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

  it("hard-fails on a fully-inline plugin entry (no path), naming the plugin and the fields to move", async () => {
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
    // Removed in #157: the inline body no longer resolves with a warning, it
    // aborts resolution. Like an unregistered catalog scheme, this is an author
    // mistake in a catalog that was explicitly listed — degrading it to a
    // warning would silently drop the plugin from every session instead.
    const err = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CatalogConfigError);
    const message = (err as Error).message;
    // The error names the plugin, every offending field, where they go, and the
    // fields that stay behind on the index entry.
    expect(message).toMatch(/Plugin "dev-tools"/);
    expect(message).toMatch(/version/);
    expect(message).toMatch(/skills/);
    expect(message).toMatch(/\.plugin\/plugin\.json/);
    expect(message).toMatch(/description, path, and default_in_roots/);
    expect(message).toMatch(/issues\/157/);
    // It threw rather than degrading to a warning of any kind.
    expect(warnings).toEqual([]);
  });

  it("hard-fails an inline-only plugin even when other catalogs are healthy", async () => {
    // Per-source isolation must not swallow this into a "Skipping plugins
    // index" warning: a catalog the author explicitly listed would then vanish
    // silently, which is the outcome the removal exists to make visible.
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        plugins: ["./legacy/plugins.json", "./good/plugins.json"],
      },
      "skills.json": { lint: exampleSkill("lint") },
      "legacy/plugins.json": {
        "dev-tools": {
          description: "Developer tooling",
          skills: ["lint"],
        },
      },
      "good/plugins.json": {
        healthy: {
          description: "Healthy plugin",
          path: "./healthy",
        },
      },
      "good/healthy/.plugin/plugin.json": { skills: ["lint"] },
    });
    cleanup = c;

    const warnings: string[] = [];
    await expect(
      resolveArtifacts(join(dir, "air.json"), {
        onWarning: (m) => warnings.push(m),
      }),
    ).rejects.toBeInstanceOf(CatalogConfigError);
    expect(
      warnings.find((w) => /Skipping plugins index/.test(w)),
    ).toBeUndefined();
  });

  it("hard-fails an inline-only plugin that came from a remote catalog", async () => {
    // A consumer composing someone else's un-migrated catalog hits the same
    // hard error as its author would — deliberately, so the plugin cannot go
    // missing from every session without anyone being told. The remedy is on
    // the consumer's side: pin the catalog ref, fork it, or drop it from
    // air.json until upstream migrates.
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        plugins: ["github://acme/shared/plugins/plugins.json"],
      },
      "skills.json": { lint: exampleSkill("lint") },
    });
    cleanup = c;

    const provider: CatalogProvider = {
      scheme: "github",
      async resolve(): Promise<Record<string, unknown>> {
        return {
          "dev-tools": { description: "Developer tooling", skills: ["lint"] },
        };
      },
    };

    const warnings: string[] = [];
    const err = await resolveArtifacts(join(dir, "air.json"), {
      providers: [provider],
      onWarning: (m) => warnings.push(m),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CatalogConfigError);
    expect((err as Error).message).toMatch(
      /Plugin "dev-tools" \(from github:\/\/acme\/shared\/plugins\/plugins\.json\)/,
    );
    expect(warnings).toEqual([]);
  });

  it("warns and drops a plugin whose path is not a string, without blaming the removed inline form", async () => {
    // A present-but-malformed `path` is one plugin's content problem, so it
    // must not masquerade as "declares its body inline with no path" at an
    // entry that visibly has one.
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
          path: 42,
          skills: ["lint"],
        },
        healthy: { description: "Healthy plugin", path: "./healthy" },
      },
      "healthy/.plugin/plugin.json": { skills: ["lint"] },
    });
    cleanup = c;

    const warnings: string[] = [];
    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts.plugins["@local/dev-tools"]).toBeUndefined();
    expect(artifacts.plugins["@local/healthy"]).toBeDefined();
    const warning = warnings.find((w) => /Plugin "dev-tools"/.test(w));
    expect(warning).toMatch(/"path" must be a string/);
    expect(warning).not.toMatch(/declares its body inline/);
  });

  it("accepts a body-less entry with no path — there is no inline body to reject", async () => {
    // The rule is about body fields without a `path`, not about `path` being
    // mandatory on every entry. A registry entry that declares nothing to
    // bundle still resolves (it simply contributes no artifacts).
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": { name: "test", plugins: ["./plugins.json"] },
      "plugins.json": {
        placeholder: { description: "Bundles nothing yet" },
      },
    });
    cleanup = c;

    const warnings: string[] = [];
    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts.plugins["@local/placeholder"].description).toBe(
      "Bundles nothing yet",
    );
    expect(warnings).toEqual([]);
  });

  it("still resolves a manifest-backed plugin that overrides fields inline", async () => {
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
    const artifacts = await resolveArtifacts(join(dir, "air.json"), {
      onWarning: (m) => warnings.push(m),
    });

    // Inline fields layered on top of a `path` are the sanctioned override
    // path — they survived the removal of the inline-only form.
    const plugin = artifacts.plugins["@local/dev-tools"];
    expect(plugin.version).toBe("9.9.9");
    expect(plugin.skills).toEqual(["@local/lint"]);
    expect(warnings).toEqual([]);
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
          path: "./plugins/base",
        },
        extended: {
          description: "Extended plugin",
          path: "./plugins/extended",
        },
      },
      "plugins/base/.plugin/plugin.json": {
        skills: ["lint"],
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
          path: "./dev-tools",
        },
      },
      "good/dev-tools/.plugin/plugin.json": {
        skills: ["lint"],
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

  it("hard-fails (does not warn-and-skip) when a plugins source's URI scheme has no provider", async () => {
    // A catalog URI whose scheme has no installed provider is an author mistake,
    // not a single source's content problem. Per-source isolation must NOT
    // swallow it into a warning — it re-throws CatalogConfigError so a whole
    // explicitly-listed catalog can never silently vanish. This guards the one
    // deliberate exception the resilience design hinges on.
    const { dir, cleanup: c } = createTempAirDir({
      "air.json": {
        name: "test",
        plugins: ["s3://no-such-bucket/plugins.json"],
      },
    });
    cleanup = c;

    const warnings: string[] = [];
    await expect(
      resolveArtifacts(join(dir, "air.json"), {
        onWarning: (m) => warnings.push(m),
      }),
    ).rejects.toBeInstanceOf(CatalogConfigError);
    // It threw rather than degrading to a "Skipping ..." warning.
    expect(warnings.find((w) => /Skipping plugins index/.test(w))).toBeUndefined();
  });
});
