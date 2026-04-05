# @pulsemcp/air-cli

The CLI for the AIR framework. A thin wrapper around `@pulsemcp/air-sdk` that provides `validate`, `list`, `init`, `start`, and `prepare` commands. All business logic is delegated to the SDK.

## Folder Hierarchy

```
packages/cli/
├── src/
│   ├── index.ts              # Entry point — Commander.js program setup
│   └── commands/
│       ├── validate.ts       # Validate JSON against AIR schemas
│       ├── list.ts           # List resolved artifacts
│       ├── init.ts           # Initialize ~/.air/ with empty config
│       ├── start.ts          # Start an agent session
│       └── prepare.ts        # Prepare a directory for an agent session
├── tests/                    # CLI command tests (spawn process, check output)
└── package.json
```

## Domain Context

This is a Node.js CLI tool published as `@pulsemcp/air-cli` with the `air` binary. It depends on `@pulsemcp/air-sdk` for all business logic — config resolution, validation, adapter discovery, root detection, and session preparation.

Each command is a thin wrapper that parses CLI arguments, calls the corresponding SDK function, formats the output, and handles exit codes.

## Core Principles

### Stay thin
The CLI is glue between the terminal and the SDK. Business logic belongs in the SDK or core, not here.

### Formatting and exit codes only
CLI commands should only handle argument parsing, output formatting, and process lifecycle (`process.exit`). All logic flows through SDK functions.

## What NOT to Do

- Do not add config resolution or validation logic — that belongs in core/SDK
- Do not add agent-specific translation — that belongs in adapter extensions
- Do not add adapter discovery or root detection — that belongs in the SDK
- Do not hard-code agent availability checks — use the SDK's adapter registry
