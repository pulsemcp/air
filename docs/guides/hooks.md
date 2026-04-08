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
| `path` | Yes | Relative path to the hook directory containing `HOOK.json`. |
| `references` | No | IDs of reference documents this hook depends on. |

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

## Agent translation

At session start, AIR copies hook directories into the agent's working directory (e.g., `.claude/hooks/{id}/`). The adapter reads `HOOK.json` to translate hooks into agent-specific formats. Local hooks take priority — if a hook directory already exists in the target, the catalog version is not copied.

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
