# Composition and Overrides

AIR's composition model lets you layer configuration from whatever sources make sense for you — purely local directories, catalogs your team ships, remote org-wide defaults, or any mix. This guide covers the mechanics and advanced patterns.

`~/.air/air.json` is the single composition surface: every active artifact in a session comes from the arrays you list there. Nothing else contributes to a session's config, and you are not required to use remote catalogs — a fully local setup is a supported first-class shape.

## The override model

Every artifact field in `air.json` is an **ordered array** of index file paths:

```json
{
  "mcp": [
    "./mcp/org-defaults.json",
    "./mcp/team-overrides.json",
    "./mcp/local.json"
  ]
}
```

Files are loaded left to right. When two files define an entry with the same ID, the **later entry wins** via **full replacement** — no fields are merged between them.

### Full replacement, not deep merge

This is the most important rule in AIR composition. Given:

**org-defaults.json:**
```json
{
  "github": {
    "title": "GitHub (Org)",
    "description": "Organization-wide GitHub access",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "${ORG_GITHUB_TOKEN}"
    }
  }
}
```

**team-overrides.json:**
```json
{
  "github": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.7.0"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "${TEAM_GITHUB_TOKEN}"
    }
  }
}
```

The result is the team version **only**. The org's `title` and `description` are gone — they were part of the replaced entry. If you want to keep them, include them in the override.

### Why full replacement?

Full replacement is predictable. You never have to wonder which fields came from which layer. The winning entry is exactly what you see in its file. Deep merge creates ambiguity: if a field is present in the result, did it come from the org layer or the team layer? With full replacement, the answer is always "whichever file defined this ID last."

## Whole-catalog composition

When you want to layer two or more full catalogs — say, a shared team catalog and your own local catalog — you don't need to list every artifact type separately. The `catalogs` field in `air.json` accepts an ordered array of catalog roots, and AIR expands each one into all six artifact arrays automatically.

A **catalog** is a directory (local or remote) containing AIR artifact index files. AIR walks the catalog root up to 3 directory levels deep and discovers any file that looks like an AIR artifact index — either by filename (`skills.json`, `roots.json`, `mcp.json`, `references.json`, `plugins.json`, `hooks.json`, or any filename with those keywords as delimited tokens) or by `$schema`. Your folder layout is up to you:

```
<catalog>/
├── skills/skills.json                 # conventional layout
├── mcp/mcp.json
├── agents/agent-roots/roots.json      # custom subdirectories work too
├── config/mcp-servers/mcp.json
└── hooks.json                         # files at the root work as well
```

This is the same layout `air init` creates by default, and it's what each official example in this repo uses — but any layout up to 3 levels deep is accepted. You don't need all six artifact types — a catalog that only ships skills and MCP servers works fine.

**Traversal rules:**

- **Depth cap**: 3 levels below the catalog root. Indexes deeper than that must be referenced via the explicit per-type arrays.
- **Skipped directories**: `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `target`, `vendor`, and any directory starting with `.`.
- **`.gitignore`** at the catalog root is honored — ignored paths are not descended into.
- **`$schema` check**: a JSON file whose `$schema` points to a non-AIR schema is skipped even if its filename matches. Files without `$schema` are identified by filename alone.

Within a single catalog, if two indexes of the same type are discovered, they merge in sorted relative-path order with later-wins by ID. Across multiple catalogs, earlier entries are merged first; later catalogs override.

### Two-catalog composition (the common case)

```json
{
  "name": "platform-team",
  "extensions": ["@pulsemcp/air-provider-github"],
  "catalogs": [
    "github://acme/air-org",
    "./platform-team-catalog"
  ]
}
```

That's it. Both catalogs contribute skills, MCP servers, plugins, roots, hooks, and references. The later catalog (local) overrides the earlier one (org) by ID, following the same full-replacement rule as the per-type arrays.

### Mixing catalogs and explicit arrays

You can use `catalogs` and the per-type arrays together. Catalogs expand first; the per-type arrays layer on top of them and can override anything a catalog contributed:

```json
{
  "catalogs": [
    "github://acme/air-org",
    "./team-catalog"
  ],
  "mcp": [
    "./local-mcp-overrides.json"
  ]
}
```

Effective load order for MCP servers: `github://acme/air-org/mcp/mcp.json` → `./team-catalog/mcp/mcp.json` → `./local-mcp-overrides.json`. Later wins by ID.

### When to prefer `catalogs` over per-type arrays

- You're layering full catalogs (org + team + local). `catalogs: [A, B, C]` beats writing each of the six artifact arrays for every catalog.
- The catalog's index files live within 3 directory levels of the catalog root.

Use the per-type arrays when you want to pull just one artifact type from a source, or when an index file lives deeper than the discovery depth cap.

## Layering patterns

### Local-only

You don't need a remote source to use layering. A team that maintains its skills in a private directory can point `air.json` straight at local index files:

```json
{
  "name": "my-team",
  "skills": ["./skills/skills.json"],
  "mcp": ["./mcp/mcp.json"]
}
```

This is the simplest setup and a fully supported shape — no providers required, no network calls at resolution time.

### Local team catalog + shared remote catalog

A common team shape is a private catalog kept as a sibling directory under `~/.air/` (often a git submodule or a checked-out team repo), composed alongside a shared org-wide catalog. Using the `catalogs` field keeps this compact — one entry per catalog rather than six paths per catalog:

```json
{
  "name": "platform-team",
  "extensions": ["@pulsemcp/air-provider-github"],
  "catalogs": [
    "github://acme/air-org",
    "./platform-team-catalog"
  ]
}
```

