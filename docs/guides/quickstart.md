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

When run inside a git repo that contains AIR artifact index files (skills.json, mcp.json, etc.), `air init` **discovers them automatically**, detects the GitHub remote and default branch, and generates an `air.json` with `github://` resolver URIs. This is the fastest way to get started with an existing repo.

When no artifacts are found (or you're not in a git repo), it falls back to creating a blank scaffolding:

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

Options:
- `--force` — overwrite an existing `air.json`
- `--path <path>` — write the config to a custom location instead of `~/.air/air.json`

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
✓ ~/.air/air.json is valid (schema: air)
✓ ~/.air/mcp/mcp.json is valid (schema: mcp)
```

## 5. Add extensions

AIR uses extensions for agent adapters and remote providers. Add the ones you need to the `extensions` array in `air.json`:

```json
{
  "name": "my-config",
  "extensions": [
    "@pulsemcp/air-adapter-claude",
    "@pulsemcp/air-provider-github"
  ],
  "skills": ["./skills/skills.json"],
  "mcp": ["./mcp/mcp.json"]
}
```

- **`@pulsemcp/air-adapter-claude`** — translates AIR config into Claude Code's format (`.mcp.json`, skills)
- **`@pulsemcp/air-provider-github`** — resolves `github://` URIs so you can share config across repos

Then install them:

```bash
air install
```

This reads the `extensions` array and installs any missing npm packages. See [Installing Extensions](extensions/installing.md) for details.

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
- **[Managing Skills](skills/readme.md)** — Add reusable skills to your configuration.
- **[Configuring MCP Servers](mcp-servers/readme.md)** — Add more MCP servers and handle secrets.
- **[Roots and Multi-Root Setups](roots/readme.md)** — Organize configs across multiple repositories.
