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

This declarative mapping is designed to enable CLI deduplication — if you request `--skills lint-fix --plugins code-quality` and `code-quality` already bundles `lint-fix`, the CLI can determine that only the plugin needs to be activated.

### Plugin Composition

Plugins can compose other plugins using the `plugins` array. This allows building higher-level plugins from smaller, focused ones without manually flattening all primitive IDs:

```json
{
  "code-quality": {
    "description": "Linting and formatting tools",
    "skills": ["lint-fix", "format-check"],
    "mcp_servers": ["eslint-server"],
    "hooks": ["lint-pre-commit"]
  },
  "database-tools": {
    "description": "Database management tools",
    "skills": ["db-migrate", "db-seed"],
    "mcp_servers": ["postgres-server"]
  },
  "full-stack-dev": {
    "description": "Everything for full-stack development",
    "plugins": ["code-quality", "database-tools"],
    "skills": ["deploy"],
    "mcp_servers": ["deploy-server"]
  }
}
```

After resolution, `full-stack-dev` expands to:
- **skills**: `["lint-fix", "format-check", "db-migrate", "db-seed", "deploy"]`
- **mcp_servers**: `["eslint-server", "postgres-server", "deploy-server"]`
- **hooks**: `["lint-pre-commit"]`

**Composition rules:**

- **Recursive expansion**: Child plugins are expanded depth-first. If plugin A includes B, and B includes C, then A gets all primitives from C and B plus its own.
- **Parent overrides children**: When the same primitive ID appears in both a child plugin and the parent's direct declarations, the parent wins. Direct declarations always take precedence over inherited ones.
- **Deduplication**: If the same primitive ID is referenced via multiple paths (e.g., two child plugins both include the same skill), it appears only once in the expanded result.
- **Cycle detection**: Circular references (A includes B, B includes A) are rejected at resolution time with a clear error message.
- **Flat result**: The end result is always a flat set of primitive IDs. Nesting is author convenience, not a runtime concept.

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `title` | No | Human-readable display name. |
| `description` | Yes | What this plugin provides. |
| `version` | No | Semantic version (e.g., `"1.2.0"`). |
| `skills` | No | IDs of skills bundled by this plugin. |
| `mcp_servers` | No | IDs of MCP servers bundled by this plugin. |
| `hooks` | No | IDs of hooks bundled by this plugin. |
| `plugins` | No | IDs of other plugins to compose into this one. |
| `author` | No | Object with `name`, `email`, `url`. |
| `homepage` | No | URL to the plugin's homepage or docs. |
| `repository` | No | URL or identifier for the source repository. |
| `license` | No | SPDX license identifier (e.g., `"MIT"`). |
| `logo` | No | Path or URL to the plugin's logo image. |
| `keywords` | No | Keywords for discovery and categorization. |

## Translation Layers

AIR plugins are agent-agnostic. At session start, they're translated to agent-specific formats via adapter extensions. The adapter receives the plugin metadata (`description`, `version`) and the resolved artifact references, then determines how to activate them in the target agent.

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
4. **Declare all bundled artifacts** — list every skill, MCP server, and hook so the CLI can resolve overlaps
5. **Use keywords** — help users discover your plugin through search

## Deviations from Standards

AIR's plugin model diverges from the emerging plugin standards in deliberate ways. This section tracks those deviations to inform potential alignment with or contributions back to those standards.

**Areas of alignment**: AIR shares the same core metadata model as both standards — `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords` are nearly identical across all three. (AIR uses the JSON object key as the identifier rather than an explicit `id` field.) Skills (SKILL.md), hooks, and MCP server configs are conceptually equivalent. This shared foundation suggests convergence is feasible.

### Open Plugins

