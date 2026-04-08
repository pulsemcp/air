# AIR CLI Guides

Practical, task-oriented guides for getting productive with the AIR CLI.

For detailed reference documentation, see the [docs/](../) directory.

## Getting Started

- **[Quickstart](quickstart.md)** — Install the CLI, create your first configuration, and run a session in under five minutes.
- **[Understanding air.json](understanding-air-json.md)** — Deep dive into the root configuration file: structure, fields, composition, and common mistakes.

## Common Workflows

- **[Managing Skills](skills/readme.md)** — Define reusable skills, list them, and understand how they get injected into agent sessions.
- **[Configuring MCP Servers](mcp-servers/readme.md)** — Define MCP server entries for local and remote servers, wire them into sessions, and handle secrets.
- **[Running Sessions](running-sessions.md)** — Use `air start` and `air prepare` to launch agent sessions with the right configuration.
- **[Validating Configuration](validating-configuration.md)** — Catch config errors early with `air validate` before they cause runtime failures.
- **[Installing Extensions](extensions/installing.md)** — Use `air install` to add adapters, providers, and transforms declared in your configuration.

## Advanced Usage

- **[Extensions System](extensions/readme.md)** — How adapter, provider, and transform extensions work. Install, configure, and build on the extension pipeline.
- **[Roots and Multi-Root Setups](roots/readme.md)** — Organize agent configurations across repositories and teams with roots.
- **[Hooks](hooks/readme.md)** — Automate actions around agent lifecycle events with shell-command hooks.
- **[References](references/readme.md)** — Share reference documents across skills to keep documentation DRY.
- **[Composition and Overrides](composition-and-overrides.md)** — Layer multiple config files, use override semantics, and pull remote configs with providers.
