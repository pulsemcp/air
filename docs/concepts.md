# Core Concepts

AIR organizes AI agent configuration into composable, version-controlled artifacts. This document covers the architecture, design principles, and composition model.

## Architecture Overview

AIR is built around a simple idea: **agent configurations should be treated like code** — version-controlled, reviewed, composable, and shareable.

### The Artifact Model

Every piece of agent configuration in AIR is an **artifact** with:

1. **An index entry** — ID, description, and location reference in a JSON index file
2. **A JSON schema** — for validation and editor autocomplete
3. **Content** — the actual configuration or document (SKILL.md, reference doc, MCP config, etc.)

The index files act as lightweight registries. Agents use the ID and description to decide what they need, then progressively load the full content on demand.

### Artifact Types

| Type | Index File | Content | Schema |
|------|-----------|---------|--------|
| Skills | `skills/skills.json` | `SKILL.md` files in directories | `schemas/skills.schema.json` |
| References | `references/references.json` | Markdown documents | `schemas/references.schema.json` |
| MCP Servers | `mcp/mcp.json` | Inline server configs | `schemas/mcp.schema.json` |
| Plugins | `plugins/plugins.json` | Named groupings of skills, MCP servers, hooks (composable with other plugins) | `schemas/plugins.schema.json` |
| Roots | `roots/roots.json` | Agent workspaces (repos with AGENTS.md) | `schemas/roots.schema.json` |
| Hooks | `hooks/hooks.json` | Hook directories (HOOK.json + scripts) | `schemas/hooks.schema.json` |

### The Root Config

`air.json` lives at `~/.air/air.json` (user-level). Each artifact property is an array of paths to index files. Every artifact is identified by `@scope/id`, where local entries contribute under `@local/` and remote catalogs use a provider-derived scope (e.g. `@<owner>/<repo>/`). Composition is additive — duplicate qualified IDs hard-fail, and the only way to drop an artifact is `exclude`:

```json
{
  "name": "my-team",
  "description": "My team's agent configs",
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

All paths are relative to the `air.json` file. You only need to include the artifact types you use.

## Composition Model

Composition is expressed directly in `air.json`. Every artifact has a qualified identity of the form `@scope/id`. Local indexes contribute under `@local/`; remote catalogs contribute under their provider-derived scope (for `github://owner/repo` that's `@<owner>/<repo>/`).

### How Layering Works

For each artifact type:

1. **Disjoint qualified IDs** accumulate (additive union)
2. **Duplicate qualified IDs** hard-fail — you cannot silently override an artifact
3. **Cross-scope shortname collisions** warn but keep both — disambiguate with the qualified form
4. **`exclude`** is the only way to drop an artifact (takes a list of qualified IDs)

### Example

```json
{
  "name": "frontend-team",
  "catalogs": [
    "github://acme/air-org",
    "github://acme/air-frontend"
  ],
  "mcp": ["./mcp/mcp.json"],
  "exclude": ["@acme/air-org/legacy-server"]
}
```

- **Org catalog** ships under `@acme/air-org/...`
- **Frontend team catalog** ships under `@acme/air-frontend/...`
- **Local `mcp.json`** ships under `@local/...`
- `exclude` drops `@acme/air-org/legacy-server`. To replace an upstream artifact, exclude it and ship a replacement under your own scope.

## Design Principles

### 1. Open Standards First

AIR orients around open standards like MCP, Agent Skills, and Plugins. The agentic ecosystem will constantly evolve, but agreed-upon standards and interfaces will be the deterministic mainstays that the ecosystem builds on top of. Everything else is just custom glue. When a well-adopted standard exists for something, use it rather than inventing your own.

### 2. Everything in Git

All configuration is stored in git repositories. No databases, no proprietary backends, no SaaS dependencies. You can read, diff, review, and revert everything with standard git tools.

### 3. Maximally DRY

Every piece of knowledge should have a single canonical location:

- **References** are broken out of skills so multiple skills can share them
- **MCP server configs** are defined once and referenced by ID from roots
- **Skills** compose references rather than embedding knowledge inline

If you find yourself duplicating content, that's a signal to extract it into a reusable artifact. Plugins can also compose other plugins — a "full-stack" plugin can include "code-quality" and "database-tools" plugins rather than re-listing all their primitives. See [Plugins](plugins.md#plugin-composition) for details.

### 4. Per-Session Configuration

AIR targets **single-session** configuration, not per-user or per-project. The distinction matters:

- **Per-user configs** drift between users and don't compose
- **Per-project configs** duplicate across projects and aren't appropriate for every session
- **Per-session configs** are assembled from composable layers at session start time

Each `air start` or `air prepare` call sets up exactly one agent session in one working directory. AIR does not coordinate multiple sessions, manage parallelism, or orchestrate agents — those are concerns for a separate orchestration layer. See [Orchestration](orchestration.md) for what belongs where.

### 5. Progressive Disclosure

Index files contain just enough information (ID + description) for an agent to decide relevance. Full content is loaded only when needed. This keeps session startup fast and lets agents be selective about what they load.

### 6. Agent Agnosticism

AIR defines artifacts in agent-agnostic formats. Translation to agent-specific formats (Claude Code `.mcp.json`, OpenCode configs, etc.) happens at session start time. This means you can switch agents without rewriting your configs.

## Scoping Artifacts

When writing artifact descriptions, be explicit about scope:

- **Org-level**: "Company-wide code review process" — anyone in the org should understand this
- **Team-level**: "Frontend team deployment checklist" — scoped to the team
- **Project-level**: "API rate limiting configuration" — scoped to a specific project

The description is what agents (and humans) use to decide relevance. Make it count.

## What AIR Is Not

AIR is a **single-session configuration layer** — it resolves, validates, and translates config for one agent session at a time. It does not orchestrate multiple sessions, coordinate agents, persist state, or handle secrets.

If you need to run multiple agent sessions (sequential pipelines, delegated subagents, event-triggered sessions), you need a separate orchestration layer. AIR is the config foundation underneath it. See [Orchestration & Multi-Agent Patterns](orchestration.md) for guidance on what belongs where.
