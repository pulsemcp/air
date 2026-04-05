# Roots

Roots are self-contained agent workspaces — a git repo (or subdirectory) with a file hierarchy (including AGENTS.md files) an agent needs for a specific project.

## Why Roots?

As your agent configuration grows, different domains need different setups:

- Your **web app** needs GitHub, PostgreSQL, and deployment skills
- Your **data pipeline** needs BigQuery, dbt, and ETL skills
- Your **documentation** needs a CMS server and content review skills

Roots let you define these domain-specific bundles. When you start an agent session, you pick a root and get exactly the MCP servers, skills, plugins, and hooks that domain needs.

## Index Format

Roots are registered in `roots.json`:

```json
{
  "web-app": {
    "name": "web-app",
    "display_name": "Web Application",
    "description": "Main web app — Rails backend, React frontend",
    "url": "https://github.com/acme/web-app.git",
    "default_branch": "main",
    "default_mcp_servers": ["github", "postgres-prod"],
    "default_skills": ["deploy-staging", "pr-review"],
    "default_plugins": ["code-quality"],
    "default_hooks": ["lint-pre-commit"],
    "user_invocable": true,
    "default_stop_condition": "open-reviewed-green-pr"
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier. Must match the key. |
| `display_name` | No | Human-readable name. |
| `description` | Yes | What this root is for. Clear to anyone in the org. |
| `url` | No | Git repository URL. |
| `default_branch` | No | Branch to use when cloning (defaults to `main`). |
| `subdirectory` | No | Path within the repo (for monorepo setups). |
| `default_mcp_servers` | No | MCP server IDs to activate by default. |
| `default_skills` | No | Skill IDs to make available by default. |
| `default_plugins` | No | Plugin IDs to activate by default. |
| `default_hooks` | No | Hook IDs to activate by default. |
| `user_invocable` | No | Whether users can start sessions with this root directly (default: true). |
| `default_stop_condition` | No | Default condition for when the agent should hand back control. |

## Monorepo Support

For monorepos, use the `subdirectory` field to point to a specific path within the repository:

```json
{
  "api-service": {
    "name": "api-service",
    "description": "API service within the platform monorepo",
    "url": "https://github.com/acme/platform.git",
    "subdirectory": "services/api",
    "default_mcp_servers": ["github"],
    "default_skills": ["deploy-staging"]
  }
}
```

AIR works inside monorepos seamlessly — you just need everyone to know where the `air.json` file is.

## Stop Conditions

The `default_stop_condition` field tells the agent when to hand back control. Common patterns:

- `"open-reviewed-green-pr"` — open a PR, get review, ensure CI passes
- `"tests-passing"` — make changes and ensure tests pass
- `"draft-pr"` — open a draft PR for human review

These are conventions, not enforced values. Agents interpret them based on their capabilities.

## Starting Sessions with Roots

```bash
# Start a session with a specific root
air start claude --root web-app

# See what would be activated (dry run)
air start claude --root web-app --dry-run

# List available roots
air list roots
```

When you start a session with a root, AIR:

1. Resolves all referenced MCP servers, skills, plugins, and hooks
2. Translates them to the target agent's format
3. Clones the repository (if URL is specified)
4. Starts the agent session in the root's working directory

## Roots in Multi-Agent Systems

Roots are the primary building block for multi-agent architectures. An orchestrator agent operates on one root, and spawns subagents on other roots — each with its own skills, MCP servers, and scope.

```
Orchestrator root: "pipeline"
  ├── default_mcp_servers: ["orchestrator-mcp"]     ← can spawn subagents
  └── default_skills: ["run-pipeline"]

Subagent root: "pipeline-phase-1"
  ├── default_mcp_servers: ["domain-db"]             ← domain tools only
  ├── default_skills: ["ingest-data"]
  └── user_invocable: false                          ← only spawned by orchestrator
```

Setting `user_invocable: false` on subagent roots signals that they exist to be spawned programmatically, not started directly by users.

AIR resolves the config for each root independently. The orchestration logic — deciding execution order, passing data, handling failures — lives in the orchestration platform, not in AIR. See [Orchestration & Multi-Agent Patterns](orchestration.md) for detailed patterns.

## Best Practices

1. **Scope descriptions clearly** — anyone in the org should understand what each root is for
2. **Minimize defaults** — only include MCP servers and skills the root actually needs
3. **Use stop conditions** — help agents know when they're done
4. **Keep roots focused** — one domain per root. If a root needs too many things, it's probably too broad.
