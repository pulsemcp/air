# @pulsemcp/air-adapter-cursor

AIR adapter extension for the Cursor CLI. Translates AIR artifacts into Cursor's native formats and prepares working directories for agent sessions.

## Folder Hierarchy

```
packages/extensions/adapter-cursor/
├── src/
│   ├── index.ts              # AirExtension default export + re-exports
│   ├── cursor-adapter.ts      # CursorAdapter class implementing AgentAdapter
│   └── scan-local-skills.ts   # Discovers user-managed skills in .cursor/skills/
├── tests/
│   ├── cursor-adapter.test.ts     # Translation, config generation, prepareSession tests
│   └── scan-local-skills.test.ts  # Local skill discovery tests
└── package.json
```

## Domain Context

This package implements the `AgentAdapter` interface from `@pulsemcp/air-core` for the Cursor CLI (`cursor-agent`). The most important method is `prepareSession()` which is the single entry point for setting up a working directory — it writes `.cursor/mcp.json`, writes `.cursor/hooks.json`, injects skills into `.cursor/skills/`, injects hooks into `.cursor/hooks/`, and copies references.

Cursor expects:
- MCP servers in `.cursor/mcp.json` (JSON) under a top-level `mcpServers` map. Cursor auto-discovers a project-local `.cursor/mcp.json` (and `~/.cursor/mcp.json`).
- `mcpServers.<name>` entries: stdio servers use `command`/`args`/`env`; remote servers use `url`/`headers` (Cursor auto-detects the transport from the URL).
- Hook registrations in `.cursor/hooks.json` (JSON) with a required top-level `version: 1` and a `hooks` map of `<event> → [ { command, matcher?, timeout? } ]`. AIR-owned entries are tagged with an `_air_hook_id` marker so re-runs can reconcile them.
- Skills as directories under `.cursor/skills/{name}/SKILL.md` (Cursor scans `.cursor/skills/` and `.agents/skills/`; the adapter materializes to `.cursor/skills/` to keep all AIR-managed Cursor artifacts namespaced under `.cursor/`).
- Hook scripts as directories under `.cursor/hooks/{name}/`.
- References copied alongside skills/hooks in `{artifact}/references/`.

### Secret handling is Cursor-native

Cursor natively expands `${env:VAR}` references in `mcp.json` values — anywhere in a string, in `command`, `args`, `env` values, `url`, and `headers`. Rather than emitting AIR `${VAR}` placeholders the pipeline would need to resolve, the adapter rewrites every AIR `${VAR}` reference to Cursor's `${env:VAR}` form at translation time (`toCursorVars`). Cursor's built-in interpolation tokens (`${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}`, `${pathSeparator}`) and already-`${env:…}` references are left untouched so they are not double-wrapped.

Because Cursor's interpolation works **anywhere in a string**, every secret shape forwards cleanly — whole-value (`"${TOKEN}"`), partial (`"Bearer ${TOKEN}"`), and renamed (`KEY = "${OTHER}"`). There are **no unforwardable shapes**, so the adapter never warns about secrets (unlike the Codex adapter, whose host-env forwarding only expresses whole-value, same-named refs).

Because of this, `prepareSession()` returns an **empty `configFiles` array** — there is no resolvable `${VAR}` left for AIR's transform/validation pipeline; the written `${env:VAR}` is Cursor-native and expanded by Cursor at launch.

## Core Principles

### prepareSession is the primary interface
Callers should use `prepareSession()` rather than calling `translateMcpServersByShort`, `generateConfig`, and writing files separately. The adapter owns the full "make this directory ready" contract.

### Local artifacts take priority
If `.cursor/skills/{name}/` or `.cursor/hooks/{name}/` already exists in the target directory, the catalog version is not written. This allows repos to override catalog skills and hooks.

### Reconcile, don't clobber
`.cursor/mcp.json` and `.cursor/hooks.json` may contain user-authored MCP servers, hooks, and top-level keys. The adapter replaces only AIR-owned keys (MCP servers it manages + hook entries tagged `_air_hook_id`), preserving everything else. A run that leaves a config empty deletes the file rather than leaving an empty stub.

## What NOT to Do

- Do not deep-merge MCP server configs — full replacement of AIR-owned keys only
- Do not write files outside the target directory
- Rewrite AIR `${VAR}` refs to Cursor's `${env:VAR}` at translation time rather than writing AIR placeholders. Do not double-wrap Cursor built-in tokens (`${userHome}`, `${workspaceFolder}`, …) or already-`${env:…}` refs
- Do not surface `.cursor/mcp.json` / `.cursor/hooks.json` via `configFiles` — `${env:VAR}` is Cursor-native and outside AIR's JSON transform pipeline
