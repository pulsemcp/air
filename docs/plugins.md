# Plugins

Plugins are groupings of MCP server configurations and skills. They bundle related capabilities into a single installable unit. For now, AIR models plugins canonically after Claude Code Plugins with translation layers for other agents.

## Why Plugins?

MCP servers provide tools. Skills provide procedures. Plugins bundle them together into cohesive packages — a "deployment" plugin might group a CI/CD MCP server with deployment skills, or a "code quality" plugin might combine a linting MCP server with review skills. Plugins can also include standalone commands:

- **Linters and formatters** that run on code before commit
- **Build tools** that compile or bundle
- **Database migrations** that update schemas
- **Custom scripts** that integrate with internal tooling

## Index Format

Plugins are registered in `plugins.json`:

```json
{
  "eslint-autofix": {
    "id": "eslint-autofix",
    "title": "ESLint Autofix",
    "description": "Automatically fix linting issues in staged files before commit",
    "type": "command",
    "command": "npx",
    "args": ["eslint", "--fix", "."],
    "timeout_seconds": 60
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier. Must match the key. |
| `title` | No | Human-readable display name. |
| `description` | Yes | What this plugin does. |
| `type` | Yes | Plugin type. Currently only `"command"` is supported. |
| `command` | Yes | Executable command to run. |
| `args` | No | Command-line arguments. |
| `env` | No | Environment variables. Values support `${VAR}` interpolation. |
| `timeout_seconds` | No | Maximum execution time before the plugin is killed. |

## Translation Layers

AIR plugins are agent-agnostic. At session start, they're translated to agent-specific formats.

### Claude Code

Claude Code plugins are defined in `.claude/plugins/` as individual plugin files. AIR generates these from the plugins index:

**AIR plugin:**
```json
{
  "eslint-autofix": {
    "id": "eslint-autofix",
    "description": "Auto-fix linting issues",
    "type": "command",
    "command": "npx",
    "args": ["eslint", "--fix", "."],
    "timeout_seconds": 60
  }
}
```

**Generated Claude Code plugin:**
```json
{
  "name": "eslint-autofix",
  "description": "Auto-fix linting issues",
  "command": "npx",
  "args": ["eslint", "--fix", "."],
  "timeout": 60
}
```

### OpenCode (Coming Soon)

OpenCode plugin translation is planned for a future release.

### Cursor (Coming Soon)

Cursor plugin translation is planned for a future release.

## Best Practices

1. **Set timeouts** — prevent runaway processes from blocking sessions
2. **Use interpolation for secrets** — `${VAR}` for any credentials in env
3. **Keep plugins focused** — one plugin, one task
4. **Test commands locally** — make sure the command works before adding it as a plugin
5. **Pin versions** — if the command runs a package, pin it to an exact version
