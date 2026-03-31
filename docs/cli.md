# CLI Reference

The AIR CLI (`air`) is the primary interface for working with AIR configurations. It validates schemas, resolves composed configs, and starts agent sessions.

## Installation

```bash
npm install -g @pulsemcp/air-cli
```

Or run directly with npx:

```bash
npx @pulsemcp/air-cli <command>
```

## Commands

### `air init`

Initialize a new AIR configuration at `~/.air/`.

```bash
air init
```

Creates:
- `~/.air/air.json` — root config
- `~/.air/skills/skills.json` — empty skills index
- `~/.air/references/references.json` — empty references index
- `~/.air/mcp/mcp.json` — empty MCP servers config
- `~/.air/plugins/plugins.json` — empty plugins index
- `~/.air/roots/roots.json` — empty roots index
- `~/.air/hooks/hooks.json` — empty hooks index

Orgs and teams can provide default `air.json` files as starting points. Copy one into `~/.air/air.json` and customize.

### `air validate <file>`

Validate a JSON file against its AIR schema.

```bash
air validate ~/.air/air.json
air validate ~/.air/mcp/mcp.json
air validate ~/.air/skills/skills.json
air validate ~/.air/references/references.json
air validate ~/.air/plugins/plugins.json
air validate ~/.air/roots/roots.json
air validate ~/.air/hooks/hooks.json
```

The schema is detected automatically from the filename. You can also validate any file by specifying the schema:

```bash
air validate my-config.json --schema mcp
```

**Options:**

| Flag | Description |
|------|-------------|
| `--schema <type>` | Override schema detection. Values: `air`, `skills`, `references`, `mcp`, `plugins`, `roots`, `hooks`. |

**Exit codes:**
- `0` — validation passed
- `1` — validation failed (errors printed to stderr)

### `air start <agent>`

Start an agent session with AIR configurations loaded.

```bash
# Start Claude Code
air start claude

# Start with a specific root
air start claude --root web-app

# Dry run — show what would be activated
air start claude --root web-app --dry-run

# Skip confirmation prompt
air start claude --skip-confirmation
```

**Agents:** `air start <agent>` works for any agent with an installed adapter package. The CLI discovers adapters via `@pulsemcp/air-adapter-<agent>` packages. Currently available:
- `claude` — via `@pulsemcp/air-adapter-claude` (officially maintained)

**Options:**

| Flag | Description |
|------|-------------|
| `--root <name>` | Root to start the session in. |
| `--dry-run` | Show what would be activated without starting the agent. |
| `--skip-confirmation` | Don't prompt for confirmation before starting. |

**What happens on `air start`:**

1. Loads `~/.air/air.json` (or `AIR_CONFIG` override)
2. If `--root` is specified, resolves the root's default artifacts
3. Translates artifacts to the target agent's format
4. Shows a summary of what will be activated
5. Prompts for confirmation (unless `--skip-confirmation`)
6. Writes agent-specific config files and starts the agent

### `air list <type>`

List available artifacts of a given type.

```bash
air list skills
air list mcp
air list plugins
air list roots
air list hooks
air list references
```

Shows ID, title (if available), and description for each artifact. Shows the merged result from all files listed in `air.json`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AIR_CONFIG` | Override path to `air.json` (default: `~/.air/air.json`). |
| `AIR_NO_COLOR` | Disable colored output. |
