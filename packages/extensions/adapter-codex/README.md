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
| `sse` / `streamable-http` servers | `{ url, http_headers, env_http_headers, bearer_token_env_var, oauth }` (Codex auto-detects transport from the URL) |
| MCP `env` value `${VAR}` where key == `VAR` | `env_vars = ["VAR"]` (host env forwarding) |
| MCP `env` value `${OTHER}` (renamed) or `"Bearer ${TOKEN}"` (partial) | `sh -c` rebind shim (`command = "sh"`, source forwarded via `env_vars`) |
| MCP `env` literal value | left in the `env` table |
| Header value `${VAR}` (whole-value, renamed or not) | `env_http_headers = { Header = "VAR" }` |
| Header `Authorization: "Bearer ${VAR}"` | `bearer_token_env_var = "VAR"` |
| Non-Bearer partial header (`"v1-${TOKEN}"`) | left literal in `http_headers` + `console.warn` |
| MCP `oauth.clientId` | per-server `[mcp_servers.<name>.oauth]` `client_id` |
| MCP `oauth.redirectUri` | single top-level `mcp_oauth_callback_url` (global) |
| Skills (`SKILL.md` + content) | `.agents/skills/{name}/` |
| Hooks (`HOOK.json` + scripts) | `.codex/hooks/{name}/` + `[[hooks.<Event>]]` registration |
| Hook events `session_start`, `pre_tool_call`, `post_tool_call`, `user_prompt_submit`, `stop` | Codex `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop` |
| References | `{artifact}/references/` |

## Secrets

Codex's config is TOML, which is outside AIR's JSON-based transform/validation pipeline. Instead of writing `${VAR}` placeholders, the adapter maps secret references to Codex-native mechanisms at translation time so only variable *names* — never values — land in `config.toml`. As a result, `prepareSession()` returns an **empty `configFiles` array** — there is no JSON config for secret transforms to post-process.

**stdio `env`:**

- `env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" }` (whole-value, same name) → `env_vars = ["GITHUB_TOKEN"]` — Codex injects the host's `GITHUB_TOKEN` at launch.
- `env: { TOKEN: "${GITHUB_TOKEN}" }` (renamed) or `env: { AUTH: "Bearer ${TOKEN}" }` (partial) → Codex's `env_vars` can express neither, so the launch is wrapped in a `sh -c` shim that rebinds the key from the forwarded source var right before `exec`: `command = "sh"`, `args = ["-c", "AUTH=\"Bearer ${TOKEN}\" exec <orig command/args>"]`, with the source forwarded via `env_vars = ["TOKEN"]`. The secret value never touches disk — only the variable name does.
- A literal value (no `${…}`) stays in the `[mcp_servers.<name>.env]` table.

**remote-server headers:**

- `headers: { Authorization: "${API_TOKEN}" }` (whole-value, renamed or not) → `env_http_headers = { Authorization = "API_TOKEN" }`.
- `headers: { Authorization: "Bearer ${API_TOKEN}" }` → `bearer_token_env_var = "API_TOKEN"` (Codex emits the `Authorization` header itself).
- A non-Bearer *partial* header (`X-Api-Key = "v1-${TOKEN}"`) has no Codex expression — remote servers have no launch process to wrap in a shell shim — so it stays literal in `http_headers` and the adapter emits a `console.warn`. Rewrite these as a whole-value ref (or set the value directly).

**OAuth (remote servers):**

- `oauth.clientId` → per-server `[mcp_servers.<name>.oauth]` `client_id`. Emitting an explicit `client_id` bypasses OAuth dynamic client registration (RFC 7591), which some providers reject.
- `oauth.redirectUri` → the single top-level `mcp_oauth_callback_url`. Codex has no per-server redirect URI, so if multiple servers declare distinct URIs the adapter keeps the first and warns.
- `oauth.scopes`, `oauth.clientSecret`, and `oauth.authServerMetadataUrl` have no Codex per-server config slot (the `oauth` table accepts only `client_id`), so they are dropped with a warning rather than silently.

## Known gaps

These AIR features have no static Codex equivalent and are handled out of band:

- **Plugins** — Codex's marketplace plugins are remote-installed (`codex plugin add`). AIR treats plugins as composition sugar: a plugin's declared MCP servers / skills / hooks are expanded into the activation set and materialized as their underlying Codex-native artifacts.
- **Subagent context** — Codex has no `--append-system-prompt` flag, so subagent-root context is returned to the caller via `PreparedSession.subagentContext` rather than passed to the CLI.
