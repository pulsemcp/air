# Hooks

Hooks are shell commands that run in response to agent lifecycle events. Use them for notifications, guardrails, automation, and integrations.

## Defining hooks

Add entries to `~/.air/hooks/hooks.json`:

```json
{
  "notify-session-start": {
    "id": "notify-session-start",
    "title": "Session Start Notification",
    "description": "Send a Slack notification when an agent session starts",
    "event": "session_start",
    "command": "curl",
    "args": [
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-d", "{\"text\": \"Agent session started\"}",
      "${SLACK_WEBHOOK_URL}"
    ],
    "timeout_seconds": 10
  }
}
```

### Hook fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier. Must match the key. |
| `description` | Yes | What this hook does. Max 500 characters. |
| `event` | Yes | Lifecycle event that triggers this hook. |
| `command` | Yes | Shell command to execute. |
| `title` | No | Human-readable name. Max 100 characters. |
| `args` | No | Command arguments. |
| `env` | No | Environment variables for the hook process. |
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
| `notification` | For notifications/messaging |

## Examples

### Pre-commit linting

Run linting before every commit:

```json
{
  "lint-pre-commit": {
    "id": "lint-pre-commit",
    "title": "Pre-Commit Lint",
    "description": "Run linting on staged files before allowing a commit",
    "event": "pre_commit",
    "command": "npx",
    "args": ["lint-staged"],
    "timeout_seconds": 30
  }
}
```

### Post-commit notification

Notify a channel after each commit:

```json
{
  "post-commit-notify": {
    "id": "post-commit-notify",
    "title": "Post-Commit Notify",
    "description": "Post commit details to the team Slack channel",
    "event": "post_commit",
    "command": "bash",
    "args": ["-c", "curl -X POST -d '{\"text\": \"New commit pushed\"}' ${SLACK_WEBHOOK_URL}"],
    "timeout_seconds": 10
  }
}
```

### Tool call guardrail

Log or gate specific tool calls with a matcher:

```json
{
  "log-bash-calls": {
    "id": "log-bash-calls",
    "title": "Log Bash Calls",
    "description": "Log all Bash tool invocations for audit",
    "event": "pre_tool_call",
    "command": "bash",
    "args": ["-c", "echo \"Tool call: $TOOL_NAME\" >> /tmp/agent-audit.log"],
    "matcher": "Bash"
  }
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

AIR hooks are translated to agent-specific formats during session preparation. The adapter handles this translation — you define hooks once in AIR's format and they work across supported agents.

## Listing hooks

```bash
air list hooks
```

Output:

```
Hooks (2):
  notify-session-start — Session Start Notification
    Send a Slack notification when an agent session starts
    Event: session_start

  lint-pre-commit — Pre-Commit Lint
    Run linting on staged files before allowing a commit
    Event: pre_commit
```

## Best practices

- **Set timeouts.** Always set `timeout_seconds` to prevent runaway hook processes. A stuck `curl` or script can block the entire session.
- **Keep hooks simple.** Complex logic belongs in a script file, not in `args` arrays. Point `command` at a script.
- **Make hooks idempotent.** Hooks may fire multiple times. Don't rely on them firing exactly once.
- **Use matchers sparingly.** Broad matchers on `pre_tool_call` fire frequently and can slow down sessions.
- **Test locally.** Run your hook command manually before adding it to your config.
- **Use env for secrets.** Pass sensitive values through `env` or environment variable interpolation rather than hardcoding in `args`.

## Next steps

- **[Roots and Multi-Root Setups](roots.md)** — Assign hooks to specific roots.
- **[Validating Configuration](validating-configuration.md)** — Validate your hooks config.
- **[Extensions System](extensions.md)** — Hooks and the extension pipeline.
