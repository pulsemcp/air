# Migrating to `default_in_roots` (AIR 0.12.0)

AIR 0.12.0 **inverts** how artifacts are associated with roots. This is a breaking
change for catalog authors who wrote root membership in `roots.json`. This guide
shows exactly what to change.

> **TL;DR** — Membership moves from the **root** to the **artifact**. Delete the
> `default_*` arrays from each root entry and, on every artifact, add
> `default_in_roots: ["<root-name>", ...]` naming the roots it belongs to.
> Use `["*"]` for "all roots". The resolved output is unchanged, so no downstream
> code needs to change.

## What changed

**Before (0.11.0 and earlier):** each root entry in `roots.json` enumerated its
members.

```jsonc
// roots.json — OLD
{
  "web-app": {
    "display_name": "Web App",
    "default_mcp_servers": ["github", "postgres"],
    "default_skills": ["deploy", "lint-fix"],
    "default_hooks": ["lint-check"],
    "default_plugins": ["quality-suite"],
    "default_subagent_roots": ["data-pipeline"]
  },
  "data-pipeline": {
    "display_name": "Data Pipeline",
    "default_skills": ["query-builder"]
  }
}
```

**After (0.12.0):** each artifact declares which roots it belongs to. Root entries
no longer carry any `default_*` membership arrays.

```jsonc
// roots.json — NEW (no membership arrays)
{
  "web-app": { "display_name": "Web App" },
  "data-pipeline": {
    "display_name": "Data Pipeline",
    "default_in_roots": ["web-app"]   // makes data-pipeline a subagent of web-app
  }
}
```

```jsonc
// mcp.json — NEW
{
  "github":   { /* ... */ "default_in_roots": ["web-app"] },
  "postgres": { /* ... */ "default_in_roots": ["web-app"] }
}
```

```jsonc
// skills.json — NEW
{
  "deploy":        { /* ... */ "default_in_roots": ["web-app"] },
  "lint-fix":      { /* ... */ "default_in_roots": ["web-app"] },
  "query-builder": { /* ... */ "default_in_roots": ["data-pipeline"] }
}
```

```jsonc
// hooks.json — NEW
{ "lint-check": { /* ... */ "default_in_roots": ["web-app"] } }
```

```jsonc
// plugins.json — NEW
{ "quality-suite": { /* ... */ "default_in_roots": ["web-app"] } }
```

## Field-by-field mapping

For each root, take every entry in its old `default_*` arrays and move it to the
named artifact's `default_in_roots`:

| Old field on the **root** | New field on the **artifact** it referenced |
| --- | --- |
| `default_mcp_servers: ["github"]`        | on `github` in `mcp.json`: `default_in_roots: ["<root>"]` |
| `default_skills: ["deploy"]`             | on `deploy` in `skills.json`: `default_in_roots: ["<root>"]` |
| `default_hooks: ["lint-check"]`          | on `lint-check` in `hooks.json`: `default_in_roots: ["<root>"]` |
| `default_plugins: ["quality-suite"]`     | on `quality-suite` in `plugins.json`: `default_in_roots: ["<root>"]` |
| `default_subagent_roots: ["data-pipeline"]` | on `data-pipeline` in `roots.json`: `default_in_roots: ["<root>"]` |

(Roots never had a `default_references` array, so there is nothing to migrate for
references. As a **new** capability in 0.12.0, a reference can now join a root
directly by setting `default_in_roots` on its entry in `references.json` — AIR
computes a per-root `default_references` array from it. References attached
transitively through a skill's `references` field keep working unchanged.)

If an artifact belonged to several roots, list them all:
`default_in_roots: ["web-app", "data-pipeline"]`. If it belonged to every root,
use the wildcard `default_in_roots: ["*"]` instead of listing each one.

## Step-by-step

1. **For each root**, note its `default_mcp_servers`, `default_skills`,
   `default_hooks`, `default_plugins`, and `default_subagent_roots`.
2. **For each artifact named** in those arrays, add the root's name to that
   artifact's `default_in_roots` (creating the field if absent). For
   `default_subagent_roots`, the "artifact" is the subagent root entry in
   `roots.json`.
3. **Delete all `default_*` membership arrays from every root entry.** Roots keep
   their other fields (`display_name`, `description`, `url`, `default_branch`,
   `user_invocable`, `default_runtime`, and the new `default_in_roots` for
   subagent membership).
4. **Collapse "applies to every root"** to `default_in_roots: ["*"]`.
5. Run `air validate` and then `air resolve` to confirm each root's computed
   membership matches what you had before.

## How to tell if you still have legacy files

A root that still carries any `default_*` membership array resolves with a **loud
deprecation warning**, and that array is **ignored** (not honored):

```
Root "web-app" declares legacy membership field(s) default_skills,
default_mcp_servers. These are ignored — declare membership on each artifact via
"default_in_roots" (use "*" for all roots) instead. See docs/guides/roots.md.
```

(Only these five fields are recognized as legacy membership arrays:
`default_skills`, `default_mcp_servers`, `default_plugins`, `default_hooks`,
`default_subagent_roots` — listed in that order in the warning.)

Legacy files still pass schema validation (the schemas keep
`additionalProperties: true`), so `air validate` will **not** flag them — only
resolution warns. Run `air resolve` (or start a session) and watch for the warning
above to find roots that still need migrating.

## Verifying the migration

The **resolved output is identical** before and after — AIR inverts every
artifact's `default_in_roots` back into the same per-root `default_mcp_servers` /
`default_skills` / `default_hooks` / `default_plugins` / `default_references` /
`default_subagent_roots` arrays that adapters, the SDK, the CLI, and downstream
consumers already read. To confirm a clean migration:

```bash
air resolve    # prints the full merged tree as JSON, including each root's
               # computed default_* arrays under "roots"
```

Each root's computed `default_*` arrays in the output should match what you
previously authored by hand. (To see the configuration a specific root resolves to
when launching, use `air prepare --root <name>` or `air start --root <name>`.) No
adapter, SDK, or consumer code needs to change.

## See also

- **[Roots and Multi-Root Setups](roots.md)** — the full roots model, including
  subagent roots and the `"*"` wildcard.
- **[Composition and Overrides](composition-and-overrides.md)** — how
  `default_in_roots` references canonicalize and how `exclude` interacts with
  membership.
