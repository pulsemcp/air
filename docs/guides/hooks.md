# Hooks

Hooks are shell commands that run in response to agent lifecycle events. Use them for notifications, guardrails, automation, and integrations.

## Two-layer structure

Hooks use a two-layer directory-based pattern, like skills:

1. **Index** (`hooks.json`) — lightweight catalog entries with `id`, `description`, and a `path`
2. **Directory** (`hooks/{id}/`) — contains the runtime definition (`HOOK.json`) and any associated scripts

This keeps the index scannable while letting hooks bundle scripts and configuration together.

```
~/.air/hooks/
├── hooks.json
└── hooks/
    ├── notify-session-start/
    │   ├── HOOK.json
    │   └── notify.sh
    └── lint-pre-commit/
        └── HOOK.json
```

## Defining hooks

### Step 1: Add an index entry

Add entries to `~/.air/hooks/hooks.json`:

```json
{
  "notify-session-start": {
    "id": "notify-session-start",
    "title": "Session Start Notification",
    "description": "Send a Slack notification when an agent session starts",
    "path": "hooks/notify-session-start"
  },
  "lint-pre-commit": {
    "id": "lint-pre-commit",
    "title": "Pre-Commit Lint Check",
    "description": "Run linting on staged files before allowing a commit",
    "path": "hooks/lint-pre-commit"
  }
}
```

### Index fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier. Must match the key. |
| `description` | Yes | What this hook does. Max 500 characters. |
| `title` | No | Human-readable name. Max 100 characters. |
| `path` | Yes | Path to the hook directory containing `HOOK.json`. Either a relative path inside the same catalog, or a remote URI handled by an installed catalog provider (e.g. `github://owner/repo[@ref]/path/to/hook-dir`). |
| `references` | No | IDs of reference documents this hook depends on. |
| `x-config` | No | Consumer-supplied config overlay that AIR deep-merges into the materialized `HOOK.json`'s `x-config` at resolve time. See [Consumer config overlay (`x-config`)](#consumer-config-overlay-x-config). |

### Step 2: Create the hook directory with HOOK.json

Each hook directory contains a `HOOK.json` file with the runtime definition, plus any scripts or files the hook needs:

```json
{
  "event": "session_start",
  "command": "./notify.sh",
  "timeout_seconds": 10,
  "env": {
    "WEBHOOK_URL": "${SLACK_WEBHOOK_URL}"
  }
}
```

### HOOK.json fields

