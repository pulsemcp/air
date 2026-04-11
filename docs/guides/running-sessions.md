# Running Sessions

AIR provides two commands for launching agent sessions: `air start` for interactive use and `air prepare` for programmatic/orchestrator use.

## Before you start

AIR assembles configuration for a **single session** from `air.json` each time you run `air start` or `air prepare`. Before your first session, ensure any user-scoped agent configuration is disabled so AIR is the single source of truth. See [How AIR manages configuration](quickstart.md#how-air-manages-configuration) for details and migration steps.

## air start — interactive sessions

`air start` is the primary command for starting an agent session interactively:

```bash
air start claude
```

### What it does

1. Finds the adapter for the specified agent (e.g., `@pulsemcp/air-adapter-claude`)
2. Resolves all artifacts from your `air.json`
3. Checks if the agent CLI is available on your PATH
4. Opens an interactive TUI for browsing and selecting artifacts
5. Prepares the session (writes `.mcp.json`, injects skills, etc.)
6. Launches the agent

### Interactive TUI

When run in a TTY, `air start` opens an interactive terminal UI where you can:

- **Browse artifact types** — use left/right arrows to switch between MCP, Skills, Hooks, and Plugins
- **Select/deselect artifacts** — use up/down arrows to navigate, Space to toggle, `a` for all, `n` for none, `o` for only current
- **Search** — press `/` to filter items by name or description, Escape to clear
- **Launch** — press Enter to start the agent with your selections, `q` or Ctrl+C to cancel

The footer shows a cross-artifact selection summary so you can see what's selected across all types.

When not in a TTY (e.g., in a CI pipeline) or when `--skip-confirmation` is passed, the TUI is skipped and the agent launches with root defaults.

### Options

Required argument: `<agent>` — the agent to start (e.g., `claude`).

| Flag | Description |
|------|-------------|
| `--root <name>` | Activate a specific root |
| `--dry-run` | Preview configuration without starting |
| `--skip-confirmation` | Skip the interactive TUI and launch directly |
| `--no-subagent-merge` | Skip merging subagent roots' artifacts |

### Passing arguments to the agent

Use `--` to forward arguments to the agent process:

```bash
air start claude -- --dangerously-skip-permissions
```

Everything after `--` is passed directly to the agent's start command.

### Dry run

Preview what would be activated:

```bash
air start claude --dry-run
```

Output:

```
=== AIR Session Configuration ===
Agent: claude
Root: web-app — Main web application. Full-stack Rails app with React frontend.

MCP Servers (2):
  • github — Create and manage issues, PRs, branches, and files in GitHub repos.
  • postgres-prod — Read-only access to the production PostgreSQL database.

Skills (2):
  • deploy-staging — Deploy the current branch to the staging environment for testing
  • initial-pr-review — Perform a structured first-pass code review on a pull request

Plugins (1):
  • code-quality — Linting, formatting, and static analysis tools bundled with coding standards skills

Hooks (1):
  • lint-pre-commit — Run linting on staged files before allowing a commit
```

### Using roots

If you have [roots](roots.md) configured, activate one to scope the session:

```bash
air start claude --root web-app
```

This activates only the MCP servers, skills, plugins, and hooks listed in the root's defaults. Without `--root`, `air start` auto-detects the root from the current directory's git context and pre-selects the root's defaults in the TUI.

When a root declares `default_subagent_roots`, the TUI pre-selects MCP servers and skills from both the parent root and its subagent roots (union). The `--dry-run` output also reflects this merged view. Use `--no-subagent-merge` to disable this behavior.

## air prepare — programmatic sessions

`air prepare` writes agent configuration to a target directory without starting the agent. It's designed for orchestrators and CI/CD pipelines.

```bash
air prepare claude
```

The adapter argument is required — it specifies which agent adapter to use (e.g., `claude`). Use `--target` to specify a different directory (defaults to cwd).

### What it does

1. Loads `air.json` and extensions
2. Resolves artifacts (including remote URIs via providers)
3. Auto-detects the root from the target directory's git context (or uses `--root`)
4. Calls the adapter's `prepareSession()`:
   - Writes `.mcp.json` to the target directory
   - Copies skills into the agent's skill directory
   - Copies referenced documents
5. Runs transforms on `.mcp.json` (e.g., secrets injection)
6. Copies hook directories into the agent's hook directory and registers them in the agent's settings (e.g., `.claude/settings.json`)
7. Validates no `${VAR}` patterns remain unresolved
7. Outputs structured JSON to stdout

### Options

Required argument: `<adapter>` — the agent adapter to use (e.g., `claude`).

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to air.json (default: `~/.air/air.json` or `AIR_CONFIG`) |
| `--root <name>` | Root to activate (auto-detected from cwd if omitted) |
| `--target <dir>` | Directory to prepare (default: current directory) |
| `--skills <ids>` | Comma-separated skill IDs (overrides root defaults) |
| `--mcp-servers <ids>` | Comma-separated MCP server IDs (overrides root defaults) |
| `--hooks <ids>` | Comma-separated hook IDs (overrides root defaults) |
| `--plugins <ids>` | Comma-separated plugin IDs (overrides root defaults) |
| `--no-subagent-merge` | Skip merging subagent roots' artifacts |
| `--skip-validation` | Skip `${VAR}` validation |

Extensions can contribute additional flags — see [Extensions System](extensions.md).

### Output

`air prepare` writes diagnostic messages to stderr and structured JSON to stdout:

```bash
# Diagnostic output (stderr)
Auto-detected root: web-app
Warning: github://acme/shared-config@main is behind remote. Run `air update` to refresh.

# Structured output (stdout)
{
  "configFiles": [".mcp.json"],
  "skillPaths": [".claude/skills/deploy-staging", ".claude/skills/initial-pr-review"],
  "startCommand": {
    "command": "claude",
    "args": []
  }
}
```

Staleness warnings appear when cached provider data (e.g., GitHub clones) is behind the remote. These are informational — the session still runs with cached data. Run `air update` to refresh.

### Auto-detection

When `--root` is not specified, `air prepare` auto-detects the root by matching the target directory's git remote URL against root definitions. It prints the detected root to stderr:

```
Auto-detected root: web-app
```

Detection priority:
1. Exact subdirectory match
2. Longest prefix match (target dir is within root's subdirectory)
3. Root-level match (root has no subdirectory specified)
4. Any matching root as fallback

### Overriding defaults

Override which skills, MCP servers, hooks, or plugins are activated, regardless of root defaults:

```bash
air prepare claude --skills deploy-staging --mcp-servers github,postgres-prod --hooks lint-pre-commit --plugins code-quality
```

## How roots, adapters, and providers interact

Here's the full flow when you run a session:

```
air.json
  ├── extensions → loaded first (adapters, providers, transforms)
  ├── artifact paths → resolved via local filesystem or providers
  │    └── github://acme/config/skills.json → resolved by GitHub provider
  └── roots → matched against target directory

Artifacts resolved → Adapter translates → Transforms modify → Session ready
```

1. **Extensions** are loaded from `air.json` in declaration order
2. **Providers** (from extensions) resolve remote URIs in artifact paths
3. **Artifacts** are loaded and merged from all index files
4. **Root** selection filters which artifacts are activated
5. **Adapter** translates AIR artifacts to agent-specific format (e.g., writes `.mcp.json`, copies skills, copies and registers hooks)
6. **Transforms** (from extensions) modify the output (e.g., inject secrets)
7. **Validation** checks for unresolved `${VAR}` patterns

## Tips for running multiple sessions

AIR sets up one session per working directory. If you want to run multiple agent sessions on the same repo at the same time — for example, one agent fixing a bug while another writes docs — each session needs its own isolated copy of the repo. Two practical approaches:

### Approach 1: Rotate through git clones

Create a few clones of your repo upfront and rotate through them:

```bash
# One-time setup: create a few working copies
git clone https://github.com/acme/web-app.git ~/agents/web-app-1
git clone https://github.com/acme/web-app.git ~/agents/web-app-2
git clone https://github.com/acme/web-app.git ~/agents/web-app-3

# Start a session in each clone
cd ~/agents/web-app-1 && air start claude
cd ~/agents/web-app-2 && air start claude
```

This is the simplest approach. When a session finishes, merge its branch and reuse the clone for the next task.

### Approach 2: Use git worktrees

Git worktrees let you check out multiple branches of the same repo simultaneously without duplicating the full `.git` directory:

```bash
# From your main clone, create worktrees with new branches
cd ~/repos/web-app
git worktree add -b feature/bugfix ~/agents/web-app-bugfix
git worktree add -b feature/docs ~/agents/web-app-docs

# Start a session in each worktree
cd ~/agents/web-app-bugfix && air start claude
cd ~/agents/web-app-docs && air start claude

# Clean up when done
git worktree remove ~/agents/web-app-bugfix
git worktree remove ~/agents/web-app-docs
```

Worktrees are more disk-efficient than full clones and share git history, but require comfort with the `git worktree` command. See `git worktree --help` for details.

### Which to choose?

- **Clones** are simpler and fully independent — if one clone gets into a bad state, the others are unaffected. Good default choice.
- **Worktrees** share the `.git` directory, so they use less disk space and `git fetch` in one worktree updates all of them. Better when you have many sessions on a large repo.

Both approaches work identically with `air start` and `air prepare` — AIR doesn't care how the working directory was created.

## Common patterns

### CI/CD pipeline

```bash
# Install extensions, prepare the workspace, then run the agent
air install --config /path/to/air.json
air prepare claude --config /path/to/air.json --target /workspace --root my-project
claude --session-dir /workspace
```

### Multi-agent orchestration

```bash
# Prepare different roots for different agents
air prepare claude --root frontend --target /workspace/frontend
air prepare claude --root backend --target /workspace/backend
```

### Local development

```bash
# Quick start with defaults
air start claude

# Start with a specific project context
air start claude --root web-app
```

## Next steps

- **[Roots and Multi-Root Setups](roots.md)** — Configure roots for different projects.
- **[Extensions System](extensions.md)** — Add adapters, providers, and transforms.
- **[Composition and Overrides](composition-and-overrides.md)** — Advanced config layering.
