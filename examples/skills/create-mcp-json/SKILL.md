---
name: create-mcp-json
description: Generate an mcp.json configuration file for a project based on its MCP server needs
---

# Create MCP Config

Generate a project-local `mcp.json` that lists the MCP servers the project needs,
in the shape documented in the `mcp-json-spec` reference.

## Steps

1. Identify which capabilities the project needs (filesystem, git, DB, etc.).
2. For each capability, pick the appropriate MCP server package or transport.
3. Fill in `command`, `args`, and `env` (or `url`/`headers` for HTTP transports).
4. Reference secrets with `${VAR}` placeholders rather than inlining them.
5. Validate the file with `air validate mcp.json` before committing it.