| Field | Required | Description |
|-------|----------|-------------|
| `event` | Yes | Lifecycle event that triggers this hook. |
| `command` | Yes | Shell command to execute. |
| `args` | No | Command arguments. |
| `env` | No | Environment variables for the hook process. Values support `${VAR}` interpolation. |
| `timeout_seconds` | No | Maximum execution time before the hook is killed (minimum: 1). |
| `matcher` | No | Regex pattern — hook only fires when matched against event data. |
| `x-config` | No | Hook-defined configuration block. Consumers can layer overrides via `x-config` in the index entry; AIR deep-merges them at resolve time. See [Consumer config overlay (`x-config`)](#consumer-config-overlay-x-config). |

## Consumer config overlay (`x-config`)

Hook authors can publish defaults inside `HOOK.json`, and consumers can override those defaults from their own `hooks.json` index entry — without forking the hook directory. AIR deep-merges the two `x-config` blocks at `air resolve` (and at `air prepare` / `air start`) time.

The shape of `x-config` is intentionally permissive: AIR does not validate the inner keys. Each hook author defines and documents their own schema. AIR treats it as an opaque blob that flows through resolution and materialization.

### Merge rules

- **Objects** merge recursively (consumer wins on key conflicts).
- **Arrays** are replaced wholesale — consumer arrays do not concatenate with source arrays.
- **Scalars** (strings, numbers, booleans, `null`) are replaced.
- **Missing on either side** — whichever side is present wins. If neither side has `x-config`, the field is omitted from the output.

### Example

Hook author publishes `hooks/notify-session-start/HOOK.json`:

```json
{
  "event": "session_start",
  "command": "./notify.sh",
  "x-config": {
    "channel": "#general",
    "tags": ["info", "default"],
    "thresholds": { "warn_minutes": 30 }
  }
}
```

Consumer overlays in their own `hooks.json`:

```json
{
  "notify-session-start": {
    "description": "Slack notify on session start",
    "path": "github://acme/air-org@v1.2.0/hooks/notify-session-start",
    "x-config": {
      "channel": "#agent-events",
      "tags": ["consumer-a"],
      "thresholds": { "warn_minutes": 5 }
    }
  }
}
```

Resolved (and materialized to `.claude/hooks/notify-session-start/HOOK.json`):

```json
{
  "event": "session_start",
  "command": "./notify.sh",
  "x-config": {
    "channel": "#agent-events",
    "tags": ["consumer-a"],
    "thresholds": { "warn_minutes": 5 }
  }
}
```

### Interpolation

`${VAR}` references inside `x-config` values are resolved by the same secrets transforms that handle the rest of the config (e.g. `@pulsemcp/air-secrets-env`, `@pulsemcp/air-secrets-file`). This means consumers can reference environment variables or secret-file values without the hook author needing to wire anything special:

```json
{
  "notify-session-start": {
    "description": "Slack notify on session start",
    "path": "hooks/notify-session-start",
    "x-config": {
      "credentials": { "token": "${SLACK_BOT_TOKEN}" }
    }
  }
}
```

### Where the merged value shows up

- `air resolve --json` — the merged `x-config` appears under the resolved hook entry.
- `air prepare --target <dir>` and `air start` — the merged `x-config` is written into the materialized `HOOK.json` inside the agent's working directory (e.g. `.claude/hooks/{id}/HOOK.json`), then run through the transform pipeline (which resolves `${VAR}` interpolation).

## Remote hook directories (`github://`)

The `path` field accepts catalog provider URIs in addition to relative paths. With `@pulsemcp/air-provider-github` installed, a hook directory can live in a separate GitHub repo:

```json
{
  "remote-hook": {
    "description": "Hook from a shared catalog",
    "path": "github://acme/air-org@v1.2.0/hooks/notify-session-start"
  }
}
```

The provider shallow-clones the referenced ref into `~/.air/cache/github/{owner}/{repo}/{ref}/` (where `{ref}` is the literal ref string — the branch name, tag name, or full 40-character SHA) and AIR reads the hook directory from there, just like a local path. Refs that look like a 40-character SHA are treated as immutable and content-addressed (the cache directory will not be re-fetched). Branch names and tags are mutable from AIR's point of view and are refreshed on `air update`. Note that AIR does not deduplicate a SHA-pinned ref against a branch that resolves to the same commit — they live in separate cache directories.

The same `AIR_GITHUB_TOKEN` and `gitProtocol` settings used for `catalogs` apply to `path` URIs — the provider is reused, not re-instantiated.

## Lifecycle events

| Event | When it fires |
|-------|--------------|
| `session_start` | Agent session begins |
| `session_end` | Agent session terminates |
| `pre_tool_call` | Before a tool is invoked |
| `post_tool_call` | After a tool completes |
| `pre_commit` | Before a git commit is created |
| `post_commit` | After a git commit is created |
| `notification` | Agent sends a notification or message (behavior is agent-specific) |
| `stop` | Agent finishes responding (Claude Code: `Stop`) |
| `subagent_stop` | A subagent finishes (Claude Code: `SubagentStop`) |
| `pre_compact` | Before context compaction (Claude Code: `PreCompact`) |
| `user_prompt_submit` | User submits a prompt (Claude Code: `UserPromptSubmit`) |

Hook authors targeting Claude Code may write the PascalCase Claude lifecycle event names (`SessionStart`, `Stop`, `PreCompact`, etc.) directly in `HOOK.json`'s `event` field — the Claude adapter accepts them as identity mappings, so no snake_case translation is required.

## Examples

### Pre-commit linting

Index entry in `hooks.json`:

```json
{
  "lint-pre-commit": {
    "id": "lint-pre-commit",
    "title": "Pre-Commit Lint",
    "description": "Run linting on staged files before allowing a commit",
    "path": "hooks/lint-pre-commit"
  }
}
```

`hooks/lint-pre-commit/HOOK.json`:

```json
{
  "event": "pre_commit",
  "command": "npx",
  "args": ["lint-staged"],
  "timeout_seconds": 30
}
```

### Session start notification

Index entry in `hooks.json`:

```json
{
  "notify-session-start": {
    "id": "notify-session-start",
    "title": "Session Start Notification",
    "description": "Send a Slack notification when an agent session starts",
    "path": "hooks/notify-session-start"
  }
}
```

`hooks/notify-session-start/HOOK.json`:

```json
{
  "event": "session_start",
  "command": "./notify.sh",
  "timeout_seconds": 10,
  "env": {
    "WEBHOOK_URL": "${SLACK_WEBHOOK_URL}"
  }
}
```

`hooks/notify-session-start/notify.sh`:

```bash
#!/usr/bin/env bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"text": "Agent session started"}' \
  "$WEBHOOK_URL"
```

### Tool call guardrail

Use the `matcher` field in `HOOK.json` to filter which events trigger the hook:

`hooks/log-bash-calls/HOOK.json`:

```json
{
  "event": "pre_tool_call",
  "command": "bash",
  "args": ["-c", "echo \"Tool call: $TOOL_NAME\" >> /tmp/agent-audit.log"],
  "matcher": "Bash"
}
```

The `matcher` field is a regex pattern. The hook only fires when the pattern matches the event data. In this example, the hook only fires for Bash tool calls.

## Assigning hooks to roots

Hooks are activated per-root via `default_hooks`:

```json
{
  "web-app": {
    "name": "web-app",
    "description": "Main web application",
    "default_hooks": ["lint-pre-commit", "notify-session-start"]
  }
}
```

Without a root, all hooks are available.

## Secret resolution in hooks

Hook fields (`command`, `args`, `env`, and any `x-config` values) support `${VAR}` interpolation, and these patterns are resolved by the same secrets transforms that handle MCP server configs. During `air prepare`, the transform pipeline processes all config files returned by the adapter — including `.mcp.json`, `.claude/settings.json`, and all injected `HOOK.json` files:

- **`@pulsemcp/air-secrets-env`** resolves `${VAR}` and `${VAR:-default}` from process environment variables
- **`@pulsemcp/air-secrets-file`** resolves `${VAR}` from a JSON secrets file (via `--secrets-file`)

This means `${VAR}` patterns in hook commands and args are resolved everywhere — both in the source `HOOK.json` files and in the agent's registered hook config (e.g., `.claude/settings.json`).

After transforms run, AIR validates that no unresolved `${VAR}` patterns remain in any config file or `HOOK.json` file. Use `--skip-validation` if partial resolution is intentional.

## Agent translation

At session start, AIR copies hook directories into the agent's working directory (e.g., `.claude/hooks/{id}/`). The adapter reads each `HOOK.json` to translate hooks into the agent's native format. Local hooks take priority — if a hook directory already exists in the target, the catalog version is not copied.

If a selected hook's `path` resolves to a directory that does not exist on disk, `air prepare` / `air start` fails with an error naming the qualified ID and the unreachable path. The catalog declared the hook but AIR cannot materialize it — fix the `path` in the catalog's index file, or drop the hook via `air.json#exclude`.

### Claude Code

For Claude Code, the adapter registers hooks in `.claude/settings.json` under the `hooks` key. Each AIR lifecycle event maps to a Claude Code hook event:

| AIR event | Claude Code event | Notes |
|-----------|-------------------|-------|
| `session_start` | `SessionStart` | |
| `session_end` | `SessionEnd` | |
| `pre_tool_call` | `PreToolUse` | |
| `post_tool_call` | `PostToolUse` | |
| `notification` | `Notification` | |
| `stop` | `Stop` | |
| `subagent_stop` | `SubagentStop` | |
| `pre_compact` | `PreCompact` | |
| `user_prompt_submit` | `UserPromptSubmit` | |
| `pre_commit` | — | No direct equivalent; use `pre_tool_call` with a `matcher` |
| `post_commit` | — | No direct equivalent; use `post_tool_call` with a `matcher` |

The adapter also accepts the PascalCase Claude event names (`SessionStart`, `Stop`, `PreCompact`, …) as identity mappings — hook authors targeting Claude can write either form. Unknown `event` values are logged as a warning during `air prepare` / `air start` and the hook is left unregistered (the hook directory is still materialized).

The `command` and `args` from `HOOK.json` are combined into a single command string. Path rewriting happens at two levels:

- `command` rewrites if it starts with `./` (e.g. `./notify.sh` → `"$CLAUDE_PROJECT_DIR/.claude/hooks/<id>/notify.sh"`).
- Each `args` entry rewrites when it looks like a path (contains a `/` separator, or starts with `./`) **and** points at a real file under the hook's installed directory. Bare command names like `lint-staged` and flags like `--quiet` pass through unchanged.

Rewritten paths are anchored with Claude Code's `$CLAUDE_PROJECT_DIR` environment variable and wrapped in double quotes (e.g. `"$CLAUDE_PROJECT_DIR/.claude/hooks/<id>/dist/capture.js"`). This makes hooks resilient to mid-session `cd` calls — if the agent changes its working directory before a hook fires, a plain cwd-relative path would fail to resolve, but the `$CLAUDE_PROJECT_DIR`-anchored path always resolves to the project root regardless of cwd.

The `matcher` and `timeout_seconds` fields are carried through when present.

Example: a hook with this `HOOK.json`:

```json
{
  "event": "pre_tool_call",
  "command": "npx",
  "args": ["lint-staged"],
  "matcher": "Bash",
  "timeout_seconds": 30
}
```

Produces this entry in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "npx lint-staged",
            "timeout": 30,
            "_airHookId": "lint-staged"
          }
        ]
      }
    ]
  }
}
```

A hook whose args reference a script inside its own directory (e.g. `args: ["dist/capture.js"]`) emits a path-rewritten command anchored to the project root:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/agent-transcript-capture/dist/capture.js\"",
            "_airHookId": "agent-transcript-capture"
          }
        ]
      }
    ]
  }
}
```

