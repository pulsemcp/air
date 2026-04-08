# Configuring MCP Servers

MCP (Model Context Protocol) servers provide tools and data to AI agents. AIR manages MCP server configuration so your agents get the right servers activated for each session.

## Defining MCP servers

MCP servers are defined in a JSON index file (typically `~/.air/mcp/mcp.json`). Each entry is keyed by server name and describes how to connect.

### stdio servers (local processes)

For servers that run as local processes:

```json
{
  "github": {
    "title": "GitHub",
    "description": "Create and manage issues, PRs, branches, and files in GitHub repos.",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"stdio"` |
| `command` | Yes | Executable to run |
| `args` | No | Command-line arguments |
| `env` | No | Environment variables for the process |
| `title` | No | Human-readable name |
| `description` | No | What the server provides |

### SSE servers (Server-Sent Events)

For remote servers using the SSE transport:

```json
{
  "analytics": {
    "title": "Analytics Dashboard",
    "description": "Query analytics data and generate reports.",
    "type": "sse",
    "url": "https://mcp.analytics.example.com/sse",
    "headers": {
      "Authorization": "Bearer ${ANALYTICS_TOKEN}"
    }
  }
}
```

### Streamable HTTP servers

For remote servers using the streamable HTTP transport:

```json
{
  "internal-api": {
    "title": "Internal API",
    "description": "Access internal services and data.",
    "type": "streamable-http",
    "url": "https://mcp.internal.example.com/mcp",
    "headers": {
      "Authorization": "Bearer ${API_TOKEN}"
    }
  }
}
```

Remote server fields:

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | `"sse"` or `"streamable-http"` |
| `url` | Yes | Server endpoint URL |
| `headers` | No | HTTP headers (e.g., authorization) |
| `env` | No | Environment variables (available on all transport types) |
| `oauth` | No | OAuth configuration for auto-authentication |

### OAuth configuration

For servers that use OAuth:

```json
{
  "secure-service": {
    "title": "Secure Service",
    "type": "streamable-http",
    "url": "https://mcp.secure.example.com/mcp",
    "oauth": {
      "clientId": "my-client-id",
      "scopes": ["read", "write"],
      "redirectUri": "http://localhost:3000/callback"
    }
  }
}
```

OAuth fields:

| Field | Description |
|-------|-------------|
| `clientId` | OAuth client ID. Omit for Dynamic Client Registration (DCR). |
| `scopes` | Scopes to request in the authorization flow. |
| `redirectUri` | Callback URI (typically `http://localhost:{port}/callback` for CLI tools). |

## Environment variable interpolation

MCP server configs support `${ENV_VAR}` and `${ENV_VAR:-default}` interpolation in `command`, `args`, `env` values, `url`, and `headers` values:

```json
{
  "postgres": {
    "type": "stdio",
    "command": "uvx",
    "args": ["--from", "postgres-mcp==0.3.0", "postgres-mcp"],
    "env": {
      "DATABASE_URI": "postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:5432/mydb"
    }
  }
}
```

Variables are resolved from the environment when the session starts. Use `${VAR:-default}` to provide a fallback value when the variable is unset:

```json
{
  "analytics": {
    "type": "streamable-http",
    "url": "${ANALYTICS_URL:-https://analytics.example.com/mcp}"
  }
}
```

After all transforms run, AIR validates that no unresolved `${VAR}` patterns remain (patterns with `:-default` always resolve). You can:

- Set the variables in your shell environment
- Use `${VAR:-fallback}` to provide default values for optional variables
- Use a secrets transform extension to inject them at prepare time
- Pass `--skip-validation` to `air prepare` to skip the unresolved `${VAR}` pattern check (this does not skip schema validation) — useful when your orchestrator resolves variables itself

## Transport-specific constraints

The schema enforces constraints based on transport type:

- **`stdio`**: `command` is required; `url`, `headers`, and `oauth` are not allowed
- **`sse` / `streamable-http`**: `url` is required; `command` and `args` are not allowed

Mixing these fields causes validation errors.

## How servers get wired into sessions

When you run `air start` or `air prepare`:

1. AIR resolves all MCP servers from your index files
2. If a root is active, only servers listed in `default_mcp_servers` are included (unless overridden)
3. The adapter translates the AIR format to the agent's native format (e.g., Claude Code's `.mcp.json`)
4. Transforms run on the output (e.g., secrets injection)
5. The config file is written to the target directory

For Claude Code, AIR writes a `.mcp.json` file with servers wrapped in a `mcpServers` key:

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

The `title` and `description` fields are stripped during translation (they're AIR metadata, not part of the agent's config format). The `streamable-http` type is translated to `http` for Claude Code compatibility.

### Selecting specific servers

Override which servers are activated with `air prepare`:

```bash
air prepare --mcp-servers github,postgres
```

This activates only the listed servers, ignoring root defaults.

## Listing configured servers

```bash
air list mcp
```

Output:

```
MCP Servers (3):

  github (GitHub)
    Create and manage issues, PRs, branches, and files in GitHub repos.
    Type: stdio

  postgres-prod (PostgreSQL - Production (Read-Only))
    Read-only access to the production PostgreSQL database.
    Type: stdio

  analytics (Analytics Dashboard)
    Query analytics data and generate reports from the data warehouse.
    Type: streamable-http
```

## Version pinning

Always pin exact versions for stdio servers to ensure reproducible sessions:

```json
{
  "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"]
}
```

Avoid unpinned versions like `@modelcontextprotocol/server-github` or `@latest` — different sessions could get different server versions with different behavior.

## Best practices

- **Write descriptions.** They help agents understand what each server provides and when to use it.
- **Pin versions.** Always use exact versions for reproducibility.
- **Interpolate secrets.** Never hardcode tokens or passwords. Use `${ENV_VAR}` patterns.
- **Minimize active servers.** Only activate the servers an agent actually needs. More servers means more context and complexity for the agent.
- **Scope server access.** Use read-only variants where possible (e.g., `--access-mode=restricted` for database servers).

## Next steps

- **[Running Sessions](running-sessions.md)** — See how MCP servers get activated during sessions.
- **[Extensions System](extensions.md)** — Use transforms to inject secrets or modify server configs.
- **[Composition and Overrides](composition-and-overrides.md)** — Layer org, team, and local server configs.
