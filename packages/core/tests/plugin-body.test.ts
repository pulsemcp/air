import { describe, it, expect } from "vitest";
import { loadSchema } from "../src/schemas.js";
import {
  PLUGIN_MANIFEST_FIELDS,
  PLUGIN_MANIFEST_REF_FIELDS,
  inlineBodyFields,
  inlineBodyRemovedMessage,
} from "../src/plugin-body.js";

// Inline plugin bodies (body fields with no sibling `path`) were removed in
// https://github.com/pulsemcp/air/issues/157. Two independent layers reject
// them — plugins.schema.json at validation time and resolveArtifacts at
// resolution time — so the two must agree on which fields count as a body.

describe("plugin body fields", () => {
  it("matches the plugins schema's `dependencies` map field for field", () => {
    const schema = loadSchema("plugins") as {
      $defs: { Plugin: { dependencies: Record<string, string[]> } };
    };
    const dependencies = schema.$defs.Plugin.dependencies;

    expect(Object.keys(dependencies).sort()).toEqual(
      [...PLUGIN_MANIFEST_FIELDS].sort()
    );
    // Every one of them requires the same thing: a sibling `path`.
    for (const required of Object.values(dependencies)) {
      expect(required).toEqual(["path"]);
    }
  });

  it("never treats an index-layer field as part of the body", () => {
    // These three stay on the plugins.json entry and must never require a
    // `path` — `description` is what the registry lists, and `default_in_roots`
    // is a catalog-layer decision rather than a property of the plugin.
    for (const field of ["description", "path", "default_in_roots"]) {
      expect(PLUGIN_MANIFEST_FIELDS).not.toContain(field);
    }
  });

  it("keeps the reference fields a subset of the body fields", () => {
    for (const field of PLUGIN_MANIFEST_REF_FIELDS) {
      expect(PLUGIN_MANIFEST_FIELDS).toContain(field);
    }
  });

  it("reports inline body fields in canonical order, ignoring index-layer fields", () => {
    expect(
      inlineBodyFields({
        skills: ["lint"],
        description: "d",
        version: "1.0.0",
        default_in_roots: ["web"],
      })
    ).toEqual(["version", "skills"]);
    expect(inlineBodyFields({ description: "d", path: "./p" })).toEqual([]);
  });

  it("names the source in the message only when the caller knows it", () => {
    expect(inlineBodyRemovedMessage("dev-tools", ["skills"])).toContain(
      'Plugin "dev-tools" declares its body inline (skills)'
    );
    expect(
      inlineBodyRemovedMessage("dev-tools", ["skills"], "./plugins.json")
    ).toContain('Plugin "dev-tools" (from ./plugins.json) declares');
  });
});
