# Plugins

Plugins are packaging and distribution units — a directory that bundles skills, hooks, MCP servers, and other components into a single installable unit. They provide a more tractable layer of abstraction for distribution and sharing; users who want finer-grained control can always "eject" and work directly at the more primitive skills/mcp/hooks layer.

## Why Plugins?

MCP servers provide tools. Skills provide procedures. Hooks provide lifecycle automation. Plugins bundle them together into cohesive packages that are easy to install, share, and version:

- A **"deployment"** plugin might group a CI/CD MCP server, deployment skills, and pre-deploy hooks
- A **"code quality"** plugin might combine a linting MCP server, formatting skills, and pre-commit hooks
- A **"security"** plugin might bundle vulnerability scanning tools with remediation skills

Plugins are modeled after the [Open Plugins spec](https://open-plugins.com/plugin-builders/specification) and Claude Code Plugins. A plugin directory can contain:

- `skills/` — Skill definitions (SKILL.md files)
- `hooks/hooks.json` — Lifecycle hooks
- `.mcp.json` — MCP server configurations
- `commands/` — Custom commands
- `agents/` — Agent configurations
- `bin/` — Executable scripts
- `rules/` — Rule files (.mdc)
- `settings.json` — Plugin-specific settings

Components within a plugin are namespaced: `plugin-name:component-name`.

## Index Format

Plugins are registered in `plugins.json`. Each entry points to a plugin directory and carries its metadata:

```json
{
  "code-quality": {
    "id": "code-quality",
    "title": "Code Quality Suite",
    "description": "Linting, formatting, and static analysis tools bundled with coding standards skills",
    "version": "1.2.0",
    "path": "plugins/code-quality",
    "author": { "name": "Acme Engineering" },
    "license": "MIT",
    "keywords": ["linting", "formatting", "eslint", "prettier"]
  }
}
```

The actual discovery of skills, hooks, and MCP configs within the plugin directory is a runtime concern handled by the agent adapter — the index just needs to point to the plugin and carry its metadata.

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier. Must match the key. |
| `title` | No | Human-readable display name. |
| `description` | Yes | What this plugin provides. |
| `version` | No | Semantic version (e.g., `"1.2.0"`). |
| `path` | Yes | Path to the plugin directory, relative to the AIR config. |
| `author` | No | Object with `name`, `email`, `url`. |
| `homepage` | No | URL to the plugin's homepage or docs. |
| `repository` | No | URL or identifier for the source repository. |
| `license` | No | SPDX license identifier (e.g., `"MIT"`). |
| `logo` | No | Path or URL to the plugin's logo image. |
| `keywords` | No | Keywords for discovery and categorization. |

## Translation Layers

AIR plugins are agent-agnostic. At session start, they're translated to agent-specific formats via adapter extensions.

### Claude Code

For Claude Code, the adapter resolves plugin paths and translates them into the format Claude Code expects. The plugin directory structure is read at session start, and its components (skills, hooks, MCP configs) are merged into the session configuration.

### Other Agents

Plugin translation for other agents is handled by their respective adapter extensions (e.g., `@pulsemcp/air-adapter-opencode`). Each adapter implements its own translation from the AIR plugin format to the agent's native format.

## Plugins vs. Primitive Artifacts

Plugins and primitive artifacts (skills, hooks, MCP servers) are two ways to achieve the same thing:

- **Plugins** are great for distribution — install one package, get a complete capability
- **Primitive artifacts** are great for customization — fine-grained control over individual components

You can mix both in the same `air.json`. A common pattern is to start with plugins and "eject" individual components when you need to customize them:

1. Start with `"default_plugins": ["code-quality"]`
2. Need to customize the linting rules? Copy the skill out, modify it, add it to your skills index
3. The local skill overrides the one bundled in the plugin

## Best Practices

1. **Version your plugins** — use semver to communicate breaking vs. non-breaking changes
2. **Write clear descriptions** — the description should tell users what capabilities they get
3. **Keep plugins focused** — one domain, one plugin. Don't bundle unrelated capabilities
4. **Include a README** — add documentation in the plugin directory explaining setup and usage
5. **Use keywords** — help users discover your plugin through search
