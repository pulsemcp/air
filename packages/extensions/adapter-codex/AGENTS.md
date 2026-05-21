# @pulsemcp/air-adapter-codex

AIR adapter extension for OpenAI Codex CLI. Translates AIR artifacts into Codex's native formats and prepares working directories for agent sessions.

## Folder Hierarchy

```
packages/extensions/adapter-codex/
├── src/
│   ├── index.ts             # AirExtension default export + re-exports
│   ├── codex-adapter.ts      # CodexAdapter class implementing AgentAdapter
│   └── scan-local-skills.ts  # Discovers user-managed skills in .agents/skills/
├── tests/
│   ├── codex-adapter.test.ts     # Translation, config generation, prepareSession tests
│   └── scan-local-skills.test.ts # Local skill discovery tests
└── package.json
```

## Domain Context

This package implements the `AgentAdapter` interface from `@pulsemcp/air-core` for the OpenAI Codex CLI. The most important method is `prepareSession()` which is the single entry point for setting up a working directory — it writes `.codex/config.toml`, injects skills into `.agents/skills/`, injects hooks into `.codex/hooks/`, registers hook commands in `config.toml`, and copies references.

Codex expects:
- MCP servers + hook registrations in `.codex/config.toml` (TOML) — Codex auto-discovers a project-local `.codex/config.toml` for trusted projects, or it can be loaded via `CODEX_HOME`.
- `[mcp_servers.<name>]` tables: stdio servers use `command`/`args`/`env`/`env_vars`; remote servers use `url`/`http_headers`/`env_http_headers` (Codex auto-detects the transport from the URL).
- Skills as directories under `.agents/skills/{name}/SKILL.md` (Codex walks `.agents/skills` from the working directory up to the repo root).
- Hooks as `[[hooks.<Event>]]` matcher groups whose inner entries carry a `command`; AIR-owned entries are tagged with an `_air_hook_id` marker so re-runs can reconcile them.
- References copied alongside skills/hooks in `{artifact}/references/`.

### Secret handling is Codex-native

Codex's config is TOML, which sits outside AIR's JSON-based transform/validation pipeline. Rather than emitting `${VAR}` placeholders the pipeline would need to resolve, the adapter maps secret references to Codex's own host-env forwarding at translation time:
- An MCP `env` value that is exactly `${VAR}` and whose key matches `VAR` becomes an `env_vars` entry (Codex injects the host's `VAR` at launch). Any other value (including a renamed `${OTHER}`) stays in the literal `env` table.
- A remote-server header value of `${VAR}` becomes an `env_http_headers` entry; other header values go into `http_headers`.

Codex's host-env forwarding only expresses **whole-value, same-named** refs. A renamed (`KEY = "${OTHER}"`) or partial (`"Bearer ${TOKEN}"`) ref can't be forwarded, so it falls through to the literal table — and since the TOML never passes through the `${VAR}` transform pipeline, Codex would inject the literal `${…}` string at runtime. The adapter emits a `console.warn` for each such value (`warnUnforwardableSecret`) rather than silently shipping a broken secret.

Because of this, `prepareSession()` returns an **empty `configFiles` array** — there is no JSON config file for transforms to post-process, and no resolvable `${VAR}` is left for the pipeline.

## Core Principles

### prepareSession is the primary interface
Callers should use `prepareSession()` rather than calling `translateMcpServersByShort`, `generateConfig`, and writing files separately. The adapter owns the full "make this directory ready" contract.

### Local artifacts take priority
If `.agents/skills/{name}/` or `.codex/hooks/{name}/` already exists in the target directory, the catalog version is not written. This allows repos to override catalog skills and hooks.

### Reconcile, don't clobber
`.codex/config.toml` may contain user-authored MCP servers, hooks, and top-level keys. The adapter replaces only AIR-owned keys (MCP servers it manages + hook entries tagged `_air_hook_id`), preserving everything else. A run that leaves the config empty deletes the file rather than leaving an empty stub.

## What NOT to Do

- Do not deep-merge MCP server configs — full replacement of AIR-owned keys only
- Do not write files outside the target directory
- Map whole-value, same-named `${VAR}` refs to `env_vars`/`env_http_headers` at translation time rather than writing placeholders. Renamed/partial refs can't be forwarded — those fall through to the literal table and must `warn` (`warnUnforwardableSecret`), never silently ship
- Do not surface `.codex/config.toml` via `configFiles` — it is TOML, outside AIR's JSON transform pipeline
