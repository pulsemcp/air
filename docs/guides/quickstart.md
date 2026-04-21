# Quickstart

Get from zero to a working AIR setup in under five minutes.

## Prerequisites

- Node.js 18 or later
- npm
- An AI coding agent (e.g., [Claude Code](https://docs.anthropic.com/en/docs/claude-code))
- **A repository (recommended).** `air init` works best when run inside a git repo that already has artifact index files (e.g., `skills/skills.json`, `mcp/mcp.json`) — it discovers them automatically and wires them into the generated `air.json` alongside the always-present local index files. Without pre-existing artifacts, you still get the local scaffold and populate it manually. See [examples/air.json](../../examples/air.json) for the expected format and [artifact types](../concepts.md#artifact-types) for what kinds of artifacts you can define.

## How AIR manages configuration

AIR uses **per-session configuration**. Every time you start a session, AIR assembles the active configuration from your `air.json` and its referenced index files — nothing is persisted into the agent's own user-level config.

This means you should **disable or remove any user-scoped agent configuration** you may already have (e.g., user-level MCP servers such as Claude Code's `~/.claude/.mcp.json`, or global tool settings). If left in place, user-level config will be active alongside AIR-managed config, which leads to duplication, conflicts, and config that isn't version-controlled or shared with your team. To migrate, move your existing server definitions into an AIR MCP index file (see [Configuring MCP Servers](configuring-mcp-servers.md)), then remove the user-level config. The goal is for `air.json` and its artifact indexes to be the single source of truth for every session.

See [Per-Session Configuration](../concepts.md#4-per-session-configuration) in the design principles for more detail.

## 1. Install the CLI

```bash
npm install -g @pulsemcp/air-cli
```

Verify the installation:

```bash
air --version
```

### Upgrading

To upgrade the CLI to the latest version:

```bash
air upgrade
```

This runs `npm install -g @pulsemcp/air-cli@latest` under the hood. If you're already on the latest version, it reports that and exits without reinstalling.

Use `--dry-run` to see what would happen without actually installing:

```bash
air upgrade --dry-run
```

## 2. Initialize your configuration

```bash
air init
```

`air init` always scaffolds a ready-to-edit local workspace at `~/.air/`, and — when you run it inside a git repo that contains AIR artifact index files (skills.json, mcp.json, etc.) — it also **discovers them automatically**, detects the GitHub remote and default branch, and wires `github://` resolver URIs for each discovered type into the generated `air.json`. Local index files are always present alongside any discovered remote catalog, so you can layer personal or workspace-local entries on top without editing `air.json` first. The generated `air.json` includes all officially maintained extensions by default, giving you a batteries-included setup.

The resulting `~/.air/` directory always looks like this:

```
~/.air/
├── air.json                     # composition surface — references the indexes below, plus any discovered github:// catalog
├── README.md                    # orientation doc with worked examples per type
├── skills/skills.json           # { "$schema": "…/skills.schema.json" }
├── references/references.json   # { "$schema": "…/references.schema.json" }
├── mcp/mcp.json                 # { "$schema": "…/mcp.schema.json" }
├── plugins/plugins.json         # { "$schema": "…/plugins.schema.json" }
├── roots/roots.json             # { "$schema": "…/roots.schema.json" }
└── hooks/hooks.json             # { "$schema": "…/hooks.schema.json" }
```

Each index file ships with a `$schema` reference, so editors like VS Code and JetBrains give you autocomplete and inline validation as you add entries. Open the directory in your editor and start typing — `README.md` has a worked example for every artifact type. When a github:// catalog is discovered, `air.json` lists the remote URI first and your local index file second; since later entries win by ID, anything you add locally overrides the shared catalog.

**Re-running `air init`** is safe. If `~/.air/air.json` already exists, the command runs in **top-up mode**: it leaves your existing `air.json` untouched and only creates the scaffold pieces that are missing. This lets users who initialized on an older version fill in newer scaffold files without losing their configuration. Pass `--force` to regenerate `air.json` from scratch.

Options:
- `--force` — overwrite an existing `air.json` (skips top-up mode)
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

## 5. Install extensions

When run from a git repo, `air init` automatically includes all officially maintained extensions in the generated `air.json`:

```json
{
  "extensions": [
    "@pulsemcp/air-adapter-claude",
    "@pulsemcp/air-provider-github",
    "@pulsemcp/air-secrets-env",
    "@pulsemcp/air-secrets-file"
  ]
}
```

- **`@pulsemcp/air-adapter-claude`** — translates AIR config into Claude Code's format (`.mcp.json`, skills)
- **`@pulsemcp/air-provider-github`** — resolves `github://` URIs so you can share config across repos
- **`@pulsemcp/air-secrets-env`** — resolves `${VAR}` patterns from environment variables
- **`@pulsemcp/air-secrets-file`** — resolves `${VAR}` patterns from a JSON secrets file

Install them:

```bash
air install
```

This reads the `extensions` array and installs any missing npm packages. See [Installing Extensions](installing-extensions.md) for details.

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
