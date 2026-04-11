# Composition and Overrides

AIR's composition model lets you layer configuration across organizational levels — org-wide defaults, team overrides, and project-local customizations. This guide covers the mechanics and advanced patterns.

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

## Layering patterns

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

## Next steps

- **[Understanding air.json](understanding-air-json.md)** — Root config file structure.
- **[Extensions System](extensions.md)** — Providers that enable remote configuration.
- **[Roots and Multi-Root Setups](roots.md)** — Subagent composition.
