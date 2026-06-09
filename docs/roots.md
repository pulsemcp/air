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
    "display_name": "Web Application",
    "description": "Main web app — Rails backend, React frontend",
    "url": "https://github.com/acme/web-app.git",
    "default_branch": "main",
    "user_invocable": true
  }
}
```

A root entry no longer lists its members. Instead, each artifact declares which roots it belongs to via `default_in_roots`. For example, an MCP server joins `web-app` by listing it in the server's own entry in `mcp.json`:

```json
{
  "github": {
    "title": "GitHub",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
    "default_in_roots": ["web-app", "data-pipeline"]
  }
}
```

Skills, references, hooks, and plugins use the same `default_in_roots` field in their respective indexes. A root itself can declare `default_in_roots` to become a default subagent of other roots (see [Roots in Multi-Agent Systems](#roots-in-multi-agent-systems)). The wildcard `"*"` means "all roots" — useful for, say, a personal hook that should apply everywhere without editing each root.

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `display_name` | No | Human-readable name. |
| `description` | Yes | What this root is for. Clear to anyone in the org. |
| `url` | No | Git repository URL. |
| `default_branch` | No | Branch to use when cloning (defaults to `main`). |
| `subdirectory` | No | Path within the repo (for monorepo setups). |
| `default_in_roots` | No | Names of other roots this root is a default subagent of. Use `["*"]` for all roots. (A root is never its own subagent.) |
| `default_runtime` | No | Agent runtime for sessions/subagents under this root (defaults to `claude_code`). Open string; common values include `claude_code`, `codex`, `pi`, `opencode`, `amp`, `gemini`, `github_copilot`. |
| `user_invocable` | No | Whether users can start sessions with this root directly (default: true). |

Skills, MCP servers, plugins, and hooks become members of a root by listing the root name in their own `default_in_roots` field. AIR inverts these declarations during resolution to compute each root's effective `default_mcp_servers`, `default_skills`, `default_plugins`, `default_hooks`, and `default_references` (see the resolved-output examples below).

## Monorepo Support

For monorepos, use the `subdirectory` field to point to a specific path within the repository:

```json
{
  "api-service": {
    "description": "API service within the platform monorepo",
    "url": "https://github.com/acme/platform.git",
    "subdirectory": "services/api"
  }
}
```

Artifacts that belong to `api-service` (such as the `github` server or the `deploy-staging` skill) list it in their own `default_in_roots`.

AIR works inside monorepos seamlessly — you just need everyone to know where the `air.json` file is.

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

Membership is authored on the artifacts (and on subagent roots) via `default_in_roots`, not on the parent root. A root becomes a default subagent of another root by listing the parent in its own `default_in_roots`. The tree below shows the *effective* membership AIR computes after inverting those declarations — `(computed)` fields are derived by the resolver, while `(authored)` fields are what you actually write in your indexes:

```
Orchestrator root: "pipeline"
  ├── default_mcp_servers: ["orchestrator-mcp"]     ← (computed) can spawn subagents
  ├── default_skills: ["run-pipeline"]              ← (computed)
  └── default_subagent_roots: ["pipeline-phase-1"]  ← (computed)

Subagent root: "pipeline-phase-1"
  ├── default_mcp_servers: ["domain-db"]             ← (computed) domain tools only
  ├── default_skills: ["ingest-data"]                ← (computed)
  ├── default_in_roots: ["pipeline"]                 ← (authored) makes it a subagent of "pipeline"
  └── user_invocable: false                          ← (authored) only spawned by orchestrator
```

The only membership field you author is `default_in_roots`; every `default_*` array on a root is computed by inverting those declarations. Here `pipeline-phase-1` authors `default_in_roots: ["pipeline"]` in `roots.json`, and AIR computes `pipeline`'s `default_subagent_roots` from it. Likewise, the `orchestrator-mcp` server lists `pipeline` in its `default_in_roots`, and AIR computes `pipeline`'s `default_mcp_servers`. The resolver also computes a `default_references` array per root the same way. Setting `user_invocable: false` on subagent roots signals that they exist to be spawned programmatically, not started directly by users.

AIR resolves the config for each root independently. The orchestration logic — deciding execution order, passing data, handling failures — lives in the orchestration platform, not in AIR. See [Orchestration & Multi-Agent Patterns](orchestration.md) for detailed patterns.

## Best Practices

1. **Scope descriptions clearly** — anyone in the org should understand what each root is for
2. **Minimize defaults** — only include MCP servers and skills the root actually needs
3. **Keep roots focused** — one domain per root. If a root needs too many things, it's probably too broad.