The [Open Plugin Specification](https://open-plugins.com/plugin-builders/specification) defines a directory-based packaging format for AI coding agent extensions, targeting multi-agent compatibility (Claude Code, Cursor, Codex, GitHub Copilot).

| Area | Open Plugins | AIR | Rationale |
|------|-------------|-----|-----------|
| **Format** | Directory with `.plugin/plugin.json` manifest | JSON index records in `plugins.json` | AIR treats plugins as metadata entries that reference separately-defined artifacts. This enables multi-layer composition (org > team > project) without copying directories. |
| **Artifact references** | Components live inline within the plugin directory (skills, hooks, MCP configs are files under the plugin root) | Artifacts are referenced by ID from external index files (skills.json, mcp.json, hooks.json) | Referencing by ID keeps artifacts DRY — the same MCP server or skill can be shared across multiple plugins without duplication. It also enables the CLI to reason about overlap and deduplication. |
| **Plugin composition** | Not yet specified — plugins are self-contained directories | Supported — plugins can compose other plugins via a `plugins` array, with recursive expansion and cycle detection (see [Plugin Composition](#plugin-composition) above) | Composition lets authors build higher-level bundles (e.g., "full-stack-dev" = "code-quality" + "database-tools" + extras) without manually flattening primitive IDs. |
| **Path resolution** | `${PLUGIN_ROOT}` expansion; path traversal outside plugin root is rejected | Paths resolved to absolute at load time relative to the index file's directory | AIR's model supports remote sources (github://, etc.) where a single directory root doesn't apply. |
| **Discovery** | Directory-scanning with default paths; custom paths supplement defaults | All artifacts are explicit index entries, no directory conventions | AIR doesn't use directory-scanning discovery; everything is declared in index files. |
| **Component types** | Skills, Agents, Rules (.mdc), Hooks, MCP Servers, LSP Servers, Commands, Output Styles | Skills, MCP Servers, Hooks (bundleable by plugins); plus References, Roots as separate artifact types | AIR does not yet have equivalents for Agents, Rules, Commands, LSP Servers, or Output Styles. It adds References (shared docs) and Roots (workspace definitions) as first-class artifacts outside the plugin model. |

### Claude Plugins

[Claude Code plugins](https://code.claude.com/docs/en/plugins) follow the Open Plugin Specification with Claude-specific extensions (`userConfig`, `channels`, persistent storage, scoping).

| Area | Claude Plugins | AIR | Rationale |
|------|---------------|-----|-----------|
| **Format** | Directory with `.claude-plugin/plugin.json` manifest | JSON index records in `plugins.json` | Same reasoning as Open Plugins — AIR favors index-based composition over directory-based packaging. |
| **Artifact references** | Components live inline within the plugin directory | Artifacts referenced by ID from external index files | Same DRY rationale — avoids duplicating MCP configs, skills, and hooks across plugins that share them. |
| **Plugin composition** | Not yet specified — plugins are self-contained directories | Supported with recursive expansion, deduplication, and cycle detection (see [Plugin Composition](#plugin-composition) above) | Same rationale as Open Plugins — composition enables reuse without flattening. |
| **Discovery** | Directory convention with configurable overrides (behavior varies by component type) | Explicit index entries, no directory conventions | Different philosophy: Claude plugins use directory convention; AIR uses explicit declaration. |
| **User config / secrets** | `userConfig` field with keychain integration and `${user_config.KEY}` interpolation | `PrepareTransform` extensions with `${VAR}` interpolation in MCP configs | AIR uses pluggable transform extensions (env, file-based, 1Password, Vault, etc.) rather than a built-in keychain. Both support variable interpolation in configs. |
| **Channels** | `channels` field for message injection (Telegram, Slack, etc.) | Not in scope | AIR doesn't have a messaging concept — this is agent-specific functionality. |
| **Agent scoping** | `user`, `project`, `local`, `managed` scopes | Composition via layered `air.json` (org > team > project > local) | AIR achieves scoping through ordered config layering rather than explicit scope labels. |
| **Persistent storage** | `${CLAUDE_PLUGIN_DATA}` directory survives updates | Not in scope | AIR is stateless configuration; persistent storage is outside its scope. |
| **Component types** | Same as Open Plugins, plus Output Styles, LSP Servers, `bin/` executables, `settings.json` defaults, agent frontmatter | Same as Open Plugins comparison | AIR's component type gaps are the same as noted in the Open Plugins table above. Claude-specific additions (`bin/`, `settings.json`, agent frontmatter) are runtime features outside AIR's scope. |

### Summary of Key Deviations

The deviations cluster around two fundamental design choices:

1. **Index-based references vs. inline definitions**: Both Open Plugins and Claude Plugins embed components within the plugin directory. AIR references them by ID from separate index files. This enables cross-plugin deduplication and multi-layer composition but means AIR plugins aren't self-contained directories.

2. **Plugin composition**: Neither standard currently supports plugins-of-plugins. AIR adds this to enable hierarchical bundling without manual flattening. This is a candidate for upstream contribution to both standards.

These deviations are intentional and reflect AIR's design principles (DRY, composable layers, agent-agnostic). Where possible, AIR adapters bridge the gap by translating AIR's model into each agent's native format at session start time.