If `.claude/settings.json` already exists, new hook entries are merged — existing settings and hooks are preserved. The `_airHookId` marker identifies which entries AIR wrote; entries without the marker (or with an unknown ID) are considered user-authored and are never modified.

On re-runs, AIR uses the `_airHookId` marker plus the per-target manifest to prune its prior entries before re-registering the current selection. This prevents duplicate registrations and removes entries for hooks that were dropped from the selection. See [Cleanup between runs](running-sessions.md#cleanup-between-runs) for details.

**Limitations:**
- The `env` field from `HOOK.json` is not forwarded to Claude Code hooks. Environment variables must be set in the shell environment before starting the session.
- `pre_commit` and `post_commit` events have no direct Claude Code equivalent. They are skipped during registration with a warning. Use `pre_tool_call` with a `matcher` to target specific tool calls instead.

## Listing hooks

```bash
air list hooks
```

Output:

```
Hooks (2):

  notify-session-start (Session Start Notification)
    Send a Slack notification when an agent session starts
    Path: hooks/notify-session-start

  lint-pre-commit (Pre-Commit Lint Check)
    Run linting on staged files before allowing a commit
    Path: hooks/lint-pre-commit
```

## Best practices

- **Set timeouts.** Always set `timeout_seconds` in `HOOK.json` to prevent runaway hook processes. A stuck `curl` or script can block the entire session.
- **Bundle scripts.** Put helper scripts in the hook directory alongside `HOOK.json` rather than using complex `args` arrays.
- **Keep hooks simple.** Complex logic belongs in a script file. Point `command` at a script in the hook directory.
- **Make hooks idempotent.** Hooks may fire multiple times. Don't rely on them firing exactly once.
- **Use matchers sparingly.** Broad matchers on `pre_tool_call` fire frequently and can slow down sessions.
- **Test locally.** Run your hook command manually before adding it to your config.
- **Use env for secrets.** Pass sensitive values through `env` in `HOOK.json` or environment variable interpolation rather than hardcoding in `args`.

## Next steps

- **[Roots and Multi-Root Setups](roots.md)** — Assign hooks to specific roots.
- **[Validating Configuration](validating-configuration.md)** — Validate your hooks config.
- **[Extensions System](extensions.md)** — Hooks and the extension pipeline.