The org catalog provides the baseline and the team's local catalog adds team-specific artifacts (and overrides any org defaults it wants to replace).

If you only need some artifact types from a source, or the indexes live deeper than the 3-level discovery cap, use the per-type arrays instead:

```json
{
  "name": "platform-team",
  "extensions": ["@pulsemcp/air-provider-github"],
  "skills": [
    "github://acme/air-org/skills/skills.json",
    "./platform-team-catalog/skills/skills.json"
  ],
  "mcp": [
    "github://acme/air-org/mcp/mcp.json",
    "./platform-team-catalog/mcp/mcp.json"
  ]
}
```

Local paths are resolved relative to the directory containing `air.json` (so `./platform-team-catalog/...` above points at `~/.air/platform-team-catalog/...`). If your catalog lives elsewhere on disk, use an absolute path like `/opt/team-catalog/skills/skills.json`. **Tildes (`~/`) are not expanded** — either use a relative path or spell out the absolute path.

### Org → Team → Project

A common pattern is three layers:

```json
{
  "skills": [
    "github://acme/air-config/skills/org-skills.json",
    "github://acme/air-config/skills/platform-team-skills.json",
    "./skills/project-skills.json"
  ],
  "mcp": [
    "github://acme/air-config/mcp/org-mcp.json",
    "./mcp/local-mcp.json"
  ]
}
```

This gives the org baseline defaults, the team adds or overrides specifics, and the local project can further customize.

### Additive layering

When layers define **different IDs**, they simply accumulate:

**org-skills.json:** defines `code-review`, `security-scan`
**team-skills.json:** defines `deploy-staging`, `run-migrations`
**Result:** all four skills available

### Override layering

When layers define the **same ID**, the later one wins:

**org-mcp.json:** defines `github` with version 0.6.2
**local-mcp.json:** defines `github` with version 0.7.0
**Result:** `github` at version 0.7.0

## Remote configuration with providers

Providers resolve remote URIs in artifact paths, enabling shared configuration hosted in git repositories.

### GitHub provider

With `@pulsemcp/air-provider-github` installed, use `github://` URIs:

```json
{
  "extensions": ["@pulsemcp/air-provider-github"],
  "skills": [
    "github://acme/shared-air-config/skills/skills.json",
    "./skills/local-skills.json"
  ]
}
```

URI format:

```
github://owner/repo/path/to/file.json
github://owner/repo@ref/path/to/file.json
```

The `@ref` is appended to the repo name (preferred) to specify a branch, tag, or commit SHA. Without `@ref`, the default branch is used. The legacy syntax `github://owner/repo/path/to/file.json@ref` is also supported.

### Authentication for private repos

Set `AIR_GITHUB_TOKEN`:

```bash
export AIR_GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

### Caching

GitHub provider caches repository clones at `~/.air/cache/github/`. To force a refresh:

```bash
rm -rf ~/.air/cache/github/acme/shared-air-config
```

## Plugin composition

Plugins can compose other plugins, creating hierarchical capability bundles:

```json
{
  "full-stack-dev": {
    "id": "full-stack-dev",
    "description": "Full-stack developer toolkit",
    "plugins": ["code-quality", "deploy-toolkit"],
    "skills": ["monitor-logs"]
  }
}
```

When `full-stack-dev` is activated, its referenced plugins' skills, MCP servers, and hooks are recursively expanded and merged. The parent plugin's direct declarations override child plugin declarations with the same ID.

Circular plugin references are detected and rejected at resolution time.

## Subagent root composition

Roots can declare dependencies on other roots via `default_subagent_roots`:

```json
{
  "orchestrator": {
    "name": "orchestrator",
    "description": "Main orchestrator agent",
    "default_subagent_roots": ["web-app", "api-service"],
    "default_skills": ["orchestrate"]
  }
}
```

By default, both `air start` and `air prepare` merge the subagent roots' skills and MCP servers into the parent session. The parent's declarations take priority over subagent declarations. Opt out with `--no-subagent-merge`.

## Advanced patterns

### Environment-specific overrides

Use separate index files for different environments:

```json
{
  "mcp": [
    "./mcp/base.json",
    "./mcp/production.json"
  ]
}
```

Switch environments by changing which files are listed.

### Selective remote overrides

Pull only specific artifact types from a remote config:

```json
{
  "skills": ["github://acme/air-config/skills/skills.json"],
  "mcp": ["./mcp/local-only.json"]
}
```

This uses shared skills but keeps MCP servers local-only.

### Overriding to remove

To effectively "remove" an artifact from an earlier layer, you'd need to override it with a valid but inactive entry. Since there's no "disabled" field, the practical approach is to not reference the layer that defines it, or override with a minimal valid entry that replaces the unwanted one.

## Merging behavior reference

| Scenario | Behavior |
|----------|----------|
| Same ID in two files | Later file wins, full replacement |
| Different IDs across files | Both included (additive) |
| Plugin references other plugin | Recursive expansion, parent overrides child |
| Subagent root artifacts | Merged into parent session, parent takes priority |
| Remote + local files | Both loaded, same override rules apply |
| `catalogs` + per-type arrays | Catalogs expand first, per-type arrays layer on top |
| Catalog missing an artifact file | Silently skipped — the catalog contributes nothing for that type |
| Two indexes of the same type in one catalog | Merged in sorted relative-path order, later-wins by ID |
| Index deeper than 3 levels in a catalog | Not discovered — reference it via the explicit per-type array instead |

## Next steps

- **[Understanding air.json](understanding-air-json.md)** — Root config file structure.
- **[Extensions System](extensions.md)** — Providers that enable remote configuration.
- **[Roots and Multi-Root Setups](roots.md)** — Subagent composition.
