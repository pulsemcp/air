# @pulsemcp/air-adapter-codex

AIR adapter extension for the [OpenAI Codex CLI](https://github.com/openai/codex). Translates AIR artifacts into Codex's native formats and prepares working directories for agent sessions.

## Installation

```bash
npm install @pulsemcp/air-adapter-codex
```

## Usage

### With the AIR CLI

```bash
# Install the adapter globally alongside the CLI
npm install -g @pulsemcp/air-cli @pulsemcp/air-adapter-codex

# Start a Codex session
air start codex --root web-app
```

### Programmatic

```typescript
import { resolveArtifacts } from "@pulsemcp/air-core";
import { CodexAdapter } from "@pulsemcp/air-adapter-codex";

const artifacts = await resolveArtifacts("./air.json");
const adapter = new CodexAdapter();

// Prepare a working directory for a Codex session
const session = await adapter.prepareSession(artifacts, "./my-project", {
  root: artifacts.roots["web-app"],
});

// session.configFiles  — [] (Codex config is TOML, see "Secrets" below)
// session.skillPaths   — skill dirs created in .agents/skills/
// session.hookPaths    — hook dirs created in .codex/hooks/
// session.startCommand — { command: "codex", args: [], cwd: "..." }
```

## What `prepareSession()` does

1. **Writes `.codex/config.toml`** — translates AIR MCP server configs into `[mcp_servers.*]` tables and registers path-based hooks under `[[hooks.<Event>]]`. User-authored servers, hooks, and top-level keys are preserved; only AIR-owned keys are replaced.
2. **Injects skills** — copies `SKILL.md` files and associated content into `.agents/skills/{name}/`, where Codex discovers them.
3. **Injects hooks** — copies hook directories into `.codex/hooks/{name}/` and registers their command in `config.toml`, anchored to the repo root.
4. **Copies references** — attaches referenced documents into `{artifact}/references/`.
5. **Respects local priority** — if a skill or hook directory already exists in the target, it is not overwritten.

## Translation Details

| AIR Format | Codex Format |
|------------|--------------|
| `mcp.json` (flat map with `type`, `title`, `description`) | `[mcp_servers.<name>]` tables in `.codex/config.toml` (metadata stripped) |
| `stdio` servers | `{ command, args, env, env_vars }` |
| `sse` / `streamable-http` servers | `{ url, http_headers, env_http_headers }` (Codex auto-detects transport from the URL) |
| MCP `env` value `${VAR}` where key == `VAR` | `env_vars = ["VAR"]` (host env forwarding) |
| MCP `env` value `${OTHER}` (renamed) or literal | left in the `env` table |
| Header value `${VAR}` | `env_http_headers = { Header = "VAR" }` |
| Skills (`SKILL.md` + content) | `.agents/skills/{name}/` |
| Hooks (`HOOK.json` + scripts) | `.codex/hooks/{name}/` + `[[hooks.<Event>]]` registration |
| Hook events `session_start`, `pre_tool_call`, `post_tool_call`, `user_prompt_submit`, `stop` | Codex `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop` |
| References | `{artifact}/references/` |

## Secrets

Codex's config is TOML, which is outside AIR's JSON-based transform/validation pipeline. Instead of writing `${VAR}` placeholders, the adapter maps secret references to Codex's **native host-env forwarding** at translation time:

- `env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" }` → `env_vars = ["GITHUB_TOKEN"]` — Codex injects the host's `GITHUB_TOKEN` at launch.
- `headers: { Authorization: "${API_TOKEN}" }` → `env_http_headers = { Authorization = "API_TOKEN" }`.

As a result, `prepareSession()` returns an **empty `configFiles` array** — there is no JSON config for secret transforms to post-process, and no unresolved `${VAR}` is ever written to the TOML.

## Known gaps

These AIR features have no static Codex equivalent and are handled out of band:

- **OAuth MCP servers** — AIR's detailed OAuth config (`clientId`/`scopes`/`redirectUri`/…) has no static `config.toml` form. Codex performs interactive OAuth via `codex mcp login <name>`.
- **Plugins** — Codex's marketplace plugins are remote-installed (`codex plugin add`). AIR treats plugins as composition sugar: a plugin's declared MCP servers / skills / hooks are expanded into the activation set and materialized as their underlying Codex-native artifacts.
- **Subagent context** — Codex has no `--append-system-prompt` flag, so subagent-root context is returned to the caller via `PreparedSession.subagentContext` rather than passed to the CLI.
