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

When run inside a git repo with AIR artifact index files, also discovers them automatically and adds `github://` resolver URIs for each discovered artifact type to the generated `air.json`. The discovered catalog ships under its `@<owner>/<repo>/` scope and the local scaffold ships under `@local/`, so the two layers compose without colliding on qualified IDs. The local scaffold is created regardless, since `air.json` is where remote catalogs and local artifacts compose.

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
  "skills":     { "@scope/<id>": { "description": "...", "path": "/abs/path" } },
  "references": { "@scope/<id>": { "description": "...", "path": "/abs/path" } },
  "mcp":        { "@scope/<id>": { "type": "stdio", "command": "...", "args": [] } },
  "plugins":    { "@scope/<id>": { "description": "...", "skills": [], "mcp_servers": [] } },
  "roots":      { "@scope/<id>": { "description": "...", "default_skills": [] } },
  "hooks":      { "@scope/<id>": { "description": "...", "path": "/abs/path" } }
}
```

Keys are qualified IDs (`@scope/id`); reference fields inside entries (e.g. `default_skills`, `mcp_servers`) are likewise qualified. All `path` fields are absolute, making the output self-contained regardless of where the `air.json` lives.

**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Emit JSON output (default and currently the only supported format; accepted for forward-compat). |
| `--no-scope` | Emit shortname-keyed output instead of the default qualified-ID keys. Hard-fails if any shortname is contributed by more than one scope. See [Shortname-keyed output](#shortname-keyed-output---no-scope) below. |
| `--config <path>` | Path to `air.json`. Defaults to `AIR_CONFIG` env or `~/.air/air.json`. |
| `--git-protocol <ssh\|https>` | Protocol used by git-based catalog providers when cloning. Defaults to `ssh`. Overrides the `gitProtocol` field in `air.json` and the `AIR_GIT_PROTOCOL` env var for this invocation. |

**Exit codes:**
- `0` — resolved successfully; JSON written to stdout
- `1` — resolution failed (e.g., missing `air.json`, unreachable provider, or `--no-scope` with cross-scope shortname collisions); error on stderr

#### Shortname-keyed output (`--no-scope`)

Pass `--no-scope` to emit the same artifact tree but keyed by bare shortnames (`github`) instead of qualified IDs (`@local/github`). Reference fields inside entries — `default_skills`, `mcp_servers`, `skills.references`, etc. — are likewise rewritten to bare form.

```bash
air resolve --no-scope
```

```json
{
  "mcp":   { "github": { "type": "stdio", "command": "..." } },
  "roots": { "default": { "default_mcp_servers": ["github"] } }
}
```

`--no-scope` is **opt-in** and **hard-fails** when a shortname is contributed by more than one scope within the same artifact category. The error lists every colliding qualified ID so you can pick which one to drop:

```
Error: --no-scope requires unique shortnames across all scopes, but
  shortname "github" maps to multiple qualified IDs:
    - @local/github
    - @reframe-systems/agentic-engineering/github
  Either use the default qualified output, or exclude one of them
  via air.json#exclude.
```

There is no silent later-wins. Either drop the colliding entry via `air.json#exclude`, or stay on the default qualified output.

**When to use `--no-scope`:**

- You are committed to a single-scope universe — local-only, internal-only, or a single private catalog.
- You are an early adopter whose downstream consumer (database schema, UI, scripts) was built around bare shortnames and would otherwise need to maintain a regex-stripping shim.
- The output is consumed by humans, scripts, or UIs where qualified IDs add noise (`jq`, tables, dashboards, demos).

**When NOT to use `--no-scope`:**

- You compose multiple catalogs intentionally and want both `@acme/review` and `@local/review` to coexist — that is exactly what the default qualified output is for.

**Trade-off.** Using `--no-scope` is a commitment. Add a second catalog later that contributes a colliding shortname, and your build breaks until you either exclude the colliding artifact via `air.json#exclude` or switch back to the default qualified output (and update consumers). That's the right trade-off for this flag — brevity now in exchange for an enforced invariant. Users who want compositional flexibility should stick with the default.

### `air clean [adapter]`

Remove every artifact AIR has previously written to a target directory. Reads the AIR manifest (`~/.air/manifests/<sha>.json`) for the target, then asks the adapter to remove the tracked skill directories, hook directories, MCP server keys (from `.mcp.json`), and adapter-managed hook entries (from `.claude/settings.json` for Claude). User-authored entries that AIR did not write are preserved.

The adapter argument is optional: when omitted, AIR reads the adapter name from the manifest written by the last `air prepare` / `air start` for this target. Pass it explicitly only to override the inferred value (or for manifests written by older AIR versions that predate the recorded-adapter field).

```bash
# Clean every AIR-managed artifact from the current directory
# (adapter inferred from the manifest)
air clean

# Same, but for a different target directory
air clean --target /path/to/repo

# Preview what would be removed without modifying disk
air clean --dry-run

# Keep skills (or hooks, or MCP servers) — preserves both the files and the manifest entries
air clean --keep-skills
air clean --keep-hooks
air clean --keep-mcp

# Override the inferred adapter (rare — only needed for manifests written
# by older AIR versions without the adapter field, or to force a specific adapter)
air clean claude
```

The manifest is deleted only on a full clean. If any `--keep-*` flag is set, the manifest is rewritten with the kept entries preserved so future `prepare`/`clean` cycles still track them. Items listed in the manifest that no longer exist on disk are silently skipped (handles drift where files were removed manually).

If `.mcp.json` would be left empty after removing AIR-managed servers (no other top-level keys), the file is deleted entirely. Otherwise it is rewritten with the user-authored entries intact.

**Options:**

| Flag | Description |
|------|-------------|
| `--target <dir>` | Target directory to clean. Defaults to the current directory. |
| `--dry-run` | Print what would be removed without modifying disk. |
| `--keep-skills` | Don't remove skill directories — preserve them in the manifest. |
| `--keep-hooks` | Don't remove hook directories or AIR-managed hook entries from `.claude/settings.json`. |
| `--keep-mcp` | Don't remove AIR-managed MCP server keys from `.mcp.json`. |
| `--config <path>` | Path to `air.json`. Used only to locate adapter packages installed via `air install`. Defaults to `AIR_CONFIG` env or `~/.air/air.json`. |

**Output:** A human-readable summary is printed to stderr; a structured JSON result is printed to stdout (suitable for `jq` or scripting).

**Exit codes:**
- `0` — clean succeeded (including the no-manifest no-op case)
- `1` — clean failed (e.g., adapter not installed, adapter does not implement clean)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AIR_CONFIG` | Override path to `air.json` (default: `~/.air/air.json`). |
| `AIR_NO_COLOR` | Disable colored output. |
| `AIR_GIT_PROTOCOL` | Force the protocol used by git-based catalog providers (`ssh` or `https`). Overrides the `gitProtocol` field in `air.json`; a `--git-protocol` CLI flag still wins over the env var. |
| `AIR_GITHUB_TOKEN` | GitHub token used by `@pulsemcp/air-provider-github` for private repos and higher rate limits. Only consumed when protocol is `https`; ignored under `ssh`. |
