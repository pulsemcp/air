# @pulsemcp/air-core

The core package for the AIR framework. Handles config resolution, JSON Schema validation, and defines the extension interfaces that all other AIR packages build on. Contains zero agent-specific code.

## Folder Hierarchy

```
packages/core/
├── src/
│   ├── index.ts       # Barrel export — the public API surface
│   ├── types.ts       # All artifact types + extension interfaces (AgentAdapter, CatalogProvider, SecretResolver)
│   ├── config.ts      # Config loading, merging, and resolution with CatalogProvider injection
│   ├── validator.ts   # AJV-based JSON Schema validation
│   └── schemas.ts     # Schema loading and detection utilities
├── tests/             # Vitest tests — config, validation, schemas, composition
├── schemas/           # Copied from repo root at build time (not checked in)
└── package.json
```

## Domain Context

This is a TypeScript library (ESM-only, Node 18+) published as `@pulsemcp/air-core`. It is the foundation of a monorepo — the CLI, agent adapters, and catalog providers all depend on it.

The key function is `resolveArtifacts(airJsonPath, options?)` which loads an `air.json` file, merges all referenced artifact indexes in order, and returns a `ResolvedArtifacts` object. It is async because remote URIs are delegated to `CatalogProvider` extensions.

## Core Principles

### The format IS the contract
Other packages (including non-TypeScript consumers like Ruby apps) read AIR JSON files directly. Changes to the JSON schema or the structure of `ResolvedArtifacts` are breaking changes for the entire ecosystem.

### No agent-specific code
Core must never import or reference any specific agent (Claude, OpenCode, Cursor). Agent-specific logic belongs in adapter extensions.

### Local filesystem is built-in, everything else is a provider
`resolveArtifacts` handles local paths natively. Remote URI schemes (`github://`, `s3://`) are delegated to `CatalogProvider` extensions — core throws if no provider matches.

## What NOT to Do

- Do not add agent-specific translation logic (MCP format conversion, skill injection paths, etc.)
- Do not add deep merge semantics — override is always full replacement by ID
- Do not make `resolveArtifacts` synchronous again — it must remain async for provider support
