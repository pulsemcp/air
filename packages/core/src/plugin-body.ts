/**
 * A plugin's body — the fields that live in the `.plugin/plugin.json` manifest
 * its `plugins.json` entry points at with `path` — and the one diagnostic both
 * layers that reject an inline body share.
 *
 * Declaring the body inline on the index entry with no `path` was deprecated in
 * v0.13.0 and removed in https://github.com/pulsemcp/air/issues/157. Two layers
 * reject it: `plugins.schema.json` (a `dependencies` map requiring a sibling
 * `path` for every field below) and `resolveArtifacts`. They keep the same
 * wording by sharing {@link inlineBodyRemovedMessage}.
 */

/**
 * Plugin manifest fields the externalized body may supply. The owning
 * plugins.json entry is the authoritative registry layer; any of these fields
 * declared inline on the entry take precedence over the manifest — but only
 * alongside a `path`. `description`, `path`, and `default_in_roots` are
 * deliberately absent: they belong to the index entry, not the externalized
 * body.
 *
 * This list is mirrored by the `dependencies` map in
 * `schemas/plugins.schema.json`; `tests/plugin-body.test.ts` pins the two
 * together so the resolver and the schema can never reject different shapes.
 */
export const PLUGIN_MANIFEST_FIELDS = [
  "title",
  "version",
  "skills",
  "mcp_servers",
  "hooks",
  "plugins",
  "author",
  "homepage",
  "repository",
  "license",
  "logo",
  "keywords",
] as const;

/** Plugin manifest fields that must be arrays of strings when present. */
export const PLUGIN_MANIFEST_REF_FIELDS = [
  "skills",
  "mcp_servers",
  "hooks",
  "plugins",
] as const;

/** The body fields an index entry declares inline, in canonical field order. */
export function inlineBodyFields(entry: Record<string, unknown>): string[] {
  return PLUGIN_MANIFEST_FIELDS.filter((field) => field in entry);
}

/**
 * The diagnostic for a plugin entry that declares body fields with no `path`.
 * It names the plugin, every offending field, where those fields go, what stays
 * behind, and that the override form is unaffected — the whole migration, in
 * the one message a user sees from either `air validate` or `air prepare`.
 *
 * @param source Index file the entry came from, when the caller knows it.
 */
export function inlineBodyRemovedMessage(
  key: string,
  fields: string[],
  source?: string
): string {
  const from = source ? ` (from ${source})` : "";
  const list = fields.join(", ");
  return (
    `Plugin "${key}"${from} declares its body inline (${list}) with no ` +
    `"path". Inline plugin bodies were deprecated in v0.13.0 and have been ` +
    `removed (https://github.com/pulsemcp/air/issues/157). Move ${list} into ` +
    `"<plugin-dir>/.plugin/plugin.json" and set "path" to the plugin ` +
    `directory; keep description, path, and default_in_roots on the index ` +
    `entry. Inline fields alongside a "path" are still supported — they ` +
    `override the manifest field by field.`
  );
}
