# Understanding air.json

`air.json` is the root configuration file for AIR. It ties together all your artifact indexes — skills, MCP servers, references, plugins, roots, and hooks — into a single, composable configuration.

`air.json` is the **composition point** — it is the one file that decides which artifacts are active in a session. Each artifact field is an array of index paths, so a single `air.json` can assemble any combination you want: purely local directories you maintain, catalogs your team ships, remote org-wide defaults, or a mix of all three. There is no other place to point AIR at artifacts.

## Location

By default, the CLI looks for `air.json` at `~/.air/air.json` — this is where most users keep the `air.json` that governs their sessions. You can override this with:

- The `AIR_CONFIG` environment variable
- The `--config` flag on commands that support it (`prepare`, `install`)

## Structure

Here's a complete `air.json` with all fields:

```json
{
  "$schema": "https://raw.githubusercontent.com/pulsemcp/air/main/schemas/air.schema.json",
  "name": "acme-engineering",
  "description": "Acme Corp engineering team AI agent configuration",
  "extensions": [
    "@pulsemcp/air-adapter-claude",
    "@pulsemcp/air-provider-github",
    "@pulsemcp/air-secrets-env",
    "@pulsemcp/air-secrets-file"
  ],
  "catalogs": [
    "github://acme/air-org",
    "./platform-team-catalog"
  ],
  "skills": ["./skills/skills.json"],
  "references": ["./references/references.json"],
  "mcp": ["./mcp/mcp.json"],
  "plugins": ["./plugins/plugins.json"],
  "roots": ["./roots/roots.json"],
  "hooks": ["./hooks/hooks.json"]
}
```

You don't need both `catalogs` and the per-type arrays. Use `catalogs` when you're layering full catalogs (one entry per catalog), use the per-type arrays when you want fine-grained control, or mix them — catalogs expand first and the per-type arrays layer on top.

## Fields

### Required

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique identifier. Alphanumeric, hyphens, and underscores only. Max 100 characters. |

### Optional

| Field | Type | Description |
|-------|------|-------------|
| `$schema` | string | JSON Schema URI for editor validation and autocomplete. |
| `description` | string | Human-readable description of this configuration scope. Max 500 characters. |
| `extensions` | string[] | Extension packages or local paths to load (adapters, providers, transforms). |
| `catalogs` | string[] | Paths or URIs to artifact catalogs — directories that follow the standard `<type>/<type>.json` layout. Each catalog expands into all six artifact arrays; missing files are silently skipped. |
| `skills` | string[] | Paths to skills index files. |
| `references` | string[] | Paths to references index files. |
| `mcp` | string[] | Paths to MCP server configuration files. |
| `plugins` | string[] | Paths to plugins index files. |
| `roots` | string[] | Paths to roots index files. |
| `hooks` | string[] | Paths to hooks index files. |

Additional properties are allowed — you can add custom fields without causing validation errors, but AIR ignores unrecognized fields.

## Path resolution

All paths in artifact arrays are resolved **relative to the directory containing `air.json`**. For a config at `~/.air/air.json`:

```json
{
  "skills": ["./skills/skills.json"]
}
```

This resolves to `~/.air/skills/skills.json`.

Paths can also be remote URIs when a catalog provider is installed:

```json
{
  "skills": [
    "./skills/local-skills.json",
    "github://acme/shared-air-config/skills/team-skills.json"
  ]
}
```

See [Composition and Overrides](composition-and-overrides.md) for details on remote configs.

## Composition: array ordering matters

Each artifact field is an **ordered array** of index file paths. Files are loaded and merged **in order** — later entries override earlier ones **by ID**, using **full replacement** (no deep merge).

```json
{
  "mcp": [
    "./mcp/org-defaults.json",
    "./mcp/team-overrides.json",
    "./mcp/local.json"
  ]
}
```

If `org-defaults.json` defines a server with ID `"github"` and `team-overrides.json` also defines `"github"`, the team version completely replaces the org version. The org definition is discarded entirely — fields are not merged between the two.

This makes override behavior predictable: you always know which definition wins by looking at array order.

