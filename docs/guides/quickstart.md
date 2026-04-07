# Quickstart

Get from zero to a working AIR setup in under five minutes.

## Prerequisites

- Node.js 18 or later
- npm
- An AI coding agent (e.g., [Claude Code](https://docs.anthropic.com/en/docs/claude-code))

## 1. Install the CLI

```bash
npm install -g @pulsemcp/air-cli
```

Verify the installation:

```bash
air --version
```

## 2. Initialize your configuration

```bash
air init
```

This creates the `~/.air/` directory with the following structure:

```
~/.air/
├── air.json              # Root configuration file
├── skills/
│   └── skills.json       # Skills index (empty)
├── references/
│   └── references.json   # References index (empty)
├── mcp/
│   └── mcp.json          # MCP servers index (empty)
├── plugins/
│   └── plugins.json      # Plugins index (empty)
├── roots/
│   └── roots.json        # Roots index (empty)
└── hooks/
    └── hooks.json         # Hooks index (empty)
```

## 3. Add an MCP server

Open `~/.air/mcp/mcp.json` and add a server. Here's an example with a GitHub MCP server:

```json
{
  "github": {
    "title": "GitHub",
    "description": "Create and manage issues, PRs, and repos.",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
    }
  }
}
```

## 4. Validate your configuration

Check that everything is well-formed:

```bash
air validate ~/.air/air.json
air validate ~/.air/mcp/mcp.json
```

You should see output like:

```
✓ air.json (air)
✓ mcp.json (mcp)
```

## 5. Install the agent adapter

AIR needs an adapter to translate its configuration into agent-specific formats. For Claude Code:

```bash
npm install -g @pulsemcp/air-adapter-claude
```

## 6. Preview your session

See what configuration would be activated without starting anything:

```bash
air start claude --dry-run
```

This prints the MCP servers, skills, plugins, and hooks that would be activated.

## 7. Start a session

When you're ready:

```bash
air start claude
```

This prepares the configuration and shows the command to launch Claude Code with your AIR config loaded.

## Next steps

- **[Understanding air.json](understanding-air-json.md)** — Learn how the root config file works in detail.
- **[Managing Skills](managing-skills.md)** — Add reusable skills to your configuration.
- **[Configuring MCP Servers](configuring-mcp-servers.md)** — Add more MCP servers and handle secrets.
- **[Roots and Multi-Root Setups](roots.md)** — Organize configs across multiple repositories.
