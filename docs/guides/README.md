# AIR CLI Guides

Practical, task-oriented guides for getting productive with the AIR CLI.

For detailed reference documentation, see the [docs/](../) directory.

## Getting Started

- **[Quickstart](quickstart.md)** — Install the CLI, create your first configuration, and run a session in under five minutes.
- **[Understanding air.json](understanding-air-json.md)** — Deep dive into the root configuration file: structure, fields, composition, and common mistakes.

## Common Workflows

- **[Managing Skills](managing-skills.md)** — Define reusable skills, list them, and understand how they get injected into agent sessions.
- **[Managing Skills in Your Repo](managing-skills-in-your-repo.md)** — Patterns for committing AIR configs into a repo (`.claude/skills/`, in-repo indexes, team catalogs) and how auto-discovery wires them into your `air.json`.
- **[Configuring MCP Servers](configuring-mcp-servers.md)** — Define MCP server entries for local and remote servers, wire them into sessions, and handle secrets.
- **[Running Sessions](running-sessions.md)** — Use `air start` and `air prepare` to launch agent sessions with the right configuration.
- **[Validating Configuration](validating-configuration.md)** — Catch config errors early with `air validate` before they cause runtime failures.
- **[Installing Extensions](installing-extensions.md)** — Use `air install` to add adapters, providers, and transforms declared in your configuration.

## Advanced Usage

- **[Extensions System](extensions.md)** — How adapter, provider, and transform extensions work. Install, configure, and build on the extension pipeline.
- **[Roots and Multi-Root Setups](roots.md)** — Organize agent configurations across repositories and teams with roots.
- **[Hooks](hooks.md)** — Automate actions around agent lifecycle events with shell-command hooks.
- **[References](references.md)** — Share reference documents across skills to keep documentation DRY.
- **[Composition and Overrides](composition-and-overrides.md)** — Layer multiple catalogs and per-type indexes with scoped identity, additive composition, and `exclude`-based removal.
