# MCP Servers

MCP (Model Context Protocol) is the open protocol for connecting AI agents to wholly or partially deterministic tools and data sources. It handles auth and access boundaries. AIR uses the [mcp.json format](mcp-json-proposal.md) for configuring MCP servers — a proposed client-side configuration standard.

## mcp.json Format

MCP servers are configured in `mcp.json` as a flat map of server names to connection configurations:

```json
{
  "github": {
    "title": "GitHub",
    "description": "Create and manage issues, PRs, branches, and files.",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
    }
  }
}
```

### Server Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | No | Human-readable display name (max 100 chars). |
| `description` | string | No | What the server provides (max 500 chars). |
| `type` | string | **Yes** | Transport type: `"stdio"`, `"sse"`, or `"streamable-http"`. |
| `command` | string | Yes (stdio) | Executable command for local process servers. |
| `args` | string[] | No (stdio) | Command-line arguments. |
| `env` | object | No (stdio) | Environment variables for the server process. |
| `url` | string | Yes (remote) | Endpoint URL for remote servers. |
| `headers` | object | No (remote) | HTTP headers for remote servers. |

## Transport Types

### stdio — Local Process Servers

The most common type. Runs a local process that communicates via stdin/stdout:

```json
{
  "postgres": {
    "title": "PostgreSQL",
    "description": "Read-only access to the production database.",
    "type": "stdio",
    "command": "uvx",
    "args": ["--from", "postgres-mcp==0.3.0", "postgres-mcp", "--access-mode=restricted"],
    "env": {
      "DATABASE_URI": "postgresql://${PG_USER}:${PG_PASSWORD}@db.example.com:5432/prod"
    }
  }
}
```

**Required fields**: `type`, `command`
**Forbidden fields**: `url`, `headers`

### sse — Server-Sent Events

For remote servers using the SSE transport:

```json
{
  "monitoring": {
    "title": "Monitoring",
    "type": "sse",
    "url": "https://mcp.monitoring.example.com/sse",
    "headers": {
      "Authorization": "Bearer ${MONITORING_TOKEN}"
    }
  }
}
```

**Required fields**: `type`, `url`
**Forbidden fields**: `command`, `args`

### streamable-http — HTTP Streaming

For remote servers using HTTP streaming (newer transport):

```json
{
  "analytics": {
    "title": "Analytics",
    "type": "streamable-http",
    "url": "https://mcp.analytics.example.com/mcp",
    "headers": {
      "X-API-Key": "${ANALYTICS_API_KEY}"
    }
  }
}
```

**Required fields**: `type`, `url`
**Forbidden fields**: `command`, `args`

## Environment Variable Interpolation

All string values support `${ENV_VAR}` interpolation. The agent's runtime resolves these from the user's environment:

```json
{
  "env": {
    "DATABASE_URI": "postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:5432/mydb"
  }
}
```

- **Secrets must use interpolation** — never commit raw credentials
- **Non-secrets may use literals** — `"HEADLESS": "true"` is fine
- **Variable names** should be `UPPER_SNAKE_CASE`

## Version Pinning

**Always pin packages to exact versions:**

- **npm**: `@scope/package@0.6.2` (not `@latest` or `@^1.0.0`)
- **PyPI**: `package==0.5.0` (not `package` or `package>=0.5`)
- **OCI**: `image:1.0.2` (not `image:latest`)

Unpinned versions cause non-deterministic behavior and make debugging difficult.

## Agent Translation

At session start, AIR translates `mcp.json` entries to agent-specific formats:

### Claude Code

Claude Code uses `.mcp.json` with servers nested under an `mcpServers` key:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

For remote servers, Claude Code uses `url` and optional `headers` instead of `command`/`args`.

## Best Practices

1. **Write descriptions for agents** — the description is what agents use to decide if they need this server
2. **Pin versions** — always use exact version numbers
3. **Use interpolation for secrets** — never commit credentials
4. **Minimize servers per session** — only declare what's actually needed
5. **Scope descriptions clearly** — "Production database (read-only)" not just "Database"
