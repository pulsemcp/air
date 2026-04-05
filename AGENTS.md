# AIR — Agent Infrastructure Repository

An open-source framework for organizing and sharing AI agent configuration. AIR defines a file-based, git-native config layer with a thin core and pluggable extensions for agent adapters and catalog providers.

## Folder Hierarchy

```
air/
├── schemas/                          # JSON Schema files (Draft 7) for all artifact types
├── examples/                         # Example air.json and artifact indexes
├── docs/                             # Documentation — concepts, CLI, orchestration, per-artifact guides
├── packages/
│   ├── core/                         # @pulsemcp/air-core — config resolution, validation, extension interfaces
│   ├── sdk/                          # @pulsemcp/air-sdk — programmatic API (adapter discovery, root detection, high-level operations)
│   ├── cli/                          # @pulsemcp/air-cli — CLI commands (validate, list, init, start, prepare)
│   └── extensions/
│       ├── adapter-claude/           # @pulsemcp/air-adapter-claude — Claude Code session setup
│       └── provider-github/          # @pulsemcp/air-provider-github — github:// URI resolution
├── package.json                      # npm workspaces root
├── tsconfig.base.json                # Shared TypeScript config
└── vitest.workspace.ts               # Workspace-level test runner
```

## Domain Context

AIR is a TypeScript monorepo (npm workspaces, ESM-only, Node 18+). It has five packages:

- **Core** owns config resolution (`resolveArtifacts`), JSON Schema validation, and the extension interfaces (`AgentAdapter`, `CatalogProvider`, `SecretResolver`). No agent-specific code.
- **SDK** is the programmatic API layer. It re-exports core and adds adapter discovery, root detection, and high-level operations (`validateFile`, `initConfig`, `listArtifacts`, `startSession`, `prepareSession`). This is the primary dependency for TypeScript/JavaScript consumers.
- **CLI** is a thin wrapper (Commander.js) that delegates all business logic to the SDK.
- **Adapter extensions** translate AIR artifacts into agent-specific formats. The Claude adapter writes `.mcp.json` and injects skills via `prepareSession()`.
- **Provider extensions** resolve remote URIs in `air.json` (e.g., `github://org/repo/path`).

Six artifact types: skills, references, MCP servers, plugins, roots, hooks. All defined as JSON indexes with JSON Schema validation. Composition happens via ordered arrays in `air.json` — later entries override earlier ones by ID (full replacement, no deep merge).

## Development

```bash
npm install                          # Install all workspace dependencies
npm run build -w packages/core       # Build core (required before other packages type-check)
npm run build -w packages/sdk        # Build SDK (required before CLI type-checks)
npx vitest run                       # Run all tests across all packages
npx tsc --noEmit -p packages/core/tsconfig.json   # Type-check a specific package
```

Core must be built before SDK, and SDK before CLI, because they import from workspace packages which resolve to `dist/`.

## Core Principles

### Core is the stable center
Schemas and the `ResolvedArtifacts` type are the contract. Changes to these are breaking changes for every consumer. Agent-specific code never goes in core.

### Extensions are the growth path
New agents, new catalog sources, new secret backends — all handled by installing extension packages. The core and CLI stay thin.

### Override semantics are simple
Later entry wins by ID, full replacement, no deep merge. This applies everywhere: `air.json` composition, `mergeArtifacts()`, and provider layering.

### prepareSession is the adapter's main job
The single entry point for setting up a working directory. Callers should not need to know about `.mcp.json` formats or skill injection paths.

## What NOT to Do

- Do not add agent-specific logic to core, SDK, or CLI — it belongs in adapter extensions
- Do not add business logic to the CLI — it belongs in the SDK
- Do not introduce deep merge semantics anywhere
- Do not make `resolveArtifacts` synchronous — it must stay async for provider support
- Do not add external CLI dependencies to provider packages — use Node built-ins (`fetch`, `fs`)
- Do not duplicate schema definitions — schemas live at repo root in `schemas/`, core copies them at build time

## FAQ / Learnings

No entries yet — this section grows from real usage.
