# Roots and Multi-Root Setups

A root is a self-contained agent workspace — typically a git repository (or a subdirectory within one) that contains everything an agent needs to operate in a specific domain. Roots let you scope which skills, MCP servers, plugins, and hooks are active for each project.

## Why roots matter

Without roots, every session gets every artifact. That works for simple setups, but as your configuration grows, you want to scope things:

- A frontend project needs different MCP servers than a data pipeline
- A staging deployment skill shouldn't be active when working on documentation
- Different teams need different default configurations

Roots solve this by defining per-project defaults.

## Discovered roots

When you run `air init` inside a git repo, any existing `roots.json` index files in the repo are discovered and referenced in the generated `air.json` via `github://` URIs, just like other artifact types. If no roots index file exists in the repo, roots are simply omitted from `air.json` — no files are auto-generated.

To add a root, create a `roots.json` file in your repo (e.g., `roots/roots.json`), then re-run `air init --force` to pick it up.

## Defining a root

Add or edit entries in your roots index file:

```json
{
  "web-app": {
    "name": "web-app",
    "display_name": "Web Application",
    "description": "Main web application. Full-stack Rails app with React frontend.",
    "url": "https://github.com/acme/web-app.git"
  },
  "data-pipeline": {
    "name": "data-pipeline",
    "display_name": "Data Pipeline",
    "description": "ETL pipeline and data warehouse management. Python-based with dbt.",
    "url": "https://github.com/acme/data-pipeline.git",
    "subdirectory": "pipeline"
  }
}
```

A root entry doesn't list its members. Membership is declared on each artifact: a skill, reference, MCP server, hook, or plugin joins a root by listing the root's name in its own `default_in_roots` field. For example, in `mcp.json`:

```json
{
  "github": {
    "title": "GitHub",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
    "default_in_roots": ["web-app", "data-pipeline"]
  },
  "analytics": {
    "title": "Analytics Dashboard",
    "type": "streamable-http",
    "url": "https://mcp.analytics.example.com/mcp",
    "default_in_roots": ["data-pipeline"]
  }
}
```

The wildcard `"*"` means "all roots" — e.g. `default_in_roots: ["*"]` on a personal hook makes it apply to every root without editing each one.

### Root fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier. Must match the key. |
| `description` | Yes | What this root is for. Max 500 characters. |
| `display_name` | No | Human-readable name. |
| `url` | No | Git repository URL (used for auto-detection). |
| `default_branch` | No | Default branch when cloning (defaults to `main`). |
| `subdirectory` | No | Path within the repo (for monorepos). |
| `default_in_roots` | No | Names of other roots this root is a default subagent of. Use `["*"]` for all roots. A root is never its own subagent. |
| `default_runtime` | No | Agent runtime for sessions/subagents under this root (defaults to `claude_code`). Open string; common values include `claude_code`, `codex`, `pi`, `opencode`, `amp`, `gemini`, `github_copilot`. |
| `user_invocable` | No | Whether users can start sessions with this root directly (default: `true`). |

During resolution, AIR inverts every artifact's `default_in_roots` into per-root membership: it computes each root's `default_mcp_servers`, `default_skills`, `default_plugins`, `default_hooks`, `default_references`, and `default_subagent_roots`. These computed arrays are what the rest of AIR consumes and what shows up in `air resolve` output.

## Using roots with air start

Specify a root to scope the session:

```bash
air start claude --root web-app
```

This activates only the MCP servers, skills, plugins, and hooks listed in `web-app`'s defaults. Preview with `--dry-run`:

```bash
air start claude --root web-app --dry-run
```

## Root auto-detection

When using `air prepare` without `--root`, AIR auto-detects the root by matching the target directory's git remote URL against root definitions:

```bash
# If you're in a checkout of https://github.com/acme/web-app.git
cd ~/code/web-app
air prepare claude
# stderr: Auto-detected root: web-app
```

