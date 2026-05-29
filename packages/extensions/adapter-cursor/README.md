# @pulsemcp/air-adapter-cursor

AIR adapter extension for the [Cursor CLI](https://cursor.com/docs/cli) (`cursor-agent`). Translates AIR artifacts into Cursor's native formats and prepares working directories for agent sessions.

## Installation

```bash
npm install @pulsemcp/air-adapter-cursor
```

## Usage

### With the AIR CLI

```bash
# Install the adapter globally alongside the CLI
npm install -g @pulsemcp/air-cli @pulsemcp/air-adapter-cursor

# Start a Cursor session
air start cursor --root web-app
```

### Programmatic

```typescript
import { resolveArtifacts } from "@pulsemcp/air-core";
import { CursorAdapter } from "@pulsemcp/air-adapter-cursor";

const artifacts = await resolveArtifacts("./air.json");
const adapter = new CursorAdapter();

// Prepare a working directory for a Cursor session
const session = await adapter.prepareSession(artifacts, "./my-project", {
  root: artifacts.roots["web-app"],
});

// session.configFiles  — [] (secrets are Cursor-native ${env:VAR}, see "Secrets" below)
// session.skillPaths   — skill dirs created in .cursor/skills/
// session.hookPaths    — hook dirs created in .cursor/hooks/
// session.startCommand — { command: "cursor-agent", args: [], cwd: "..." }
```

## What `prepareSession()` does

1. **Writes `.cursor/mcp.json`** — translates AIR MCP server configs into a top-level `mcpServers` map. User-authored servers and top-level keys are preserved; only AIR-owned keys are replaced.
2. **Writes `.cursor/hooks.json`** — registers path-based hooks under `hooks.<event>` with a required `version: 1`. AIR-owned entries are tagged with `_air_hook_id`; user-authored hooks are preserved.
3. **Injects skills** — copies `SKILL.md` files and associated content into `.cursor/skills/{name}/`, where Cursor discovers them.
4. **Injects hooks** — copies hook directories into `.cursor/hooks/{name}/` and registers their command in `hooks.json`, anchored to the repo root.
5. **Copies references** — attaches referenced documents into `{artifact}/references/`.
6. **Respects local priority** — if a skill or hook directory already exists in the target, it is not overwritten.

## Translation Details

| AIR Format | Cursor Format |
|------------|---------------|
| `mcp.json` (flat map with `type`, `title`, `description`) | `mcpServers.<name>` entries in `.cursor/mcp.json` (metadata stripped) |
| `stdio` servers | `{ command, args, env }` |
| `sse` / `streamable-http` servers | `{ url, headers }` (Cursor auto-detects transport from the URL) |
| Any `${VAR}` ref in `command` / `args` / `env` / `url` / `headers` | rewritten to Cursor-native `${env:VAR}` (anywhere in the string) |
| Skills (`SKILL.md` + content) | `.cursor/skills/{name}/` |
| Hooks (`HOOK.json` + scripts) | `.cursor/hooks/{name}/` + `hooks.<event>` registration in `.cursor/hooks.json` |
| Hook events `session_start`, `session_end`, `pre_tool_call`, `post_tool_call`, `user_prompt_submit`, `stop`, `subagent_stop`, `pre_compact` | Cursor `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `beforeSubmitPrompt`, `stop`, `subagentStop`, `preCompact` |
| References | `{artifact}/references/` |

## Secrets

Cursor natively expands `${env:VAR}` references in `mcp.json` values. Instead of writing AIR `${VAR}` placeholders, the adapter rewrites every AIR `${VAR}` reference to Cursor's **`${env:VAR}`** form at translation time:

- `env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" }` → `env: { GITHUB_TOKEN: "${env:GITHUB_TOKEN}" }`
- `headers: { Authorization: "Bearer ${API_TOKEN}" }` → `headers: { Authorization: "Bearer ${env:API_TOKEN}" }`
- `env: { KEY: "${OTHER}" }` (renamed) → `env: { KEY: "${env:OTHER}" }`

Cursor expands these from the host environment at launch. As a result, `prepareSession()` returns an **empty `configFiles` array** — there is no AIR `${VAR}` left for secret transforms to post-process.

**No unforwardable shapes.** Because Cursor's `${env:VAR}` interpolation works *anywhere in a string*, every secret reference forwards cleanly — whole-value, partial, and renamed alike. The adapter therefore never warns about secrets. Cursor's own built-in interpolation tokens (`${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}`, `${pathSeparator}`) and already-`${env:…}` references are left untouched so they are not double-wrapped.

## Known gaps

These AIR features have no static Cursor equivalent and are handled out of band:

- **OAuth MCP servers** — AIR's detailed OAuth config (`clientId`/`scopes`/`redirectUri`/…) has no static `mcp.json` form. Cursor performs interactive OAuth via `cursor-agent mcp login <name>`.
- **Plugins** — Cursor has no local plugin package an adapter can materialize. AIR treats plugins as composition sugar: a plugin's declared MCP servers / skills / hooks are expanded into the activation set and materialized as their underlying Cursor-native artifacts.
- **Subagent context** — Cursor has no `--append-system-prompt` flag, so subagent-root context is returned to the caller via `PreparedSession.subagentContext` rather than passed to the CLI.
- **`notification` hook event** — AIR's `notification` event has no Cursor equivalent; hooks targeting it are skipped with a `console.warn`.
