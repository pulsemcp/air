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

Always scaffolds a ready-to-edit workspace at `~/.air/`:

- `air.json` pre-wired to local index files for all six artifact types.
- One `$schema`-referenced index file per type (`skills/skills.json`, `mcp/mcp.json`, etc.) so editors like VS Code give autocomplete and inline validation.
- `README.md` orienting the user to the layout with worked examples.

When run inside a git repo with AIR artifact index files, also discovers them automatically and adds `github://` resolver URIs for each discovered artifact type to the generated `air.json` — wired in *before* the local index path so local entries override the discovered catalog by ID. The local scaffold is created regardless, since `air.json` is where remote catalogs and local artifacts compose.

Open the directory in your editor and start adding entries.

**Re-running on an existing config (top-up mode):** If `~/.air/air.json` already exists and `--force` is not set, `air init` runs in idempotent **top-up mode**: your existing `air.json` is left untouched, and only missing scaffold pieces (index files, `README.md`) are created. This is safe to run repeatedly and gives users who initialized on an older version a way to fill in newer scaffold pieces without losing their configuration.

To regenerate `air.json` from scratch (overwriting the existing file), use `--force`.

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
| `--git-protocol <ssh\|https>` | Protocol used by git-based catalog providers when cloning. Defaults to `ssh`. Overrides the `gitProtocol` field in `air.json` and the `AIR_GIT_PROTOCOL` env var for this invocation. |

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

### `air resolve --json`

Resolve the active `air.json` and print the full merged artifact tree as JSON to stdout. The `--json` flag is optional (JSON is the default and currently only supported format) — it is accepted for forward compatibility so downstream callers can pin the output format explicitly.

```bash
# Resolve the default ~/.air/air.json
air resolve --json

# Resolve a specific config
air resolve --json --config /path/to/air.json

# Via env var
AIR_CONFIG=/path/to/air.json air resolve --json
```

Loads `air.json`, runs catalog providers (e.g., `github://`) declared under `extensions`, and emits the merged `ResolvedArtifacts` object — the same structure returned by `resolveArtifacts()` in `@pulsemcp/air-core`. Useful for non-Node consumers (Ruby, Python, orchestrators, dashboards) that need to inspect the resolved artifact tree without reimplementing the resolution pipeline.

**Output shape:**

```json
{
  "skills":     { "<id>": { "description": "...", "path": "/abs/path" } },
  "references": { "<id>": { "description": "...", "path": "/abs/path" } },
  "mcp":        { "<id>": { "type": "stdio", "command": "...", "args": [] } },
  "plugins":    { "<id>": { "description": "...", "skills": [], "mcp_servers": [] } },
  "roots":      { "<id>": { "description": "...", "default_skills": [] } },
  "hooks":      { "<id>": { "description": "...", "path": "/abs/path" } }
}
```

All `path` fields are absolute, making the output self-contained regardless of where the `air.json` lives.

**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Emit JSON output (default and currently the only supported format; accepted for forward-compat). |
| `--config <path>` | Path to `air.json`. Defaults to `AIR_CONFIG` env or `~/.air/air.json`. |
| `--git-protocol <ssh\|https>` | Protocol used by git-based catalog providers when cloning. Defaults to `ssh`. Overrides the `gitProtocol` field in `air.json` and the `AIR_GIT_PROTOCOL` env var for this invocation. |

**Exit codes:**
- `0` — resolved successfully; JSON written to stdout
- `1` — resolution failed (e.g., missing `air.json`, unreachable provider); error on stderr

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AIR_CONFIG` | Override path to `air.json` (default: `~/.air/air.json`). |
| `AIR_NO_COLOR` | Disable colored output. |
| `AIR_GIT_PROTOCOL` | Force the protocol used by git-based catalog providers (`ssh` or `https`). Overrides the `gitProtocol` field in `air.json`; a `--git-protocol` CLI flag still wins over the env var. |
| `AIR_GITHUB_TOKEN` | GitHub token used by `@pulsemcp/air-provider-github` for private repos and higher rate limits. Only consumed when protocol is `https`; ignored under `ssh`. |
