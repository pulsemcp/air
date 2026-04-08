# Running Sessions

AIR provides two commands for launching agent sessions: `air start` for interactive use and `air prepare` for programmatic/orchestrator use.

## air start — interactive sessions

`air start` is the primary command for starting an agent session interactively:

```bash
air start claude
```

### What it does

1. Finds the adapter for the specified agent (e.g., `@pulsemcp/air-adapter-claude`)
2. Resolves all artifacts from your `air.json`
3. Checks if the agent CLI is available on your PATH
4. Prints the session configuration summary
5. Shows the command to launch the agent

### Options

Required argument: `<agent>` — the agent to start (e.g., `claude`).

| Flag | Description |
|------|-------------|
| `--root <name>` | Activate a specific root |
| `--dry-run` | Preview configuration without starting |
| `--skip-confirmation` | Don't prompt for confirmation |

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

This activates only the MCP servers, skills, plugins, and hooks listed in the root's defaults. Without `--root`, all artifacts are available.

## air prepare — programmatic sessions

`air prepare` writes agent configuration to a target directory without starting the agent. It's designed for orchestrators and CI/CD pipelines.

```bash
air prepare
```

By default, it prepares the current directory. Use `--target` to specify a different directory.

### What it does

1. Loads `air.json` and extensions
2. Resolves artifacts (including remote URIs via providers)
3. Auto-detects the root from the target directory's git context (or uses `--root`)
4. Calls the adapter's `prepareSession()`:
   - Writes `.mcp.json` to the target directory
   - Copies skills into the agent's skill directory
   - Copies referenced documents
5. Runs transforms on `.mcp.json` (e.g., secrets injection)
6. Copies hook directories into the agent's hook directory
7. Validates no `${VAR}` patterns remain unresolved
7. Outputs structured JSON to stdout

### Options

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to air.json (default: `~/.air/air.json` or `AIR_CONFIG`) |
| `--root <name>` | Root to activate (auto-detected from cwd if omitted) |
| `--target <dir>` | Directory to prepare (default: current directory) |
| `--adapter <name>` | Agent adapter (default: `"claude"`) |
| `--skills <ids>` | Comma-separated skill IDs (overrides root defaults) |
| `--mcp-servers <ids>` | Comma-separated MCP server IDs (overrides root defaults) |
| `--no-subagent-merge` | Skip merging subagent roots' artifacts |
| `--skip-validation` | Skip `${VAR}` validation |

Extensions can contribute additional flags — see [Extensions System](extensions.md).

### Output

`air prepare` writes diagnostic messages to stderr and structured JSON to stdout:

```bash
# Diagnostic output (stderr)
Auto-detected root: web-app

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

Override which skills or MCP servers are activated, regardless of root defaults:

```bash
air prepare --skills deploy-staging --mcp-servers github,postgres-prod
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
5. **Adapter** translates AIR artifacts to agent-specific format (e.g., writes `.mcp.json`, copies skills and hook directories)
6. **Transforms** (from extensions) modify the output (e.g., inject secrets)
7. **Validation** checks for unresolved `${VAR}` patterns

## Common patterns

### CI/CD pipeline

```bash
# Install extensions, prepare the workspace, then run the agent
air install --config /path/to/air.json
air prepare --config /path/to/air.json --target /workspace --root my-project
claude --session-dir /workspace
```

### Multi-agent orchestration

```bash
# Prepare different roots for different agents
air prepare --root frontend --target /workspace/frontend
air prepare --root backend --target /workspace/backend
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