## Whole-catalog composition

For the common case of layering two or more full catalogs, the `catalogs` field lets you reference a catalog root once instead of listing every artifact type separately:

```json
{
  "catalogs": [
    "github://acme/air-org",
    "./platform-team-catalog"
  ]
}
```

Each entry is a directory that follows the standard AIR layout — `<type>/<type>.json` for each of the six artifact types. AIR expands every catalog into all six artifact arrays at resolution time. Files that aren't present in a catalog are silently skipped, so a catalog can ship only the artifact types it needs.

`catalogs` and the per-type arrays compose: catalogs expand first, then the per-type arrays layer on top. See [Composition and Overrides](composition-and-overrides.md) for details.

### Example

**org-defaults.json:**
```json
{
  "github": {
    "title": "GitHub",
    "description": "GitHub access for all teams",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
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

Result: the team override wins entirely. The `title` and `description` from the org default are **not preserved** — the team definition is a complete replacement. If you want to keep them, include them in the override.

## Extensions

The `extensions` array lists packages that extend AIR's functionality:

```json
{
  "extensions": [
    "@pulsemcp/air-adapter-claude",
    "@pulsemcp/air-provider-github",
    "@pulsemcp/air-secrets-env",
    "@pulsemcp/air-secrets-file"
  ]
}
```

Extensions can be:
- **npm packages** — installed via `air install` or `npm install`
- **Local paths** — relative to `air.json` (e.g., `"./my-extension"`)

Extensions provide three types of functionality:
- **Adapters** — translate AIR config to agent-specific formats (e.g., Claude Code)
- **Providers** — resolve remote URIs like `github://` in artifact paths
- **Transforms** — modify artifact configs (`.mcp.json`, `HOOK.json`) after session preparation (e.g., secrets injection)

Order matters for transforms — they run in declaration order. See [Extensions System](extensions.md) for details.

## Minimal configuration

The only required field is `name`. A minimal valid `air.json`:

```json
{
  "name": "my-config"
}
```

This is valid but won't do anything useful. Add artifact arrays as you need them.

## Common mistakes

### Using deep merge expectations

AIR uses **full replacement** by ID, never deep merge. If you override an MCP server, you must include all fields you want — not just the ones that changed.

### Forgetting that paths are relative to air.json

A common error is writing paths relative to your current working directory. Paths in `air.json` are always resolved relative to the directory containing `air.json` itself.

### Mismatched IDs

Each artifact's key in its index file should match the `id` (or `name` for roots) field inside the object:

```json
{
  "my-skill": {
    "id": "my-skill",
    "description": "...",
    "path": "skills/my-skill"
  }
}
```

If the key is `"my-skill"` but `id` is `"other-skill"`, this mismatch is not caught by `air validate` (JSON Schema cannot enforce key-value correspondence), but it can cause unexpected override behavior at runtime. Always keep keys and IDs in sync.

### Adding unknown fields

`air.json` allows additional properties, so custom fields won't cause validation errors. However, AIR ignores unrecognized fields — they're passed through but have no effect.

### Leaving unresolved variables

MCP server configs and hook `env` fields support `${ENV_VAR}` and `${ENV_VAR:-default}` interpolation. AIR validates that all variables are resolved after transforms run — in both `.mcp.json` and `HOOK.json` files. Variables with `:-default` syntax always resolve (using the fallback when the variable is unset). If you see errors about unresolved variables, either set the environment variable, use `${VAR:-fallback}` for optional values, or use a transform extension to resolve them. You can bypass this check with `--skip-validation` on the `prepare` command.

## Validating your config

Always validate after making changes:

```bash
air validate ~/.air/air.json
```

This checks the file against the AIR JSON Schema. See [Validating Configuration](validating-configuration.md) for more.

## Next steps

- **[Quickstart](quickstart.md)** — Full walkthrough of setting up AIR from scratch.
- **[Composition and Overrides](composition-and-overrides.md)** — Advanced layering and remote config patterns.
- **[Extensions System](extensions.md)** — How to install and configure extensions.
