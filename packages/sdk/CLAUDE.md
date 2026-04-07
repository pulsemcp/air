# @pulsemcp/air-sdk

The official TypeScript SDK for the AIR framework. Provides a programmatic API for validating, resolving, preparing, and starting AIR-configured agent sessions.

## Folder Hierarchy

```
packages/sdk/
├── src/
│   ├── index.ts              # Barrel export — re-exports core + SDK operations
│   ├── adapter-registry.ts   # Discovers installed adapter packages via dynamic import()
│   ├── root-detection.ts     # Auto-detect root from git context (normalizeGitUrl, detectRoot)
│   ├── validate.ts           # validateFile() — validate a JSON file against AIR schemas
│   ├── init.ts               # initConfig() — initialize ~/.air/ config directory
│   ├── list.ts               # listArtifacts() — resolve and return artifacts by type
│   ├── start.ts              # startSession() — prepare to start an agent session
│   ├── prepare.ts            # prepareSession() — prepare a target directory for an agent
│   └── install.ts            # installExtensions() — install missing extension packages
├── tests/                    # SDK unit tests (direct function calls, not CLI spawning)
└── package.json
```

## Domain Context

This is a TypeScript library (ESM-only, Node 18+) published as `@pulsemcp/air-sdk`. It sits between `@pulsemcp/air-core` (low-level config resolution, validation, extension interfaces) and consumers like `@pulsemcp/air-cli`.

The SDK re-exports everything from core for convenience and adds high-level operations that combine core functions with adapter discovery and root detection. SDK functions return structured results and throw errors — no `process.exit()` or console output.

## Core Principles

### SDK is the public API for programmatic use
Any TypeScript/JavaScript consumer that wants to work with AIR should depend on `@pulsemcp/air-sdk`. The CLI is one such consumer.

### Return data, don't print
SDK functions return structured result objects and throw errors as exceptions. The CLI handles formatting and process lifecycle.

### Re-export core for convenience
Consumers don't need to depend on both `@pulsemcp/air-core` and `@pulsemcp/air-sdk`. The SDK re-exports all core types and functions.

## What NOT to Do

- Do not add CLI-specific formatting (chalk, console.log, process.exit) — that belongs in the CLI
- Do not add agent-specific translation logic — that belongs in adapter extensions
- Do not duplicate logic that already exists in core — re-export and compose instead
