# @pulsemcp/air-cli

CLI for the [AIR](https://github.com/pulsemcp/air) framework. Validates configs, lists artifacts, initializes new setups, and starts agent sessions.

## Installation

```bash
npm install -g @pulsemcp/air-cli
```

## Commands

```bash
# Initialize a new AIR configuration at ~/.air/
air init

# Validate a JSON file against its AIR schema
air validate ~/.air/air.json
air validate ~/.air/mcp/mcp.json

# List available artifacts
air list skills
air list mcp
air list roots

# Start an agent session
air start claude
air start claude --root web-app
air start claude --root web-app --dry-run
```

## Agent Adapters

`air start <agent>` discovers adapters dynamically. Install the adapter package for your agent:

```bash
# Claude Code (officially maintained)
npm install -g @pulsemcp/air-adapter-claude
```

The CLI looks for `@pulsemcp/air-adapter-<agent>` packages. If the package is installed, the agent is available.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AIR_CONFIG` | Override the path to `air.json` (default: `~/.air/air.json`) |
