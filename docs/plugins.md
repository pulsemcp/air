# Plugins

Plugins are named groupings of AIR primitives (skills, MCP servers, hooks) — a compositional unit for bundling and distributing related capabilities. They provide a more tractable layer of abstraction for distribution and sharing; users who want finer-grained control can always "eject" and work directly at the more primitive skills/mcp/hooks layer.

## Why Plugins?

MCP servers provide tools. Skills provide procedures. Hooks provide lifecycle automation. Plugins group them together into cohesive packages that are easy to install, share, and version:

- A **"deployment"** plugin might group a CI/CD MCP server, deployment skills, and pre-deploy hooks
- A **"code quality"** plugin might combine a linting MCP server, formatting skills, and pre-commit hooks
- A **"security"** plugin might bundle vulnerability scanning tools with remediation skills

Plugins don't define new artifacts inline — they reference existing artifacts by ID from the corresponding index files (skills.json, mcp.json, hooks.json). This keeps composition explicit and enables the CLI to reason about overlap.

## Index Format

Plugins are registered in `plugins.json`. Each entry declares which AIR artifacts it bundles:

```json
{
  "code-quality": {
    "id": "code-quality",
    "title": "Code Quality Suite",
    "description": "Linting, formatting, and static analysis tools bundled with coding standards skills",
    "version": "1.2.0",
    "skills": ["lint-fix", "format-check"],
    "mcp_servers": ["eslint-server"],
    "hooks": ["lint-pre-commit"],
    "author": { "name": "Acme Engineering" },
    "license": "MIT",
    "keywords": ["linting", "formatting", "eslint", "prettier"]
  }
}
```

### Artifact References

Plugins declare which AIR artifacts they bundle via the `skills`, `mcp_servers`, and `hooks` arrays. These reference IDs of artifacts defined in the corresponding AIR index files (skills.json, mcp.json, hooks.json).

This declarative mapping enables the CLI to deduplicate at prepare time — if you request `--skills lint-fix --plugins code-quality` and `code-quality` already bundles `lint-fix`, the CLI knows it only needs to activate the plugin. Without these references, the CLI would have to scan plugin directories at runtime to discover overlap.

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier. Must match the key. |
| `title` | No | Human-readable display name. |
| `description` | Yes | What this plugin provides. |
| `version` | No | Semantic version (e.g., `"1.2.0"`). |
| `skills` | No | IDs of skills bundled by this plugin. |
| `mcp_servers` | No | IDs of MCP servers bundled by this plugin. |
| `hooks` | No | IDs of hooks bundled by this plugin. |
| `author` | No | Object with `name`, `email`, `url`. |
| `homepage` | No | URL to the plugin's homepage or docs. |
| `repository` | No | URL or identifier for the source repository. |
| `license` | No | SPDX license identifier (e.g., `"MIT"`). |
| `logo` | No | Path or URL to the plugin's logo image. |
| `keywords` | No | Keywords for discovery and categorization. |

## Translation Layers

AIR plugins are agent-agnostic. At session start, they're translated to agent-specific formats via adapter extensions. The adapter receives the plugin metadata (`id`, `description`, `version`) and the resolved artifact references, then determines how to activate them in the target agent.

### Claude Code

For Claude Code, the adapter translates plugin metadata into Claude's format. The referenced skills, MCP servers, and hooks are activated through their respective AIR mechanisms — the plugin acts as a grouping layer, not a separate activation path.

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
4. **Declare all bundled artifacts** — list every skill, MCP server, and hook so the CLI can deduplicate
5. **Use keywords** — help users discover your plugin through search
