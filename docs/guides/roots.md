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
    "url": "https://github.com/acme/web-app.git",
    "default_mcp_servers": ["github", "postgres-prod"],
    "default_skills": ["deploy-staging", "initial-pr-review"],
    "default_plugins": ["code-quality"],
    "default_hooks": ["lint-pre-commit"]
  },
  "data-pipeline": {
    "name": "data-pipeline",
    "display_name": "Data Pipeline",
    "description": "ETL pipeline and data warehouse management. Python-based with dbt.",
    "url": "https://github.com/acme/data-pipeline.git",
    "subdirectory": "pipeline",
    "default_mcp_servers": ["github", "analytics"],
    "default_skills": ["initial-pr-review"]
  }
}
```

### Root fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier. Must match the key. |
| `description` | Yes | What this root is for. Max 500 characters. |
| `display_name` | No | Human-readable name. |
| `url` | No | Git repository URL (used for auto-detection). |
| `default_branch` | No | Default branch when cloning (defaults to `main`). |
| `subdirectory` | No | Path within the repo (for monorepos). |
| `default_mcp_servers` | No | MCP server IDs to activate by default. |
| `default_skills` | No | Skill IDs to make available by default. |
| `default_plugins` | No | Plugin IDs to activate by default. |
| `default_hooks` | No | Hook IDs to activate by default. |
| `default_subagent_roots` | No | IDs of other roots this root depends on as subagents. |
| `user_invocable` | No | Whether users can start sessions with this root directly (default: `true`). |

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
    "subdirectory": "services/api",
    "default_mcp_servers": ["github", "postgres-prod"]
  },
  "web-frontend": {
    "name": "web-frontend",
    "description": "Web frontend within the monorepo",
    "url": "https://github.com/acme/monorepo.git",
    "subdirectory": "apps/web",
    "default_mcp_servers": ["github"]
  }
}
```

When auto-detecting, AIR picks the root whose `subdirectory` best matches the target directory's position within the repo.

## Subagent roots

A root can declare dependencies on other roots via `default_subagent_roots`:

```json
{
  "orchestrator": {
    "name": "orchestrator",
    "description": "Main orchestrator that delegates to specialized agents",
    "url": "https://github.com/acme/orchestrator.git",
    "default_subagent_roots": ["web-app", "data-pipeline"],
    "default_mcp_servers": ["github"],
    "default_skills": ["orchestrate-deploy"]
  }
}
```

By default, both `air start` and `air prepare` merge subagent roots' skills and MCP servers into the parent session and append context about the subagent dependencies to the system prompt. This gives the parent agent awareness of its subagents' capabilities.

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
    "user_invocable": false,
    "default_skills": ["lint-fix"]
  }
}
```

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
- **Minimize defaults.** Only include the skills and servers that are genuinely needed for most sessions in that root. Users can always override with `--skills` and `--mcp-servers`.
- **Set URLs for auto-detection.** Without `url`, the root can only be used with explicit `--root`.
- **Mark utility roots as non-invocable.** If a root only makes sense as a subagent dependency, set `user_invocable: false`.

## Next steps

- **[Running Sessions](running-sessions.md)** — Use roots with `air start` and `air prepare`.
- **[Managing Skills](managing-skills.md)** — Define skills to assign to roots.
- **[Configuring MCP Servers](configuring-mcp-servers.md)** — Define servers to assign to roots.