Detection works by:
1. Getting the git remote URL of the target directory
2. Normalizing URLs (stripping `.git`, protocol differences)
3. Matching against root `url` fields
4. Breaking ties with subdirectory matching

## Monorepo support

Use `subdirectory` to scope a root to a specific path within a repository:

```json
{
  "api-service": {
    "name": "api-service",
    "description": "API service within the monorepo",
    "url": "https://github.com/acme/monorepo.git",
    "subdirectory": "services/api"
  },
  "web-frontend": {
    "name": "web-frontend",
    "description": "Web frontend within the monorepo",
    "url": "https://github.com/acme/monorepo.git",
    "subdirectory": "apps/web"
  }
}
```

Artifacts then list `api-service` or `web-frontend` in their own `default_in_roots` to join each one.

When auto-detecting, AIR picks the root whose `subdirectory` best matches the target directory's position within the repo.

## Subagent roots

A root becomes a subagent of another root by listing the parent in its own `default_in_roots` — the same inversion used for every other artifact. To make `web-app` and `data-pipeline` subagents of an `orchestrator` root, declare it on each subagent root:

```json
{
  "orchestrator": {
    "name": "orchestrator",
    "description": "Main orchestrator that delegates to specialized agents",
    "url": "https://github.com/acme/orchestrator.git"
  },
  "web-app": {
    "name": "web-app",
    "description": "Main web application.",
    "url": "https://github.com/acme/web-app.git",
    "default_in_roots": ["orchestrator"]
  },
  "data-pipeline": {
    "name": "data-pipeline",
    "description": "ETL pipeline and data warehouse.",
    "url": "https://github.com/acme/data-pipeline.git",
    "default_in_roots": ["orchestrator"]
  }
}
```

AIR inverts these into `orchestrator`'s computed `default_subagent_roots: ["web-app", "data-pipeline"]`. (A root is never its own subagent.) By default, both `air start` and `air prepare` merge subagent roots' skills and MCP servers into the parent session and append context about the subagent dependencies to the system prompt. This gives the parent agent awareness of its subagents' capabilities.

To opt out of this merging (e.g., when your orchestrator manages subagent composition externally):

```bash
air start claude --no-subagent-merge
# or
air prepare claude --no-subagent-merge
```

## Non-invocable roots

Set `user_invocable: false` for roots that should only be used as subagent dependencies, not started directly:

```json
{
  "shared-utils": {
    "name": "shared-utils",
    "description": "Shared utility functions — subagent only",
    "url": "https://github.com/acme/shared-utils.git",
    "user_invocable": false
  }
}
```

(The `lint-fix` skill joins this root by listing `shared-utils` in its own `default_in_roots`.)

## Listing roots

```bash
air list roots
```

Output:

```
Roots (2):

  web-app (Web Application)
    Main web application. Full-stack Rails app with React frontend.
    URL: https://github.com/acme/web-app.git
    MCP Servers: github, postgres-prod
    Skills: deploy-staging, initial-pr-review

  data-pipeline (Data Pipeline)
    ETL pipeline and data warehouse management. Python-based with dbt.
    URL: https://github.com/acme/data-pipeline.git
    MCP Servers: github, analytics
    Skills: initial-pr-review
```

## Best practices

- **Scope tightly.** Each root should represent a single project or bounded context. Avoid catch-all roots.
- **Minimize defaults.** Only include the skills and servers that are genuinely needed for most sessions in that root. Users can always adjust with `--skill` and `--mcp-server` (or their `--without-*` counterparts).
- **Set URLs for auto-detection.** Without `url`, the root can only be used with explicit `--root`.
- **Mark utility roots as non-invocable.** If a root only makes sense as a subagent dependency, set `user_invocable: false`.

## Next steps

- **[Running Sessions](running-sessions.md)** — Use roots with `air start` and `air prepare`.
- **[Managing Skills](managing-skills.md)** — Define skills to assign to roots.
- **[Configuring MCP Servers](configuring-mcp-servers.md)** — Define servers to assign to roots.
