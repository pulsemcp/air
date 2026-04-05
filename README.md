# AIR — AI Artifact Catalog Framework

> **Experimental** — This framework is under active development and not yet fit for production usage. APIs, schemas, and conventions may change without notice. We welcome early feedback and contributions.

AIR is an open source framework based exclusively on open standards (and emerging standards) that enables org/team collaboration on AI-related artifacts that empower their autonomous agents. Designed for engineering teams, extensible to any knowledge work.

## Why AIR?

As teams adopt agents, they inevitably accumulate configuration: MCP server definitions, reusable skills, coding conventions, environment setups. Without structure, this configuration drifts, duplicates, and becomes impossible to share.

AIR solves this by:

- **Orienting around open standards** — Agent Skills, MCP, Plugins, and more to come. The agentic ecosystem will constantly evolve, but agreed-upon standards and interfaces will be the deterministic mainstays that the ecosystem builds on top of. Everything else is just custom glue.
- **Keeping everything in git** — All configuration is version-controlled, reviewable, and composable. No proprietary backends.
- **Being maximally DRY** — No copy/pasting, drift, or unclear ownership. If someone in your org does the work once and catalogs it properly, nobody ever has to touch it again.
- **Per-agent-session configs** — Not per-user or per-project (those don't scale). Each session assembles exactly what it needs from composable layers.
- **Working with any coding agent** — AIR is a common layer across the ecosystem of opinionated agent implementations. Start with one agent, switch later to the newest frontier implementation without undoing your organization's work.

## Standards Maturity

AIR endorses and builds on these standards and patterns. Their maturity reflects how broadly adopted and stable they are across the ecosystem:

| Standard | Adoption | How We Think About It |
|----------|----------|-------------|
| **Agent Skills** | High | Reusable, invocable units of work defined as structured Markdown (SKILL.md) and associated files. Skills represent internal (often proprietary) knowledge or processes where foundation models cannot be trained or have been proven to underperform. |
| **MCP** | High | Open protocol for connecting AI agents to wholly or partially deterministic tools and data sources. Handles auth and access boundaries. |
| **References** | Medium | Shared knowledge documents attached to skills. Broken out separately to stay DRY — one reference can serve many skills. |
| **Plugins** | Medium | Named groupings of AIR primitives (skills, MCP servers, hooks) for bundling and distribution. Plugins reference existing artifacts by ID — a compositional layer, not a separate artifact format. Users can always "eject" and work at the primitive level. Modeled after the [Open Plugins spec](https://open-plugins.com/plugin-builders/specification) and Claude Code Plugins with translation layers for other agents. |
| **Hooks** | Medium | Shell commands triggered at agent lifecycle events (session start, pre-commit, etc.). |
| **Roots** | Medium | Self-contained agent workspaces — a git repo (or subdirectory) with a file hierarchy (including AGENTS.md files) an agent needs for a specific project. |
| **Rules** | Emerging | Persistent AI guidance files (`.mdc` — Markdown with YAML frontmatter) that remain in context throughout a session. Optionally scoped by file glob patterns. Distinct from skills (on-demand activation) and CLAUDE.md/AGENTS.md (unstructured, per-root). Originated by Cursor, formalized by the Open Plugins spec. Not yet supported in AIR — planned for a future release. |

Note: CLI tools are themselves not a standard. While you can shoehorn them inside a Skill or MCP server in a pinch, they provide no scalable path to managing auth and access boundaries and no ecosystem investment in future enrichments. 

## Coding Agent Support

AIR generates agent-specific configuration at session start time via **adapter extensions**. Install the adapter for your agent:

| Agent | Adapter Package | Status |
|-------|----------------|--------|
| **Claude Code** | `@pulsemcp/air-adapter-claude` | Officially maintained |
| **OpenCode** | `@pulsemcp/air-adapter-opencode` | Community / planned |
| **Cursor** | `@pulsemcp/air-adapter-cursor` | Community / planned |

To add support for a new agent, publish an adapter package implementing the `AgentAdapter` interface from `@pulsemcp/air-core`.

## Core Concepts

AIR organizes agent configuration into **artifact types**, each with its own index file and JSON schema:

```
~/.air/                           # User-level AIR configuration
├── air.json                      # Root config — points to all artifact indexes
├── skills/
│   ├── skills.json               # Skills index
│   ├── deploy-staging/
│   │   └── SKILL.md
│   └── pr-review/
│       └── SKILL.md
├── references/
│   ├── references.json           # Shared reference documents index
│   ├── GIT_WORKFLOW.md
│   └── CODE_STANDARDS.md
├── mcp/
│   └── mcp.json                  # MCP server configurations
├── plugins/
│   └── plugins.json              # Agent plugins index
├── roots/
│   └── roots.json                # Agent root workspaces index
└── hooks/
    └── hooks.json                # Lifecycle hooks index
```

Orgs and teams provide default `air.json` files as starting points. Users keep their own at `~/.air/air.json`, pointing to a mix of org-provided and local artifact files.

### air.json — The Root Config

Every AIR configuration starts with an `air.json` file. Each artifact property is an array of paths to index files. Files are loaded and merged in order — later entries override earlier ones by ID:

```json
{
  "name": "acme-engineering",
  "description": "Acme Corp engineering team agent configs",
  "skills": [
    "github://acme/air-org/skills/skills.json",
    "./skills/skills.json"
  ],
  "mcp": [
    "github://acme/air-org/mcp/mcp.json",
    "./mcp/mcp.json"
  ]
}
```

### Composition & Layering

Composition is expressed directly in `air.json`. List multiple sources per artifact type — org-wide configs first, then team or project overrides:

```json
{
  "name": "frontend-team",
  "mcp": [
    "github://acme/air-org/mcp/mcp.json",
    "github://acme/air-frontend/mcp/mcp.json",
    "./mcp/mcp.json"
  ]
}
```

IDs that match override; new IDs are additive. The last file wins for any given ID. No separate config file is needed — `air.json` is the single composition point.

### Skills & References

**Skills** are reusable, invocable units of work defined as structured Markdown (SKILL.md) and associated files. They represent internal (often proprietary) knowledge or processes where foundation models cannot be trained or have been proven to underperform.

**References** are shared knowledge documents that skills depend on. By breaking references out of skills into their own index, you keep things DRY — one reference about your git workflow can be used by your deploy skill, your PR review skill, and your release skill.

```json
// skills.json
{
  "deploy-staging": {
    "id": "deploy-staging",
    "description": "Deploy the current PR branch to staging",
    "path": "skills/deploy-staging",
    "references": ["git-workflow", "staging-env"]
  }
}

// references.json
{
  "git-workflow": {
    "id": "git-workflow",
    "description": "Git branching, naming, and PR conventions",
    "file": "references/GIT_WORKFLOW.md"
  }
}
```

### MCP Servers

MCP is the open protocol for connecting AI agents to wholly or partially deterministic tools and data sources. It handles auth and access boundaries. AIR uses the [mcp.json format](docs/mcp-json-proposal.md) for MCP server configuration — a flat map of server names to fully-resolved connection configs:

```json
{
  "github": {
    "title": "GitHub",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
    }
  }
}
```

Three transport types are supported: `stdio` (local processes), `sse` (Server-Sent Events), and `streamable-http` (HTTP streaming).

### Plugins

Plugins are named groupings of AIR primitives (skills, MCP servers, hooks) — a compositional unit for bundling and distributing related capabilities. They provide a more tractable layer of abstraction for distribution and sharing; users who want finer-grained control can always "eject" and work directly at the more primitive skills/mcp/hooks layer. Both approaches are fully supported.

A plugin entry in `plugins.json` declares which AIR artifacts it bundles by referencing their IDs. This lets the CLI deduplicate at prepare time — if you request both a skill and a plugin that already bundles that skill, only the plugin needs to be activated:

```json
{
  "code-quality": {
    "id": "code-quality",
    "title": "Code Quality Suite",
    "description": "Linting, formatting, and static analysis tools bundled with coding standards skills",
    "version": "1.2.0",
    "skills": ["lint-fix", "format-check"],
    "mcp_servers": ["eslint-server"],
    "hooks": ["lint-pre-commit"],
    "author": { "name": "Acme Engineering" },
    "license": "MIT",
    "keywords": ["linting", "formatting", "eslint", "prettier"]
  }
}
```

### Roots

Roots are self-contained agent workspaces — a git repo (or subdirectory) with a file hierarchy (including AGENTS.md files) an agent needs for a specific project. Each root declares its default MCP servers, skills, plugins, and hooks:

```json
{
  "web-app": {
    "name": "web-app",
    "display_name": "Web Application",
    "description": "Main web app — Rails backend, React frontend",
    "url": "https://github.com/acme/web-app.git",
    "default_mcp_servers": ["github", "postgres-prod"],
    "default_skills": ["deploy-staging", "pr-review"],
    "user_invocable": true
  }
}
```

### Hooks

Hooks are shell commands that fire at agent lifecycle events. Use them for notifications, guardrails, or automation:

```json
{
  "lint-pre-commit": {
    "id": "lint-pre-commit",
    "description": "Run linting before commits",
    "event": "pre_commit",
    "command": "npx",
    "args": ["lint-staged"]
  }
}
```

## Scope

AIR is a **configuration layer** — it resolves, validates, and translates agent configs. It is not an orchestration platform.

| AIR handles | Orchestration platforms handle |
|-------------|-------------------------------|
| Config resolution & composition | Session persistence & status tracking |
| JSON Schema validation | Subagent invocation & coordination |
| Agent-specific translation | Job queuing, retries, scheduling |
| Single-session setup via `air start` | Secret management & credential vaults |
| `${ENV_VAR}` interpolation in configs | Git clone lifecycle & working directories |
| | Monitoring, cost tracking, dashboards |

Teams building multi-agent systems use AIR as the config layer underneath their orchestration platform. See [Orchestration](docs/orchestration.md) for patterns and guidance.

## Quickstart

### 1. Install the CLI

```bash
npm install -g @pulsemcp/air-cli
```

### 2. Initialize a configuration

```bash
air init
```

This creates `~/.air/air.json` and artifact subdirectories with empty index files.

### 3. Validate your configuration

```bash
air validate ~/.air/air.json
air validate ~/.air/mcp/mcp.json
air validate ~/.air/skills/skills.json
```

### 4. Start an agent session

```bash
# Start Claude Code with your AIR configuration
air start claude

# Start with a specific root
air start claude --root web-app

# Dry run — see what would be activated
air start claude --root web-app --dry-run
```

## CLI Reference

See [docs/cli.md](docs/cli.md) for the full CLI reference. Key commands:

| Command | Description |
|---------|-------------|
| `air init` | Initialize a new AIR configuration at `~/.air/` |
| `air validate <file>` | Validate a JSON file against its AIR schema |
| `air start <agent>` | Start an agent session with AIR configs loaded |
| `air list <type>` | List available artifacts (skills, mcp, plugins, roots, hooks) |

## Documentation

| Document | Description |
|----------|-------------|
| [Core Concepts](docs/concepts.md) | Architecture, design principles, and composition model |
| [Skills](docs/skills.md) | How to write and manage skills |
| [References](docs/references.md) | Shared knowledge documents |
| [MCP Servers](docs/mcp-servers.md) | MCP server configuration |
| [mcp.json Proposal](docs/mcp-json-proposal.md) | Proposed client-side MCP configuration format |
| [Plugins](docs/plugins.md) | Agent plugins and translation layers |
| [Roots](docs/roots.md) | Agent root workspaces |
| [Hooks](docs/hooks.md) | Lifecycle hooks |
| [CLI](docs/cli.md) | Full CLI reference |
| [Configuration](docs/configuration.md) | Configuration loading, composition, and layering |
| [Orchestration](docs/orchestration.md) | Scope boundaries, multi-agent patterns, and building on top of AIR |

## Schema Validation

All AIR JSON files can be validated against their schemas:

```bash
# Using the AIR CLI
air validate ~/.air/air.json
air validate ~/.air/mcp/mcp.json

# Using ajv-cli directly
npx ajv-cli validate -s schemas/air.schema.json -d ~/.air/air.json --spec=draft7 --strict=false
```

Schemas are in the [`schemas/`](schemas/) directory. Point your editor's JSON schema support at them for autocomplete and inline validation.

## Design Principles

1. **Open standards are the building blocks.** Ecosystems build deterministic layers around open standards. Orient around them.
2. **Bias towards git and files.** All data lives in git repos. Use open-source tooling or roll your own.
3. **Maximally DRY.** Don't duplicate anything that semantically represents the same thing. Compose, don't copy.
4. **Per-agent-session configs.** Per-user and per-project configs don't scale — they drift. Compose what each session needs from reusable layers.
5. **Carefully collaborate.** Treat shared configs like software other people use. Make scope crystal clear. If it's org-level, anyone in the org should understand the description.
6. **Build for everyone.** AI agents aren't just for engineers — engineers are the early adopters. Don't build infrastructure only engineers can use.
7. **Fork and make it your own.** Teams are encouraged to fork this framework and adapt it. The patterns matter more than the specific implementation.

## Architecture: Core + Extensions

AIR is structured as a monorepo with a thin core and pluggable extensions:

```
air/
├── schemas/                          # JSON Schema files for all artifact types
├── examples/                         # Example configurations
├── docs/                             # Documentation
├── packages/
│   ├── core/                         # @pulsemcp/air-core
│   │   └── Config resolution, validation, schemas, extension interfaces
│   ├── cli/                          # @pulsemcp/air-cli
│   │   └── CLI commands (validate, list, init, start)
│   └── extensions/
│       ├── adapter-claude/           # @pulsemcp/air-adapter-claude
│       │   └── Translates AIR config → Claude Code format
│       └── provider-github/          # @pulsemcp/air-provider-github
│           └── Resolves github:// URIs in air.json
```

### Extension Points

The core defines four extension interfaces:

| Extension Point | Interface | Built-in | Official Extensions |
|----------------|-----------|----------|-------------------|
| **Catalog Providers** | `CatalogProvider` | Local filesystem | `@pulsemcp/air-provider-github` |
| **Agent Adapters** | `AgentAdapter` | None | `@pulsemcp/air-adapter-claude` |
| **Secret Resolvers** | `SecretResolver` | `process.env` | None yet |
| **Transports** | Consume SDK | CLI | None yet |

Community extensions follow the `@pulsemcp/air-adapter-*` and `@pulsemcp/air-provider-*` naming convention.

### Packages

| Package | Description |
|---------|------------|
| `@pulsemcp/air-core` | Config resolution, validation, schemas, and extension interfaces. No agent-specific code. |
| `@pulsemcp/air-cli` | CLI wrapper. Discovers installed adapters for `air start`. |
| `@pulsemcp/air-adapter-claude` | Claude Code adapter. Translates MCP servers, plugins, skills to Claude format. |
| `@pulsemcp/air-provider-github` | GitHub catalog provider. Fetches remote artifact indexes via the GitHub REST API. |

## Contributing

This project is in its early experimental phase. We welcome issues, discussions, and pull requests. Please read the documentation thoroughly before contributing.

### Development

```bash
# Install all dependencies
npm install

# Build core (required before other packages can type-check)
npm run build -w packages/core

# Run all tests
npx vitest run

# Type-check a specific package
npx tsc --noEmit -p packages/core/tsconfig.json
```

## License

MIT
