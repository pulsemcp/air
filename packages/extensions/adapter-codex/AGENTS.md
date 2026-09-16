# @pulsemcp/air-adapter-codex

AIR adapter extension for OpenAI Codex CLI. Translates AIR artifacts into Codex's native formats and prepares working directories for agent sessions.

## Folder Hierarchy

```
packages/extensions/adapter-codex/
├── src/
│   ├── index.ts             # AirExtension default export + re-exports
│   ├── codex-adapter.ts      # CodexAdapter class implementing AgentAdapter
│   ├── mcp-ownership.ts      # Which MCP server keys AIR owns and may remove (#174)
│   ├── scan-local-skills.ts  # Discovers user-managed skills in .agents/skills/
│   └── skill-ownership.ts    # Which skill dirs AIR owns and may delete (#168)
├── tests/
│   ├── codex-adapter.test.ts     # Translation, config generation, prepareSession tests
│   ├── mcp-ownership.test.ts     # Pre-existing MCP server keys are never overwritten or removed
│   ├── scan-local-skills.test.ts # Local skill discovery tests
│   └── skill-ownership.test.ts   # Pre-existing skill dirs are never claimed or deleted
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

Codex's config is TOML, which sits outside AIR's JSON-based transform/validation pipeline. Rather than emitting `${VAR}` placeholders the pipeline would need to resolve, the adapter maps secret references to Codex-native mechanisms at translation time so only variable *names* — never values — are written to `config.toml`.

**stdio `env` values** are classified into three shapes:
- `KEY = "${KEY}"` (whole-value, same name) → `env_vars = ["KEY"]` (Codex injects the host's `KEY` at launch).
- `KEY = "${OTHER}"` (whole-value, renamed) or `KEY = "Bearer ${TOKEN}"` (partial) → Codex's `env_vars` can express neither, so the launch is wrapped in a `sh -c` shim that rebinds `KEY` from the forwarded source var(s) right before `exec` hands off to the real MCP binary (`command = "sh"`, `args = ["-c", "KEY=\"...\" exec <orig>"]`). The source var(s) are forwarded via `env_vars`; the value is templated as a shell double-quoted string so the sub-shell expands it. Original command/args are POSIX single-quoted (`shSingleQuote`); literal runs in the value are escaped for the double-quote context (`escapeShellDoubleQuoted`).
- `KEY = "literal"` (no ref) → `[mcp_servers.<name>.env]` table.

**remote-server header values:**
- A *whole-value* ref (`${VAR}`, renamed or not) → `env_http_headers` (Codex maps a header name to a host var of any name, so renames forward cleanly).
- `Authorization = "Bearer ${VAR}"` → Codex's native `bearer_token_env_var` (Codex emits the `Authorization` header itself).
- Any other *partial* header value has no Codex expression — remote servers have **no launch process** to wrap in a shell shim — so it stays literal in `http_headers` and `warnUnforwardableSecret` warns rather than silently shipping a broken secret.

**OAuth (remote servers):** AIR's `oauth.clientId` maps to Codex's per-server `[mcp_servers.<id>.oauth]` table as `client_id`, which bypasses OAuth dynamic client registration (RFC 7591) that some providers reject. Codex has **no per-server redirect URI** — only one top-level `mcp_oauth_callback_url` — so `collectOAuthCallbackUrl` gathers every server's `redirectUri`, emits the single unique value, and warns (keeping the first) if servers declare distinct URIs. Codex's per-server `oauth` table accepts **only** `client_id`, so the remaining AIR OAuth fields (`scopes`, `clientSecret`, `authServerMetadataUrl`) have no Codex slot; they are dropped with a warning (`warnUnmappableOAuthFields`) rather than silently.

Because of this, `prepareSession()` returns an **empty `configFiles` array** — there is no JSON config file for transforms to post-process, and no resolvable AIR `${VAR}` is left for the pipeline (any `${VAR}` remaining in the TOML is a *shell* expansion the sub-shell resolves, not an AIR placeholder).

## Core Principles

### prepareSession is the primary interface
Callers should use `prepareSession()` rather than calling `translateMcpServersByShort`, `generateConfig`, and writing files separately. The adapter owns the full "make this directory ready" contract.

### Local artifacts take priority
If `.agents/skills/{name}/` or `.codex/hooks/{name}/` already exists in the target directory, the catalog version is not written. This allows repos to override catalog skills and hooks. The same goes for an MCP server key already in `.codex/config.toml` that AIR didn't write: a selected catalog server with that name is not written over it, and the key is never recorded in the manifest (#174).

### Reconcile, don't clobber
`.codex/config.toml` may contain user-authored MCP servers, hooks, and top-level keys. The adapter replaces only AIR-owned keys (MCP servers it manages + hook entries tagged `_air_hook_id`), preserving everything else. A run that leaves the config empty deletes the file rather than leaving an empty stub.

## What NOT to Do

- Do not deep-merge MCP server configs — full replacement of AIR-owned keys only
- Do not write files outside the target directory
- Map secret refs to Codex-native mechanisms at translation time rather than writing placeholders or raw values: whole-value same-named env refs → `env_vars`; renamed/partial stdio env refs → a `sh -c` rebind shim (`env_vars` forwards the source); whole-value header refs → `env_http_headers`; `Authorization: Bearer ${VAR}` → `bearer_token_env_var`. Only non-Bearer *partial header* values remain unforwardable and must `warn` (`warnUnforwardableSecret`), never silently ship
- Map `oauth.clientId` to the per-server `[mcp_servers.<id>.oauth]` `client_id`, and the (global) `oauth.redirectUri` to the single top-level `mcp_oauth_callback_url` via `collectOAuthCallbackUrl` — there is no per-server redirect URI in Codex
- Do not surface `.codex/config.toml` via `configFiles` — it is TOML, outside AIR's JSON transform pipeline
