# mcp.json Specification

A reference for the client-side `mcp.json` configuration file format consumed by
MCP-aware agents (e.g. Claude Code).

## Top-Level Shape

```jsonc
{
  "mcpServers": {
    "<server-name>": {
      "type": "stdio" | "http",
      // transport-specific fields…
    }
  }
}
```

## Stdio Transport

```jsonc
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
  }
}
```

## HTTP Transport

```jsonc
{
  "type": "http",
  "url": "https://mcp.example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${MCP_TOKEN}"
  }
}
```

## Secret Interpolation

Use `${VAR}` placeholders rather than inlining secrets. The agent's secrets
backend (env, file, vault, etc.) substitutes them at session start.

## Validation

Validate with `air validate mcp.json` to catch shape errors before the agent
loads the file.
