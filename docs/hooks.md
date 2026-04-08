# Hooks

Hooks are shell commands that run in response to agent lifecycle events. They provide automation, guardrails, and integration points without modifying the agent itself.

## Why Hooks?

Hooks let you attach behavior to agent lifecycle events:

- **Notifications** — post to Slack when a session starts or ends
- **Guardrails** — run linting before commits, block deployments to prod
- **Automation** — trigger CI pipelines, update dashboards, log metrics
- **Integration** — connect agent activity to your existing tooling

## Structure

Hooks use a two-layer structure, like skills:

1. **Index** (`hooks.json`) — lightweight catalog entries with id, description, and a path
2. **Directory** (`hooks/{id}/`) — contains the runtime definition (`HOOK.json`) and any associated scripts

This separation keeps the index scannable while allowing hooks to bundle scripts and configuration together in an isolated directory.

## Index Format

Hooks are registered in `hooks.json`:

```json
{
  "notify-session-start": {
    "id": "notify-session-start",
    "title": "Session Start Notification",
    "description": "Post to Slack when an agent session starts",
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

### Index Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier. Must match the key. |
| `title` | No | Human-readable display name. |
| `description` | Yes | What this hook does. |
| `path` | Yes | Relative path to the hook directory containing `HOOK.json`. |
| `references` | No | IDs of reference documents this hook depends on. |

## Hook Directory

Each hook directory contains a `HOOK.json` file with the runtime definition, plus any scripts or files the hook needs:

```
hooks/
├── notify-session-start/
│   ├── HOOK.json
│   └── notify.sh
└── lint-pre-commit/
    └── HOOK.json
```

### HOOK.json

The `HOOK.json` file defines how the hook executes:

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

### HOOK.json Fields

| Field | Required | Description |
|-------|----------|-------------|
| `event` | Yes | Lifecycle event that triggers this hook. |
| `command` | Yes | Shell command to execute. |
| `args` | No | Command-line arguments. |
| `env` | No | Environment variables. Values support `${VAR}` interpolation. |
| `timeout_seconds` | No | Maximum execution time before the hook is killed. |
| `matcher` | No | Regex pattern to filter events. Hook only fires when matched. |

## Lifecycle Events

| Event | When it fires |
|-------|--------------|
| `session_start` | Agent session begins |
| `session_end` | Agent session ends |
| `pre_tool_call` | Before the agent calls an MCP tool |
| `post_tool_call` | After an MCP tool call completes |
| `pre_commit` | Before a git commit is created |
| `post_commit` | After a git commit is created |
| `notification` | When the agent produces a user-facing notification |

## Matchers

Use the `matcher` field in `HOOK.json` to filter which events trigger the hook. The value is a regex pattern matched against event data:

```json
{
  "event": "pre_tool_call",
  "matcher": "deploy.*production",
  "command": "echo",
  "args": ["ERROR: Direct production deployments are blocked. Use the release skill."],
  "timeout_seconds": 5
}
```

## Agent Translation

At session start, AIR copies hook directories into the agent's working directory (e.g., `.claude/hooks/{id}/`). The adapter reads `HOOK.json` to translate hooks into agent-specific formats. For Claude Code, hooks are written to the agent's settings configuration.

Local hooks take priority — if a hook directory already exists in the target, the catalog version is not copied.

## Best Practices

1. **Set timeouts** — hooks should be fast; don't block the agent
2. **Use matchers sparingly** — overly broad matchers can slow down sessions
3. **Idempotent hooks** — hooks may fire multiple times; make them safe to repeat
4. **Bundle scripts** — put helper scripts in the hook directory alongside `HOOK.json`
5. **Keep hooks simple** — complex logic belongs in skills, not hooks
6. **Test locally** — verify hook commands work before adding them to configuration
