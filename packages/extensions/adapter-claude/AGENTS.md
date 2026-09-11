# @pulsemcp/air-adapter-claude

AIR adapter extension for Claude Code. Translates AIR artifacts into Claude Code's native format and prepares working directories for agent sessions.

## Folder Hierarchy

```
packages/extensions/adapter-claude/
├── src/
│   ├── index.ts              # AirExtension default export + re-exports
│   ├── claude-adapter.ts     # ClaudeAdapter class implementing AgentAdapter
│   ├── scan-local-skills.ts  # Discovers user-managed skills in .claude/skills/
│   └── skill-ownership.ts    # Which skill dirs AIR owns and may delete (#168)
├── tests/
│   ├── claude-adapter.test.ts     # Translation, config generation, prepareSession tests
│   ├── scan-local-skills.test.ts  # Local skill discovery tests
│   └── skill-ownership.test.ts    # Pre-existing skill dirs are never claimed or deleted
└── package.json
```

## Domain Context

This package implements the `AgentAdapter` interface from `@pulsemcp/air-core` for Claude Code. The most important method is `prepareSession()` which is the single entry point for setting up a working directory — it writes `.mcp.json`, injects skills into `.claude/skills/`, injects hooks into `.claude/hooks/`, copies references, and resolves `${VAR}` secrets.

Claude Code expects:
- MCP config at `.mcp.json` with a `mcpServers` wrapper (no `title`/`description` fields; `type` preserved for non-stdio servers)
- Skills as directories under `.claude/skills/{name}/SKILL.md`
- Hooks as directories under `.claude/hooks/{name}/HOOK.json`
- References copied alongside skills/hooks in `{artifact}/references/`
- OAuth `redirectUri` converted to `callbackPort`
- Plugin `id` mapped to `name`; artifact references (skills/mcp_servers/hooks) stripped (used by CLI, not agent)

## Core Principles

### prepareSession is the primary interface
Callers should use `prepareSession()` rather than calling `translateMcpServers`, `generateConfig`, and writing files separately. The adapter owns the full "make this directory ready" contract.

### Local artifacts take priority
If `.claude/skills/{name}/` or `.claude/hooks/{name}/` already exists in the target directory, the catalog version is not written. This allows repos to override catalog skills and hooks.

## What NOT to Do

- Do not deep-merge MCP server configs — full replacement only
- Do not write files outside the target directory
- Do not resolve secrets in the adapter — secret resolution is handled by transform extensions (e.g., `@pulsemcp/air-secrets-env`)
