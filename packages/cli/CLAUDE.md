# @pulsemcp/air-cli

The CLI for the AIR framework. A thin wrapper around `@pulsemcp/air-core` that provides `validate`, `list`, `init`, and `start` commands. Agent support comes from adapter extensions discovered at runtime.

## Folder Hierarchy

```
packages/cli/
├── src/
│   ├── index.ts              # Entry point — Commander.js program setup
│   ├── adapter-registry.ts   # Discovers installed adapter packages via dynamic import()
│   └── commands/
│       ├── validate.ts       # Validate JSON against AIR schemas
│       ├── list.ts           # List resolved artifacts
│       ├── init.ts           # Initialize ~/.air/ with empty config
│       └── start.ts          # Start an agent session (delegates to adapter)
├── tests/                    # CLI command tests (spawn process, check output)
└── package.json
```

## Domain Context

This is a Node.js CLI tool published as `@pulsemcp/air-cli` with the `air` binary. It depends on `@pulsemcp/air-core` for all config resolution and validation, and on adapter packages (e.g., `@pulsemcp/air-adapter-claude`) for agent-specific behavior.

The `start` command uses `adapter-registry.ts` to dynamically import adapter packages by convention (`@pulsemcp/air-adapter-<name>`). If the package isn't installed, the agent isn't available.

## Core Principles

### Stay thin
The CLI is glue between the terminal and core/adapters. Business logic belongs in core or extensions, not here.

### Discover, don't hard-code
Agent support comes from installed packages, not from lists in the CLI source. The only hard-coded reference is the known-adapters list in `adapter-registry.ts` for faster lookup.

## What NOT to Do

- Do not add config resolution or validation logic — that belongs in core
- Do not add agent-specific translation — that belongs in adapter extensions
- Do not hard-code agent availability checks — use dynamic import discovery
