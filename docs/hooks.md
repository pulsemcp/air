# Hooks

Hooks are shell commands that run in response to agent lifecycle events. They provide automation, guardrails, and integration points without modifying the agent itself.

## Why Hooks?

Hooks let you attach behavior to agent lifecycle events:

- **Notifications** — post to Slack when a session starts or ends
- **Guardrails** — run linting before commits, block deployments to prod
- **Automation** — trigger CI pipelines, update dashboards, log metrics
- **Integration** — connect agent activity to your existing tooling

## Index Format

Hooks are registered in `hooks.json`:

```json
{
  "notify-session-start": {
    "id": "notify-session-start",
    "title": "Session Start Notification",
    "description": "Post to Slack when an agent session starts",
    "event": "session_start",
    "command": "curl",
    "args": ["-X", "POST", "-H", "Content-Type: application/json",
             "-d", "{\"text\": \"Agent session started\"}",
             "${SLACK_WEBHOOK_URL}"],
    "timeout_seconds": 10
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier. Must match the key. |
| `title` | No | Human-readable display name. |
| `description` | Yes | What this hook does. |
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

Use the `matcher` field to filter which events trigger the hook. The value is a regex pattern matched against event data:

```json
{
  "block-prod-deploy": {
    "id": "block-prod-deploy",
    "description": "Prevent direct deployments to production",
    "event": "pre_tool_call",
    "matcher": "deploy.*production",
    "command": "echo",
    "args": ["ERROR: Direct production deployments are blocked. Use the release skill."],
    "timeout_seconds": 5
  }
}
```

## Agent Translation

At session start, AIR translates hooks to agent-specific formats. For Claude Code, hooks are written to the agent's settings configuration.

## Best Practices

1. **Set timeouts** — hooks should be fast; don't block the agent
2. **Use matchers sparingly** — overly broad matchers can slow down sessions
3. **Idempotent hooks** — hooks may fire multiple times; make them safe to repeat
4. **Keep hooks simple** — complex logic belongs in skills, not hooks
5. **Test locally** — verify hook commands work before adding them to configuration
