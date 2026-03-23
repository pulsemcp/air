# mcp.json — A Proposed Client-Side Configuration Format

> **Proposal** — This document describes a proposed standard for client-side MCP server configuration. It is not yet an official MCP specification. AIR adopts this format as its MCP configuration layer.

## Motivation

The MCP ecosystem has `server.json` (the [MCP Registry](https://github.com/modelcontextprotocol/registry) package specification) for describing how servers *can* be configured. But there's no standard for the other side: how a client *will* connect to its servers.

Today every MCP client invents its own format. Claude Code uses `.mcp.json` with an `mcpServers` wrapper. Other clients use different shapes. This makes it hard to share MCP server configurations across tools.

`mcp.json` is a proposal for a minimal, client-side configuration format that any MCP client can adopt.

## Relationship to server.json

| Format | Purpose | Configurability |
|--------|---------|-----------------|
| `server.json` | Server package specification for registries | Highly configurable — variables, templates, user-adjustable parameters |
| `mcp.json` | Client-side server configuration | Fully resolved — only auth secrets remain as interpolatable variables |

- `server.json` = "Here's how this server *can* be configured"
- `mcp.json` = "Here's exactly how this client *will* connect to its servers"

Each entry in an `mcp.json` is what you get *after* resolving a `server.json` template with concrete values.

## Structure

The root object is a flat map of server names to server configurations:

```json
{
  "server-name": { ... },
  "another-server": { ... }
}
```

Server names must match `^[a-zA-Z0-9_\[\]-]+$` (alphanumeric, hyphens, underscores, brackets).

## Server Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | No | Human-readable display name (max 100 chars) |
| `description` | string | No | What the server provides (max 500 chars) |
| `type` | string | **Yes** | Transport type: `"stdio"`, `"sse"`, or `"streamable-http"` |
| `command` | string | Yes (stdio) | Executable command for stdio servers |
| `args` | string[] | No (stdio) | Command-line arguments |
| `env` | object | No (stdio) | Environment variables (string values) |
| `url` | string (URI) | Yes (remote) | Endpoint URL for sse/streamable-http servers |
| `headers` | object | No (remote) | HTTP headers for remote servers (string values) |

### Transport-Specific Requirements

**stdio servers** (`type: "stdio"`):
- `command` is required
- `url` and `headers` are not allowed

**Remote servers** (`type: "sse"` or `type: "streamable-http"`):
- `url` is required
- `command` and `args` are not allowed

## Transport Types

### stdio — Local Process

Runs a local process that communicates via stdin/stdout:

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

### streamable-http — HTTP Streaming

For remote servers using HTTP streaming:

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

## Environment Variable Interpolation

All string values support `${ENV_VAR}` interpolation. The MCP client resolves these at runtime from the user's environment.

| Pattern | Description |
|---------|-------------|
| `${VAR}` | Replaced with the value of environment variable `VAR` |
| `${VAR:-default}` | Uses `VAR` if set, otherwise falls back to `default` |

Interpolation is primarily intended for authentication secrets:
- API keys: `"${OPENAI_API_KEY}"`
- Bearer tokens: `"Bearer ${AUTH_TOKEN}"`
- Database credentials: `"postgresql://${PG_USER}:${PG_PASS}@host/db"`

Non-secret values should use literals. The file is meant to be a fully-formed configuration — using interpolation for non-secrets undermines that purpose.

### OAuth-Based Servers

Servers using OAuth handle authentication out-of-band via the MCP client. OAuth endpoints are discovered automatically via well-known metadata endpoints (RFC 8414, RFC 9728). No explicit OAuth configuration is needed:

```json
{
  "linear": {
    "title": "Linear",
    "type": "streamable-http",
    "url": "https://mcp.linear.app/mcp"
  }
}
```

## Version Pinning

**Always pin packages to specific versions:**

- **npm**: `@scope/package@0.6.2` (not `@latest` or `@^1.0.0`)
- **PyPI**: `package==0.5.0` (not `package` or `package>=0.5`)
- **OCI**: `image:1.0.2` (not `image:latest`)

Unpinned versions cause non-deterministic behavior and make debugging difficult.

## Relationship to Claude Code

Claude Code uses a similar but distinct `.mcp.json` format:

| mcp.json (this proposal) | Claude Code `.mcp.json` |
|--------------------------|------------------------|
| Servers at root level | Servers nested under `mcpServers` key |
| `type` field required | `type` optional (defaults to stdio) |

**This proposal:**
```json
{
  "github": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"]
  }
}
```

**Claude Code format:**
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"]
    }
  }
}
```

AIR translates between these formats at session start time. See [MCP Servers](mcp-servers.md) for details on the translation layer.

## Complete Example

```json
{
  "github": {
    "title": "GitHub Integration",
    "description": "GitHub API integration for repository management",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
    }
  },
  "postgres-prod": {
    "title": "PostgreSQL - Production (Read-Only)",
    "description": "Read-only access to the production database",
    "type": "stdio",
    "command": "uvx",
    "args": ["--from", "postgres-mcp==0.3.0", "postgres-mcp", "--access-mode=restricted"],
    "env": {
      "DATABASE_URI": "postgresql://${PG_USER}:${PG_PASS}@db.example.com:5432/prod?sslmode=require"
    }
  },
  "internal-api": {
    "title": "Internal API",
    "description": "Connection to internal services",
    "type": "streamable-http",
    "url": "https://internal.example.com/mcp",
    "headers": {
      "Authorization": "Bearer ${INTERNAL_API_KEY}"
    }
  },
  "linear": {
    "title": "Linear",
    "description": "Linear project management (OAuth)",
    "type": "streamable-http",
    "url": "https://mcp.linear.app/mcp"
  }
}
```

## JSON Schema

The formal JSON Schema for validation is at [`schemas/mcp.schema.json`](../schemas/mcp.schema.json).

```bash
# Validate with the AIR CLI
air validate mcp/mcp.json

# Validate with ajv-cli
npx ajv-cli validate -s schemas/mcp.schema.json -d mcp/mcp.json --spec=draft7 --strict=false
```
